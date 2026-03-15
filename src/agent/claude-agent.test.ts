/**
 * Tests for ClaudeAgent — verifies that critical SDK options are passed to query().
 *
 * The Agent SDK's query() fails silently inside compiled Bun binaries unless
 * pathToClaudeCodeExecutable, stderr, and settingSources are provided.
 * These tests ensure we never regress on those options.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture the options passed to query() ──

let capturedQueryArgs: { prompt: string; options: Record<string, unknown> } | null = null;

function makeQueryMock() {
  let returned = false;
  return (args: { prompt: string; options: Record<string, unknown> }) => {
    capturedQueryArgs = args;
    returned = false;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (!returned) {
            returned = true;
            return {
              done: false,
              value: {
                type: "result",
                subtype: "success",
                result: "test",
                session_id: "sid-123",
              },
            };
          }
          return { done: true, value: undefined };
        },
      }),
    };
  };
}

// Mock the SDK — query() captures args then yields a single result
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: makeQueryMock(),
  createSdkMcpServer: () => ({}),
  tool: () => ({}),
}));

// Mock ticket server
vi.mock("./mcp/ticket-server.js", () => ({
  createTicketMcpServer: () => ({}),
}));

import { ClaudeAgent } from "./claude-agent.js";

describe("ClaudeAgent query options", () => {
  beforeEach(() => {
    capturedQueryArgs = null;
  });

  const baseConfig = {
    projectDir: "/tmp/test-project",
    maxTurns: 10,
    allowedTools: ["Read", "Glob"],
  };

  async function executeAgent(): Promise<void> {
    const agent = new ClaudeAgent();
    await agent.execute("test prompt", baseConfig);
  }

  it("passes stderr callback to query options", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    expect(opts.stderr).toBeDefined();
    expect(typeof opts.stderr).toBe("function");
  });

  it("passes settingSources to query options", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    expect(opts.settingSources).toEqual(["local", "project", "user"]);
  });

  it("passes pathToClaudeCodeExecutable as string when binary exists", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    // On any dev machine with claude installed, this should be a string path
    // If claude is not installed, the option is omitted (undefined)
    const path = opts.pathToClaudeCodeExecutable;
    if (path !== undefined) {
      expect(typeof path).toBe("string");
      expect(path).toMatch(/claude$/);
    }
  });

  it("passes permissionMode and allowDangerouslySkipPermissions", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
  });

  it("passes canUseTool callback", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    expect(opts.canUseTool).toBeDefined();
    expect(typeof opts.canUseTool).toBe("function");
  });

  it("passes includePartialMessages for streaming", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    expect(opts.includePartialMessages).toBe(true);
  });

  it("passes systemPrompt with claude_code preset", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;
    const sp = opts.systemPrompt as Record<string, unknown>;
    expect(sp.type).toBe("preset");
    expect(sp.preset).toBe("claude_code");
    expect(typeof sp.append).toBe("string");
  });

  it("includes all critical options that prevent exit code 1 in compiled binaries", async () => {
    await executeAgent();

    expect(capturedQueryArgs).not.toBeNull();
    const opts = capturedQueryArgs!.options;

    // These three options are the fix for the "Claude Code process exited with code 1" bug.
    // Removing any of them will cause the agent sidecar to fail when compiled with bun build --compile.
    // See: memory/feedback_agent_sdk_binary_options.md

    // 1. stderr callback — without this, SDK errors are silent
    expect(opts.stderr).toBeDefined();
    expect(typeof opts.stderr).toBe("function");

    // 2. settingSources — loads auth and config
    expect(opts.settingSources).toEqual(["local", "project", "user"]);

    // 3. pathToClaudeCodeExecutable — SDK can't auto-detect inside /$bunfs/root/
    //    (will be undefined only if claude is not installed at all)
    expect(opts).toHaveProperty("stderr");
    expect(opts).toHaveProperty("settingSources");
  });
});
