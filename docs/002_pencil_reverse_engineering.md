# Pencil Reverse Engineering — AI Integration Architecture

**Date:** 2026-03-14
**Source:** Extracted from `/Applications/Pencil.app/Contents/Resources/app.asar`
**Version:** Pencil 1.1.32 (Electron)

---

## Overview

Pencil is an Electron-based design tool (Figma alternative) with an integrated AI chat panel. It supports both Claude and OpenAI Codex. This document details how Pencil integrates AI, based on reverse engineering its bundled source code.

The key finding: **Pencil uses `@anthropic-ai/claude-agent-sdk`** for Claude integration and **`@openai/codex-sdk`** for Codex. It does NOT use the Vercel AI SDK, the raw Anthropic API, or the Claude CLI directly. The Agent SDK gives Pencil full streaming, tool execution, permission UI, and session management — all without requiring an API key from users who have a Claude subscription.

---

## Package Structure

```
app.asar/
  package.json          → Electron app entry point
  out/
    main.js             → Electron main process
    claude.js           → Claude auth, status checking, binary discovery
    codex.js            → Codex auth, status checking
    agent-execute-config.js → CLI-invoked agent execution (file attachments)
    desktop-mcp-adapter.js  → MCP integration setup for external tools
    mcp-server-darwin-arm64 → Pencil's native MCP server binary
    editor/             → Canvas/editor renderer code
    ...
  node_modules/
    @ha/agent/          → Pencil's internal agent abstraction library
    @ha/mcp/            → MCP utilities
    @ha/shared/         → Shared types
    @ha/ws-server/      → WebSocket server for IPC
    @anthropic-ai/claude-agent-sdk/  → Claude Agent SDK (bundled)
    @openai/codex-sdk/  → OpenAI Codex SDK (bundled)
```

### Dependencies (from `package.json`)

```json
{
  "dependencies": {
    "@ha/agent": "file:../../lib/agent",
    "@ha/ipc": "file:../../lib/ipc",
    "@ha/mcp": "file:../../lib/mcp",
    "@ha/schema": "file:../../lib/schema",
    "@ha/shared": "file:../../lib/shared",
    "@ha/ws-server": "file:../../servers/ws",
    "@sentry/electron": "^7.6.0",
    "electron-log": "^5.4.3",
    "electron-store": "^11.0.2",
    "electron-updater": "^6.6.2",
    "eventemitter3": "^5.0.1"
  }
}
```

### Agent Library Dependencies (`@ha/agent/package.json`)

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.72",
    "@openai/codex-sdk": "^0.98.0",
    "dotenv": "^17.2.2",
    "eventemitter3": "^5.0.1",
    "jsonrepair": "^3.13.1",
    "ws": "^8.18.3",
    "zod": "^4.3.5"
  }
}
```

---

## Authentication — How Users Connect Without API Keys

### Claude Authentication (`claude.js`)

Pencil supports four login types:

| Login Type | Env Var | Description |
|---|---|---|
| `"subscription"` | (none) | Uses Claude Code's OAuth — user's Pro/Team/Enterprise subscription |
| `"api-key"` | `ANTHROPIC_API_KEY` | User provides their own API key |
| `"aws-bedrock"` | `CLAUDE_CODE_USE_BEDROCK=1` | Route through AWS Bedrock |
| `"google-vertex"` | `CLAUDE_CODE_USE_VERTEX=1` | Route through Google Vertex AI |
| `"microsoft-foundry"` | `CLAUDE_CODE_USE_FOUNDRY=1` | Route through Azure Foundry |

**The subscription path is the default.** When a user has Claude Code installed and logged in (via `claude login`), the Agent SDK uses that OAuth token automatically. No API key is needed.

#### Status Check Implementation

```typescript
// Pencil checks auth by running a minimal query and reading accountInfo()
async getClaudeStatus(): Promise<ClaudeConnectionStatus> {
  const q = query({
    prompt: "what is 2+2?",
    options: {
      model: "claude-haiku-4-5-20251001",
      maxTurns: 0,              // Don't actually run
      maxBudgetUsd: 0.00001,    // Minimal cost cap
      pathToClaudeCodeExecutable: this.getExecutablePath(),
      executable: this.config.execPath,
      env: this.config.env,
    },
  });

  const info = await q.accountInfo();
  q.return(); // Immediately terminate

  if (info.apiKeySource && info.apiKeySource !== "") {
    loggedIn = true;
    loginType = "api-key";
  }

  if (info.subscriptionType && info.subscriptionType !== "") {
    loggedIn = true;
    loginType = "subscription";
  }

  return { loggedIn, loginType, accountInfoEmail: info.email };
}
```

#### Environment Setup

```typescript
function getClaudeCodeEnv() {
  const loginType = desktopConfig.get("claudeLoginType");
  const baseEnv = {
    ...process.env,
    ANTHROPIC_BETAS: "fine-grained-tool-streaming-2025-05-14",
  };

  switch (loginType) {
    case "api-key":
      return { ...baseEnv, ANTHROPIC_API_KEY: desktopConfig.get("claudeApiKey") };
    case "aws-bedrock":
      return { ...baseEnv, CLAUDE_CODE_USE_BEDROCK: "1" };
    case "google-vertex":
      return { ...baseEnv, CLAUDE_CODE_USE_VERTEX: "1" };
    case "microsoft-foundry":
      return { ...baseEnv, CLAUDE_CODE_USE_FOUNDRY: "1" };
    default:
      return baseEnv;
  }
}
```

### Codex Authentication (`codex.js`)

Codex supports two login types:
- `"api-key"` — User provides OpenAI API key, stored in `desktopConfig`
- `"subscription"` — Uses Codex CLI's own auth

### Binary Discovery

Pencil bundles its own Bun runtime and the Agent SDK CLI:

```typescript
// Bun binary path (bundled with the app)
function getClaudeExecPath() {
  const plat = os.platform();
  return path.join(APP_FOLDER_PATH, "out", "assets",
    `bun-${plat}-${os.arch()}${plat === "win32" ? ".exe" : ""}`);
}

