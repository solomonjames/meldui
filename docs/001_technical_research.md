# 001 - Technical Research: MeldUI Desktop App

**Date:** 2026-03-12
**Status:** Initial Research
**Purpose:** Evaluate technical options for building a cross-platform desktop app that visualizes the MELD software development workflow

---

## Product Vision

A cross-platform (macOS + Windows) desktop app that provides a visual, opinionated software development workflow powered by Claude AI. The app brings the MELD methodology — from ideation through spec engineering, implementation, and code review — into a clean, progressive UI.

### Core Flow

```
Backlog → Research & Spec → Review Spec → Implementation → Diff Review → Commit
```

### Key Features (Initial)

- **Backlog**: Add ideas anytime, prioritize when ready
- **Spec Engineering**: AI-assisted research, Given/When/Then acceptance criteria, ready-for-dev standards
- **Spec Review**: Iterate on specs with AI, validate completeness
- **Implementation**: AI-driven TDD execution with per-task quality loop
- **Diff Review**: GitHub PR-style diff viewer before any commits, AI handles feedback
- **Horizontal Flow**: Left-to-right progression through stages (initial concept)

---

## 1. MELD Workflow Analysis

The MELD methodology defines a structured software development lifecycle. Here's what needs to be visualized:

### Workflow Stages (What the UI Needs to Represent)

| Stage | MELD Phase | Artifacts Produced | Visual Needs |
|-------|-----------|-------------------|--------------|
| **Idea Capture** | Pre-MELD | Backlog item (title, description) | Card/list view, drag to prioritize |
| **Complexity Assessment** | `meld-complexity-assessment` | Complexity rating (5 signals), routing decision | Signal indicators, routing visualization |
| **Spec Engineering** | `meld-quick-spec` Phase 1-4 | Problem statement, technical context, tasks + ACs, ready-for-dev spec | Progressive disclosure, Given/When/Then editor |
| **Spec Review** | `meld-quick-spec` Phase 4 | Review findings, iteration history | Diff view of spec changes, approval gate |
| **Implementation** | `meld-quick-dev` Phase 1-3 | Per-task diffs, test results, implementation reports | Task progress, code diff viewer, test status |
| **Code Simplification** | `meld-quick-dev` Phase 4 | Simplified diffs | Before/after diff comparison |
| **Self-Check** | `meld-quick-dev` Phase 5 | Verification evidence (tests, build, lint) | Pass/fail dashboard with evidence |
| **Adversarial Review** | `meld-quick-dev` Phase 6 | Review findings (severity + validity matrix) | Finding cards with classification |
| **Completion** | `meld-quick-dev` Phase 7 | Retrospective, learnings | Summary view, PR creation |

### Per-Task Execution Loop (Core Implementation View)

Each task in the implementation stage goes through a 6-step loop that the UI should visualize:

1. **Prepare** — Capture baseline, gather context
2. **Implement** — TDD: failing test → pass → refactor
3. **Simplify** — Code clarity pass (if diff > 20 lines)
4. **Spec Review** — Verify matches specification
5. **Code Review** — Adversarial review (sees ONLY diff, not spec)
6. **Complete** — Final test run, record results

### Key Concepts to Visualize

- **Three Iron Laws**: TDD (test first), Verification (fresh evidence), Debugging (root cause first)
- **Complexity Routing**: 0-1 signals → execute, 2 → plan first, 3+ → full MELD
- **Finding Classification**: Severity (Critical/High/Medium/Low) × Validity (Real/Noise/Undecided)
- **Ready-for-Dev Gate**: 5 criteria (Actionable, Logical, Testable, Complete, Self-Contained)
- **Information Asymmetry**: Adversarial reviewer sees only the diff, not the intent

---

## 2. Claude Integration Options

### Claude Agent SDK (Primary Integration Path)

The Agent SDK packages the same agentic capabilities that power Claude Code as an embeddable library.

| Language | Package | Status |
|----------|---------|--------|
| **TypeScript** | `@anthropic-ai/claude-agent-sdk` | v0.2.71 (stable) |
| **Python** | `claude-agent-sdk` | v0.1.48 (stable) |

**How it works:** The SDK runs an agent loop — Claude receives prompts + tools, responds with text/tool calls, SDK executes tools, results feed back to Claude, loop repeats until done.

**Built-in tools:** Read, Write, Edit, Bash, Glob, Grep — the same toolset as Claude Code.

**Custom tools:** Implemented as in-process MCP servers running within your application.

