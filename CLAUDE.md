# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (frontend + Tauri together)
bun run tauri:dev

# Frontend only (Vite dev server on :5173)
bun run dev

# Build native binary (.app bundle, requires code signing)
bun run tauri:build

# Build native binary (no bundle/signing, for local dev)
bun run tauri:build:dev

# Agent sidecar only
bun run agent:install               # First time only
bun run agent:build                 # Compiles src/agent/ → src-tauri/binaries/agent-*

# Type checking
npx tsc --noEmit                    # Frontend
cd src-tauri && cargo check          # Rust

# Lint
bun run lint

# Rust formatting
cd src-tauri && cargo fmt -- --check

# Tests
bun run test                        # Vitest (unit/integration)
bun run test:watch                  # Vitest watch mode
bun run e2e                         # WebdriverIO e2e tests (builds mock sidecar first)
```

Package manager is **bun** (not npm/yarn). The agent sidecar has its own `package.json` at `src/agent/package.json` — run `bun run agent:install` after cloning.

## Architecture

MeldUI is a **Tauri v2** desktop app: a React frontend communicates with a Rust backend via `invoke()` commands.

### Frontend → Backend Communication

React hooks in `src/hooks/` call Tauri commands defined in `src-tauri/src/lib.rs`. The Rust side coordinates several modules:

- **Beads (`bd`)** — issue tracking. `src-tauri/src/beads.rs` spawns the `bd` CLI, parses JSON output into `BeadsIssue` structs.
- **Tickets** — `src-tauri/src/tickets.rs` handles ticket operations and state management.
- **Agent sidecar** — AI workflow execution. `src-tauri/src/agent.rs` spawns a compiled Bun binary (`src/agent/`) that wraps `@anthropic-ai/claude-agent-sdk`. Communication is NDJSON over stdin/stdout.
- **Workflow** — `src-tauri/src/workflow.rs` manages workflow orchestration.
- **Claude status/login** — `src-tauri/src/claude.rs` handles auth status checks and login only (no longer does streaming).
- **Settings** — `src-tauri/src/settings.rs` handles app settings persistence.
- **Sync** — `src-tauri/src/sync/` module with `beads_adapter.rs` for syncing beads data.

Both `bd` and `claude` CLIs are discovered at runtime by searching common install paths (homebrew, ~/.local/bin, etc.).

### Agent Sidecar Architecture

The agent sidecar (`src/agent/`) is a separate TypeScript package compiled to a native binary via `bun build --compile`. It wraps the Claude Agent SDK and communicates with Rust via NDJSON:

```
React Frontend (tool cards, permission dialogs, thinking section)
    ↕ Tauri events (workflow-step-output, agent-permission-request)
Rust Backend (src-tauri/src/agent.rs)
    ↕ stdin/stdout NDJSON
Bun Sidecar (src/agent/main.ts → compiled binary)
    ├── ClaudeAgent class (wraps Agent SDK query())
    ├── Beads MCP Server (exposes bd as tools Claude can call)
    └── @anthropic-ai/claude-agent-sdk
```

Key files in `src/agent/`:
- `main.ts` — entry point, reads config from stdin, wires events to stdout
- `claude-agent.ts` — wraps `query()` with EventEmitter, handles `canUseTool` permissions
- `mcp/meldui-server.ts` — in-process MCP server with beads tools (uses `createSdkMcpServer`)
- `protocol.ts` — NDJSON message type definitions
- `build.ts` — compiles to `src-tauri/binaries/agent-{arch}-apple-darwin`

The sidecar is excluded from the frontend `tsc` build via `tsconfig.app.json` `"exclude": ["src/agent"]`.

### Type Sharing

Frontend TypeScript types in `src/types/index.ts` manually mirror the Rust serde structs. When adding fields, update both:
- Rust struct (with `#[serde(default)]` for optional fields)
- TypeScript interface

### Frontend Stack

- **React 19** with hooks-only state management (no Redux/Zustand)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no tailwind.config file — theme is in `src/index.css`)
- **shadcn** components (base-nova style, neutral base color) in `src/components/ui/`
- **@dnd-kit** for kanban drag-and-drop
- **Lucide React** for icons
- Path alias: `@/` → `src/`

### Shared Libraries (`src/lib/`)

- `query-client.ts` — TanStack Query client with staleTime/gcTime/retry defaults
- `invalidation.ts` — event-driven cache invalidation (Tauri events → query invalidation)
- `tauri-queries.ts` — helper utilities for Tauri invoke queries
- `tickets/` — ticket type definitions and helpers
- `sync/` — beads sync logic
- `utils.ts` — general utilities (cn, etc.)

### E2E Testing

WebdriverIO tests in `e2e/` with a mock sidecar (`e2e/mock-sidecar/`). Run `bun run e2e` which builds the mock sidecar then runs specs. Config: `e2e/wdio.conf.ts`.

### Tauri Plugins

- `tauri-plugin-dialog` — native folder picker
- `tauri-plugin-store` — persistent JSON storage (project directory selection)
- `tauri-plugin-shell` — CLI process spawning

## Key Patterns

**Beads parent-child relationships**: `bd list --json` doesn't return a `parent_id` field. Sub-tickets have a `dependencies` array with entries where `type === "parent-child"`. The Rust `list_issues()` function derives `parent_id` from this at fetch time.

**Hook pattern**: Each integration has a custom hook wrapping Tauri invoke calls via TanStack Query. Core hooks: `useTickets`, `useClaude`, `useProjectDir`, `useSettings`, `useDebugLog`, `useUpdater`. Workflow is split across `useWorkflow`, `useWorkflowStreaming`, `useWorkflowPermissions`, `useWorkflowFeedback`, `useWorkflowReview`, and `useWorkflowNotifications`.

**Agent permission flow**: When the agent needs permission for a dangerous tool (e.g., Bash outside project dir), the sidecar emits a `permission_request` on stdout → Rust emits `agent-permission-request` Tauri event → frontend shows inline dialog → user clicks Allow/Deny → frontend invokes `agent_permission_respond` → Rust writes response to sidecar stdin → `canUseTool` Promise resolves.

**Session continuity**: The agent's `session_id` is stored in ticket metadata (`agent_session_id`). When the next workflow step starts, the sidecar resumes the session so Claude retains context from prior steps.

**Kanban board**: Issues flow through `BacklogPage` → `KanbanColumn` → `KanbanCard`. Columns are defined statically in `backlog-page.tsx`. Cards are draggable between columns, which triggers status updates through beads.

**TanStack Query**: All Tauri `invoke()` calls go through `useQuery`/`useMutation` from `@tanstack/react-query`. Query client config is in `src/lib/query-client.ts`. Cache invalidation is event-driven via `src/lib/invalidation.ts` — Tauri events trigger targeted `queryClient.invalidateQueries()` calls.

**Error boundaries**: `react-error-boundary` wraps the app at two levels — `AppCrashFallback` in `src/main.tsx` (root) and `ViewErrorFallback` for per-view recovery. Components live in `src/components/error/`.

**Issue config maps**: `TYPE_CONFIG`, `PRIORITY_CONFIG`, and `STATUS_CONFIG` are defined in `ticket-constants.ts` (re-exported from `kanban-card.tsx`) and reused across components for consistent styling of issue types, priorities, and statuses.