// Agent SDK CLI path (bundled in asar.unpacked)
function getClaudeCodePackagePath() {
  const appPath = app.getAppPath();
  const asarUnpackedPath = appPath.replace(/\.asar$/, ".asar.unpacked");
  return path.join(asarUnpackedPath, "node_modules",
    "@anthropic-ai", "claude-agent-sdk");
}
```

---

## Agent Execution — The Core Loop

### ClaudeAgent Class (`@ha/agent/src/claude/index.ts`)

The `ClaudeAgent` class wraps the Agent SDK's `query()` function and emits typed events for the UI to consume.

#### Agent Configuration

```typescript
const options: Options = {
  model: this.config.model === "custom-model" ? undefined : this.config.model,
  pathToClaudeCodeExecutable: this.getExecutablePath(),
  executable: this.config.execPath,     // Bundled Bun binary
  env: this.config.env,                 // Auth env vars
  cwd: this.config.cwd,                // Working directory
  settingSources: ["local", "project", "user"],
  maxTurns: this.config.maxTurns || 500,

  // Tool permissions
  allowedTools: ["mcp__pencil", "WebSearch", "WebFetch"],
  disallowedTools: disallowedToolsList,

  // System prompt: use Claude Code's default + append custom instructions
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: systemPrompt,  // Pencil-specific design instructions
  },

  // MCP servers (Pencil's design tools)
  mcpServers: mcpServers,

  // Streaming config
  includePartialMessages: this.config.includePartialMessages,
  abortController: this.abortController,

  // Permission callback (see next section)
  canUseTool: async (toolName, input, options) => { ... },

  // Stderr logging
  stderr: (data: string) => { logger.debug("Agent stderr:", data); },
};