**Permission modes:** `acceptEdits`, `dontAsk`, `bypassPermissions`, `readOnly` — gives the app control over what Claude can do autonomously.

**Streaming output:** SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage — provides real-time feedback for the UI.

**V2 Preview (TypeScript):** Simpler multi-turn API with `send()`/`stream()` cycles. Unstable but promising.

**Existing desktop apps using it:**
- **Pencil.dev** (Electron + Bun + MCP Server) — design app, uses Claude Agent SDK v0.2.72
- CodePilot (Electron + Next.js)
- Claude Agent Desktop (Electron + Vite)

### Claude API (Direct)

For cases where the full agent loop isn't needed (e.g., spec review, complexity assessment):

- **Messages API** (`/v1/messages`) — primary endpoint
- **Streaming** — fine-grained tool streaming, GA
- **Auth**: `x-api-key: sk-ant-api03-...` header
- **Vision/PDF support** for document analysis
- **Extended thinking** on latest models
- **Prompt caching** — 90% savings on repeated context

### Authentication: Two Paths

**Two types of API keys exist:**

| Token Type | Prefix | Allowed Use |
|------------|--------|-------------|
| API keys | `sk-ant-api03-` | Any application (per-token billing) |
| OAuth tokens | `sk-ant-oat01-` | Claude.ai and Claude Code ONLY |

**Direct OAuth usage by third-party apps is banned** (enforced server-side since Jan 2026). However, there is a critical distinction:

### Claude Agent SDK Inherits Claude Code Auth (Key Finding)

Analysis of Pencil.app (pencil.dev) reveals that **apps built with the Claude Agent SDK inherit the user's existing Claude Code authentication**, including subscription access. The auth chain:

```
Your App → Claude Agent SDK → bundled Claude Code CLI → user's Claude Code login
```

**How it works:**
- The Agent SDK bundles the complete Claude Code CLI binary (~189 MB for darwin-arm64)
- The SDK's `query()` function spawns Claude Code (`cli.js`) as a subprocess
- Claude Code reads credentials from the macOS Keychain and makes API calls to Anthropic
- If the user has already logged into Claude Code with their subscription (Pro/Max), the SDK uses that auth
- If the user has an API key configured for Claude Code, the SDK uses that instead
- If the user hasn't logged in, the SDK triggers Claude Code's native browser-based OAuth flow
- The app never touches OAuth tokens directly — Claude Code handles auth transparently
- Supports multiple login types: Claude subscription (OAuth), API key, AWS Bedrock, Google Vertex, Microsoft Foundry