// Start the query
this.agentQuery = query({ prompt: promptContent, options });
```

#### Key Options Explained

- **`allowedTools: ["mcp__pencil", "WebSearch", "WebFetch"]`** — Pre-approves all Pencil MCP tools (prefix match) plus web search. All other tools go through `canUseTool`.
- **`systemPrompt: { type: "preset", preset: "claude_code", append: ... }`** — Uses Claude Code's built-in system prompt as a base, then appends Pencil-specific design instructions.
- **`includePartialMessages: true`** — Enables `stream_event` messages for token-level streaming, which Pencil uses to progressively parse `batch_design` operations.
- **`maxTurns: 500`** — Generous limit for complex design tasks.
- **`settingSources: ["local", "project", "user"]`** — Loads Claude Code settings from all scopes.

---

## Permission System — The `canUseTool` Callback

This is how Pencil surfaces permission requests to the user, matching the UX we want for MeldUI.

```typescript
canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
  logger.info("Claude permission request", toolName, input, options);

  // AUTO-ALLOW: File operations inside the working directory
  if (
    this.config.cwd &&
    input.file_path &&
    isPathInside(input.file_path as string, this.config.cwd)
  ) {
    return { behavior: "allow", updatedInput: input };
  }

  // AUTO-ALLOW: Blocked path inside CWD
  if (
    this.config.cwd &&
    options.blockedPath &&
    isPathInside(options.blockedPath, this.config.cwd)
  ) {
    return { behavior: "allow", updatedInput: input };
  }

  // ASK USER: Emit event to UI and wait for response
  const result = await new Promise<"allow" | "always-allow" | "deny">(
    (resolve) => {
      this.emit("permission-request", {
        toolName,
        input: input as Record<string, unknown>,
        resolve,  // UI calls this to continue
      });
    },
  );

  if (result === "allow") {
    return { behavior: "allow", updatedInput: input };
  }

  if (result === "always-allow") {
    return {
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: options.suggestions, // Persist the permission
    };
  }

  return { behavior: "deny", message: "User denied permission" };
}
```

### Permission Flow

```
1. Claude wants to use a tool (e.g., Bash)
2. Agent SDK calls canUseTool(toolName, input)
3. ClaudeAgent checks if it's auto-allowable (file in CWD)
4. If not, emits "permission-request" event with a Promise resolve callback
5. UI shows dialog: "Claude wants to run [command]. Allow / Always Allow / Deny"
6. User clicks a button → resolve("allow" | "always-allow" | "deny")
7. Promise resolves → Agent SDK continues or aborts the tool call
```

---

## Event-Driven Streaming Architecture

### Event Types Emitted by ClaudeAgent

```typescript
type PencilAgentEvents = {
  // Lifecycle
  stopped: () => void;
  completed: (payload: { response: string; error?: string }) => void;
  failed: (payload: { message: string; error?: string }) => void;

  // Session
  "chat-session": (event: { sessionId: string }) => void;

  // Chat content (for rendering in the chat panel)
  "chat-agent-message": (event: {
    content: Array<{ type: string; text?: string; name?: string; input?: any }>;
  }) => void;
  "chat-tool-use": (event: {
    toolName: string;
    toolInput: any;
    toolUseId?: string;
  }) => void;
  "chat-tool-result": (event: {
    toolUseId: string;
    toolOutput: any;
    isError: boolean;
  }) => void;

  // Design-specific (progressive rendering)
  "batch-design": (event: {
    filePath: string;
    operations: string;
    id: string;
    partial?: boolean;
  }) => void;
  "tool-use-start": (event: { name: string; id: string }) => void;
  "spawn-agents": (event: {
    filePath: string;
    agentsConfig: object[];
    id: string;
    partial?: boolean;
  }) => void;

  // Thinking
  "thinking-update": (event: { text: string }) => void;

  // Permissions
  "permission-request": (event: {
    toolName: string;
    input: Record<string, unknown>;
    resolve: (result: "allow" | "always-allow" | "deny") => void;
  }) => void;
};
```

### Message Processing Loop

The core loop iterates over `query()` output and routes messages to events:

```typescript
for await (const message of this.agentQuery) {
  // 1. System init → emit session ID
  if (message.type === "system" && message.subtype === "init") {
    this.emit("chat-session", { sessionId: message.session_id });
  }

  // 2. Tool results from user messages
  if (message.type === "user" && message.message?.content) {
    for (const content of message.message.content) {
      if (content.type === "tool_result") {
        this.emit("chat-tool-result", { ... });
      }
    }
  }

  // 3. Assistant messages (text + tool use)
  if (message.type === "assistant" && message.message?.content) {
    for (const content of message.message.content) {
      if (content.type === "tool_use") {
        this.emit("chat-tool-use", { toolName, toolInput, toolUseId });
      }
    }
    this.emit("chat-agent-message", { content: message.message.content });
  }

  // 4. Stream events (token-level, for progressive rendering)
  if (message.type === "stream_event") {
    // Handle content_block_start for tool_use → emit "tool-use-start"
    // Handle content_block_delta for input_json_delta → progressive batch_design parsing
    // Handle content_block_delta for text_delta → thinking updates
    // Handle content_block_stop → cleanup
  }
}