**Why this is allowed vs. direct OAuth which is banned:**
- **BANNED:** Extracting OAuth tokens and making direct API calls (bypasses Claude Code's harness, telemetry, safety checks)
- **ALLOWED:** Embedding the official Agent SDK, which spawns Claude Code as subprocess (preserves Anthropic's official harness)
- The SDK docs note: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products."* — the "unless previously approved" suggests an approval process exists
- Pencil.dev appears to have such approval and ships the official SDK

**This is how Pencil.dev works with Claude subscriptions.** It doesn't extract or use OAuth tokens directly; it delegates to the official Claude Code runtime which is an authorized client.

**Risk note:** It's unclear whether any app can freely use the Agent SDK with subscription auth, or whether Anthropic requires explicit approval. This needs verification before relying on subscription auth as the primary model.

### Pencil.app Architecture Reference

From analysis of `/Applications/Pencil.app`:
- **Framework:** Electron v39.1.1
- **Runtime:** Bun (bundled, ~59.8 MB)
- **SDK:** `@anthropic-ai/claude-agent-sdk` v0.2.72
- **Claude Code CLI:** v2.1.72 (bundled in SDK)
- **MCP Server:** Custom binary for design tool capabilities (~7.4 MB)
- **Total Claude bundle:** ~189 MB for the CLI + SDK
- **Communication:** Local HTTP over localhost (MCP server ↔ app)
- **Publisher:** High Agency, Inc.

### Authentication Strategy for MeldUI

**Option A: Claude Agent SDK (recommended — subscription + API key support)**
- Bundle the Agent SDK which includes Claude Code CLI
- User's existing Claude Code login works automatically (subscription or API key)
- No separate auth flow needed if user already uses Claude Code
- If user hasn't logged in, SDK triggers Claude Code's native OAuth flow
- This is the same approach Pencil.dev uses

**Option B: Direct API integration (BYOK — API key only)**
- User creates key at console.anthropic.com
- App stores it securely in OS keychain
- User pays per-token directly to Anthropic
- No subscription support, but simpler integration

**Option C: Both — Agent SDK primary, API key fallback**
- Default to Agent SDK for full Claude Code capabilities + subscription auth
- Allow API key override for users who prefer direct billing
- Maximum flexibility

**Recommendation:** Option C. Start with Agent SDK (subscription-compatible), offer API key as alternative.

### Model Selection

| Model | Best For | Input/Output Cost (per 1M tokens) |
|-------|---------|-----------------------------------|
| Haiku 4.5 | Speed, low cost (complexity routing, quick checks) | $1 / $5 |
| Sonnet 4.5/4.6 | Balanced (spec engineering, code review) | $3 / $15 |
| Opus 4.5/4.6 | Max capability (implementation, adversarial review) | $5 / $25 |

**Cost optimization:** Prompt caching (90% savings on system prompts) and batch API (50% discount for non-urgent work).

---

## 3. Desktop Framework Comparison

### Comparison Matrix

| Criteria | Electron | Tauri v2 | Flutter Desktop | Wails |
|---|---|---|---|---|
| **Bundle Size** | ~150 MB+ | ~2-10 MB | ~20-40 MB | ~5-10 MB |
| **Idle Memory** | ~200-300 MB | ~30-40 MB | ~80-120 MB | ~30-50 MB |
| **Startup Time** | 1-2s | ~0.5s | ~1s | ~0.5s |
| **CLI Integration** | Excellent (Node child_process) | Excellent (sidecar system) | Adequate (dart:io) | Excellent (os/exec) |
| **UI Flexibility** | Excellent (full web stack) | Excellent (full web stack) | Excellent (custom rendering) | Excellent (full web stack) |
| **Dev Ecosystem** | Largest | Growing fast | Large (mobile-focused) | Small |
| **License** | MIT | MIT/Apache 2.0 | BSD 3-Clause | MIT |
| **Maturity** | Very High | High (stable Oct 2024) | Moderate for desktop | Low (v3 alpha) |
| **Claude SDK Compat** | TypeScript Agent SDK native | TypeScript frontend + Rust backend | Python SDK via subprocess | Go backend + TS frontend |

### Framework Deep Dives

#### Electron
- **Proven at scale**: VS Code, Slack, Discord, Notion all built on it
- **Full web stack**: React, Monaco Editor, xterm.js, CodeMirror — all available
- **TypeScript Agent SDK**: Native integration, no bridging needed
- **Tradeoff**: Large bundle, high memory usage
- **Best for**: Maximum ecosystem maturity, fastest path to feature-complete

#### Tauri v2
- **Architecture**: Rust core + native WebView (WebKit on macOS, WebView2 on Windows)
- **Sidecar system**: Purpose-built for embedding CLIs — declare in config, Tauri handles platform binaries, stdout/stderr piping
- **Permission system**: Opt-in capabilities (filesystem, shell, HTTP) declared in config
- **Plugin ecosystem**: Official plugins for HTTP, shell, notifications, dialogs, auto-updater, clipboard
- **Production apps**: Aptakube, Cody (Sourcegraph)
- **Tradeoff**: Minor WebView rendering differences between platforms (rarely impactful)
- **Best for**: Performance-conscious apps, strong CLI integration, smaller bundles

#### Flutter Desktop
- **Impeller engine**: Consistent 60+ FPS rendering
- **Weakness for dev tools**: Missing developer UI libraries (no xterm.js, Monaco, CodeMirror equivalents at same maturity)
- **Custom rendering**: No native controls, must implement platform conventions manually
- **Best for**: If you want identical pixel-perfect UI across platforms and don't need rich code editing components

#### Wails
- **Architecture**: Go backend + native WebView (like Tauri but Go instead of Rust)
- **Auto-binding**: Go structs/methods become TypeScript-typed IPC calls
- **State**: v3 still in alpha, smaller community
- **Best for**: Go-centric teams only

### Recommendation (Updated After Pencil.app Analysis)

Pencil.dev validates the Electron + Agent SDK approach, but Electron's resource overhead (200-300MB idle RAM, 1-2s startup) is a real cost for a developer tool that sits alongside IDEs, browsers, and other heavy apps.

**Primary: Tauri v2**
- ~30-40MB idle RAM vs Electron's 200-300MB — critical for a developer tool running alongside an IDE
- ~0.5s startup vs 1-2s
- Sidecar system is purpose-built for spawning CLI tools like Claude Code and git
- Claude Code CLI can be spawned directly from Rust without the TypeScript SDK wrapper:
  ```
  claude --print --output-format stream-json --verbose -- "prompt"
  ```
  The output is NDJSON — Rust can parse this natively with `serde_json`
- Alternatively, bundle Bun as a sidecar to run the TypeScript Agent SDK if the full SDK API is needed
- Web frontend gives full access to React ecosystem (diff viewers, code editors, etc.)
- Smaller app bundle (Tauri ~5MB + Claude CLI ~189MB = ~194MB vs Electron ~150MB + Claude CLI ~189MB = ~339MB)
- Rust backend naturally handles SQLite, file system watching, git operations, and keychain access

**Alternative: Electron**
- Validated by Pencil.dev in production
- Zero bridging for TypeScript Agent SDK
- Choose if Rust is a barrier or if you need the fastest path to MVP

**Claude Integration in Tauri — Two Approaches:**

| Approach | How | Pros | Cons |
|----------|-----|------|------|
| **Direct CLI** | Rust spawns `claude` CLI as sidecar, parses NDJSON | No Node/Bun dependency, simplest | Must handle CLI protocol directly |
| **SDK via Bun sidecar** | Bundle Bun + Agent SDK, Tauri spawns Bun process | Full SDK API, auth flow built-in | Extra ~60MB for Bun, more moving parts |

Recommendation: Start with **Direct CLI** approach. The protocol is documented and simple. Fall back to SDK via Bun if the CLI protocol proves insufficient.

**Frontend Framework:**
- **React + TypeScript** — largest ecosystem of relevant components
- Key libraries: react-diff-viewer, Monaco Editor or CodeMirror, xterm.js, @dnd-kit (drag-and-drop for kanban)

---

## 4. Recommended Architecture

```
┌──────────────────────────────────────────────────────┐
│                    MeldUI App                         │
├──────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript via WebView)            │
│  ├── Backlog View (kanban/list)                       │
│  ├── Spec Editor (markdown + Given/When/Then)         │
│  ├── Implementation Dashboard (task progress)         │
│  ├── Diff Viewer (GitHub PR-style)                    │
│  └── Review Panel (findings + classifications)        │
├──────────────────────────────────────────────────────┤
│  Tauri IPC (invoke / event system)                    │
├──────────────────────────────────────────────────────┤
│  Rust Backend (Tauri core)                            │
│  ├── Project State Manager (SQLite via rusqlite)      │
│  ├── Git Integration (git2-rs / git CLI sidecar)      │
│  ├── Claude CLI Manager (spawn, stream NDJSON)        │
│  ├── File System Watcher (notify crate)               │
│  ├── Secure Key Storage (keyring crate)               │
│  └── MCP Server (optional, for MELD workflow tools)   │
├──────────────────────────────────────────────────────┤
│  Sidecars                                             │
│  ├── Claude Code CLI (bundled, ~189 MB)               │
│  └── Git CLI (system or bundled)                      │
└──────────────────────────────────────────────────────┘
```

### Data Storage

- **SQLite** (via `rusqlite`) for local project state (backlog items, spec versions, review findings, task status)
- **OS Keychain** (via `keyring` crate) for API key storage (macOS Keychain, Windows Credential Manager)
- **Filesystem** for spec artifacts and generated content

### Key Technical Decisions Still Needed

1. **Claude CLI integration** — Direct CLI spawn vs Bun sidecar running TypeScript SDK?
2. **State management** — Zustand, Jotai, or Redux for complex workflow state?
3. **Diff rendering** — Monaco diff editor vs react-diff-viewer vs custom?
4. **MCP Server** — Build custom MCP server for MELD workflow tools (like Pencil's design tools)?
5. **Multi-project support** — Single project or project switcher from the start?
6. **Offline capability** — Can anything work without Claude API access?
7. **Anthropic approval** — Clarify whether subscription auth via Agent SDK requires explicit approval

---

## 5. Next Steps

1. **Prototype with Tauri v2** — Build a minimal Tauri + React app, spawn Claude CLI as sidecar
2. **Validate auth flow** — Confirm Claude CLI sidecar inherits user's Claude Code subscription login
3. **Design the horizontal flow UI** — Wireframe the left-to-right progression
4. **Define data model** — Schema for backlog items, specs, tasks, findings, diffs
5. **Explore MCP server** — Design custom MELD workflow tools exposed via MCP
6. **Name the app** — "MeldUI" is a working title; consider final branding