this.emit("completed", { response: finalResponse, error: queryError });
```

### Progressive Tool Input Parsing

Pencil has a notable optimization: it parses `batch_design` tool input *as it streams in*, using `jsonrepair` to fix incomplete JSON. This allows design operations to appear on the canvas before Claude finishes generating the full input:

```typescript
if (message.event.delta.type === "input_json_delta"
    && batchDesignCalls.has(message.event.index)) {

  call.acc += message.event.delta.partial_json;

  // jsonrepair fixes incomplete JSON (missing closing braces, etc.)
  const parsed = completePartialBatchDesign(call.acc);

  if (parsed?.operations && parsed.operations.length > call.operations.length) {
    // Only emit NEW operations (delta)
    const newOperations = parsed.operations.slice(call.operations.length);
    call.operations = parsed.operations;

    this.emit("batch-design", {
      filePath: parsed.filePath,
      operations: newOperations.join("\n"),
      id: call.id,
      partial: true,
    });
  }
}
```

---

## MCP Server Architecture

### Pencil's MCP Server

Pencil ships a native binary MCP server (`mcp-server-darwin-arm64`) that exposes design tools. It connects to the Agent SDK via stdio transport:

```typescript
// MCP server config passed to query() options
mcpServers: {
  pencil: {
    command: "/path/to/mcp-server-darwin-arm64",
    args: [...],
    env: { ... },
  }
}
```

### External MCP Integrations

Pencil also integrates with external MCP-compatible tools via `DesktopMCPAdapter`:

```typescript
static getSupportedIntegrations() {
  return [
    "claudeCodeCLI",    // Claude Code CLI as MCP server
    "codexCLI",         // OpenAI Codex CLI
    "geminiCLI",        // Google Gemini CLI
    "openCodeCLI",      // Open-source code assistant
    "kiroCLI",          // Kiro CLI
    "claudeDesktop",    // Claude Desktop app
  ];
}
```

This means Pencil can register itself as an MCP server with Claude Code CLI, Claude Desktop, and other tools — allowing those tools to call Pencil's design operations.

---

## Codex Integration (`@ha/agent/src/codex/index.ts`)

Pencil abstracts both Claude and Codex behind a common `PencilAgent` interface:

```typescript
// Factory pattern
function createAgent(type: AgentType, config: AgentConfig): PencilAgent {
  switch (type) {
    case "claude": return new ClaudeAgent(config);
    case "codex":  return new CodexAgent(config);
  }
}
```

Both agents implement the same `PencilAgent` interface and emit the same `PencilAgentEvents`. The UI code doesn't need to know which provider is active.

The Codex agent uses `@openai/codex-sdk` (v0.98.0) with the same pattern — a `query()` function, streaming events, and MCP tool integration.

---

## Implications for MeldUI

### What to Replicate

1. **Use `@anthropic-ai/claude-agent-sdk`** — Same library, same patterns. Proven in production.

2. **Auth via subscription** — Users with Claude Pro/Team don't need API keys. Use `query().accountInfo()` to check status, same as Pencil does.

3. **`canUseTool` for permissions** — Emit to frontend, resolve with user's choice. Support "allow", "always-allow", "deny".

4. **Event-driven architecture** — Define a `MeldAgent` class extending `EventEmitter` with typed events for chat messages, tool use, tool results, permission requests, and thinking updates.

5. **Custom MCP server** — Expose Beads operations (`list_issues`, `update_status`, `create_issue`, `add_comment`) as MCP tools that Claude can call directly.

6. **Progressive streaming** — Use `includePartialMessages: true` and process `stream_event` messages for real-time UI updates.

7. **Session continuity** — Store `sessionId` in workflow state. Use `options.resume` to continue conversations across workflow steps.

8. **`systemPrompt: { type: "preset", preset: "claude_code", append: ... }`** — Get Claude Code's full system prompt for free, append workflow-specific instructions.

### What Differs

| Pencil | MeldUI |
|---|---|
| Design canvas as the "artifact" | Spec document / code changes as the "artifact" |
| `batch_design` tool modifies canvas | `update_ticket`, `create_issue` tools modify beads |
| Single-turn chat interactions | Multi-step workflow with gates between steps |
| Progressive canvas rendering | Progressive spec / diff rendering |
| Bundled Bun runtime | Can use system Node.js or bundle Bun |

### Architecture for MeldUI

```
React Frontend
  ├── Chat Panel (messages, tool cards, permission dialogs)
  ├── Canvas (spec editor, diff viewer, progress view)
  └── Sidebar (ticket list, workflow stage bar)
      ↕ Tauri events / invokes
Rust Backend (coordinator)
      ↕ spawns + IPC
Node.js Sidecar (MeldAgent)
  ├── @anthropic-ai/claude-agent-sdk (query())
  ├── MCP Server: meldui-beads (list_issues, update_status, etc.)
  └── EventEmitter → stdout NDJSON → Rust → Tauri events → React
```

---

## Raw Source Files Reference

All source extracted from: `/Applications/Pencil.app/Contents/Resources/app.asar`

| File | Purpose | Key Exports |
|---|---|---|
| `out/claude.js` | Claude binary discovery, auth, status | `getClaudeCodePackagePath`, `getClaudeCodeEnv`, `getClaudeStatusChecker` |
| `out/codex.js` | Codex binary discovery, auth, status | `getCodexPackagePath`, `getCodexStatusChecker` |
| `out/agent-execute-config.js` | CLI-invoked agent execution | `parseAgentExecuteConfig`, `openWithAgentExecuteConfig` |
| `out/desktop-mcp-adapter.js` | MCP integration management | `DesktopMCPAdapter` |
| `node_modules/@ha/agent/src/claude/index.ts` | Claude Agent SDK wrapper | `ClaudeAgent` class |
| `node_modules/@ha/agent/src/codex/index.ts` | Codex SDK wrapper | `CodexAgent` class |
| `node_modules/@ha/agent/src/create-agent.ts` | Agent factory | `createAgent()` |
| `node_modules/@ha/agent/src/types.ts` | Shared types | `PencilAgent`, `PencilAgentEvents` |
| `node_modules/@ha/agent/src/config.ts` | Agent configuration | `AgentConfig` |
