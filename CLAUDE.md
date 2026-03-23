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
bun run lint                        # Biome (lint)
bun run lint:fix                    # Biome (lint + auto-fix)
bun run format:check                # Biome (format check)
bun run format                      # Biome (format + write)

# Dead code detection
bun run knip                        # Find unused files/exports/deps

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

### Frontend Directory Structure

The frontend uses a 3-layer feature-based architecture:

```
src/
  app/                    # App shell & entry points (composition root)
    App.tsx               # Central orchestrator — imports from features/ and shared/
    main.tsx              # Root entry, error boundary, theme
    welcome-screen.tsx    # First-launch / no-project view
  features/
    tickets/              # Kanban board, ticket CRUD
      components/         # BacklogPage, KanbanCard, KanbanColumn, etc.
      hooks/              # useTickets
      constants.ts        # TYPE_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG
    workflow/             # Agent execution, step views
      components/         # WorkflowShell, StageBar, DebugPanel
        shared/           # Workflow-internal shared (ToolCard, ActivityBar, etc.)
        views/            # ChatView, ProgressView, ReviewView, etc.
      hooks/              # useWorkflow, useWorkflowStreaming, etc.
      context.tsx         # WorkflowProvider + useWorkflowContext
    settings/             # Project-level settings
      components/         # SettingsPage
      hooks/              # useSettings
    preferences/          # App-level preferences (separate window)
      components/         # PreferencesApp, AppearanceSection
  shared/
    ui/                   # shadcn components (unchanged)
    components/           # Cross-feature components (diff/, error/, sections/, chat/)
    layout/               # AppLayout, AppSidebar, StatusBar
    hooks/                # useClaude, useDebugLog, useProjectDir, useTheme, useUpdater
    lib/                  # query-client, invalidation, query-keys, utils, sync/, tickets/
    types/                # Central type hub (mirrors Rust serde structs)
    test/                 # Test helpers and mocks
  agent/                  # Separate sidecar build (excluded from frontend tsc)
  index.css               # Global stylesheet
```

**Architecture rules:**
1. **features/ never import from other features/** — cross-feature data flows through TanStack Query cache or Tauri events
2. **shared/ never imports from features/ or app/** — shared is the lowest layer
3. **app/ CAN import from features/ and shared/** — it's the composition root
4. **All imports use `@/` absolute paths** — no relative imports for project files (node_modules exempt)

### Frontend → Backend Communication

React hooks in `src/features/*/hooks/` and `src/shared/hooks/` call Tauri commands defined in `src-tauri/src/lib.rs`. The Rust side coordinates several modules:

- **Beads (`bd`)** — issue tracking. `src-tauri/src/beads.rs` spawns the `bd` CLI, parses JSON output into `BeadsIssue` structs.
- **Tickets** — `src-tauri/src/tickets.rs` handles ticket operations and state management.
- **Agent sidecar** — AI workflow execution. `src-tauri/src/agent.rs` spawns a compiled Bun binary (`src/agent/`) that wraps `@anthropic-ai/claude-agent-sdk`. Communication is JSON-RPC 2.0 over a Unix domain socket.
- **Workflow** — `src-tauri/src/workflow.rs` manages workflow orchestration.
- **Claude status/login** — `src-tauri/src/claude.rs` handles auth status checks and login only (no longer does streaming).
- **Settings** — `src-tauri/src/settings.rs` handles app settings persistence.
- **Sync** — `src-tauri/src/sync/` module with `beads_adapter.rs` for syncing beads data.

Both `bd` and `claude` CLIs are discovered at runtime by searching common install paths (homebrew, ~/.local/bin, etc.).

### Agent Sidecar Architecture

The agent sidecar (`src/agent/`) is a separate TypeScript package compiled to a native binary via `bun build --compile`. It wraps the Claude Agent SDK and communicates with Rust via JSON-RPC 2.0 over a Unix domain socket:

```
React Frontend (tool cards, permission dialogs, thinking section)
    ↕ Tauri events (StreamChunk, AgentPermissionRequest — PascalCase struct names via tauri-specta)
Rust Backend (src-tauri/src/agent.rs)
    ↕ Unix socket + JSON-RPC 2.0
Bun Sidecar (src/agent/main.ts → compiled binary)
    ├── ClaudeAgent class (wraps Agent SDK query())
    ├── Beads MCP Server (exposes bd as tools Claude can call)
    └── @anthropic-ai/claude-agent-sdk
```

The sidecar creates a Unix socket server on startup, announces `SOCKET_PATH=<path>` on stdout, and Rust connects as a client. Both sides act as simultaneous JSON-RPC client and server, enabling true bidirectional request/response for permissions, feedback, and review flows.

Key files in `src/agent/`:
- `main.ts` — entry point, creates Unix socket server, handles JSON-RPC methods
- `claude-agent.ts` — wraps `query()` with EventEmitter, handles `canUseTool` permissions
- `mcp/meldui-server.ts` — in-process MCP server with beads tools (uses `createSdkMcpServer`)
- `protocol.ts` — JSON-RPC method names, typed params/results for each RPC method
- `build.ts` — compiles to `src-tauri/binaries/agent-{arch}-apple-darwin`

The sidecar is excluded from the frontend `tsc` build via `tsconfig.app.json` `"exclude": ["src/agent"]`.

### Type Sharing

`src/bindings.ts` is **auto-generated** by tauri-specta when `bun run tauri:dev` runs. Do not edit it manually. It provides typed `commands.*()` and `events.*.listen()` wrappers and re-exports all IPC types.

`src/shared/types/index.ts` still contains manually-maintained types used by UI components. When adding new Rust types that cross the IPC boundary:
1. Add `specta::Type` derive to the Rust struct (and `tauri_specta::Event` for event structs)
2. Run `bun run tauri:dev` to regenerate `src/bindings.ts`
3. Update `src/shared/types/index.ts` only if UI components need narrower types (e.g., string unions vs `string`)

**specta limitations**: `usize`/`isize` fields cause `BigIntForbidden` panics at startup — use `u32`/`i32` instead. The `specta`, `specta-typescript`, and `tauri-specta` crates use exact version pinning (`=x.y.z`) because they are RC releases with breaking changes between versions.

### Frontend Stack

- **React 19** with hooks-only state management (no Redux/Zustand)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no tailwind.config file — theme is in `src/index.css`)
- **shadcn** components (base-nova style, neutral base color) in `src/shared/ui/`
- **@dnd-kit** for kanban drag-and-drop
- **Lucide React** for icons
- Path alias: `@/` → `src/`

### Shared Libraries (`src/shared/lib/`)

- `query-client.ts` — TanStack Query client with staleTime/gcTime/retry defaults
- `invalidation.ts` — event-driven cache invalidation (Tauri events → query invalidation)
- `query-keys.ts` — shared query key factories (ticketKeys) used by both features and invalidation
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

**Hook pattern**: Each integration has a custom hook wrapping Tauri invoke calls via TanStack Query. Feature hooks live in `src/features/*/hooks/`, shared hooks in `src/shared/hooks/`. Workflow is split across `useWorkflow`, `useWorkflowStreaming`, `useWorkflowPermissions`, `useWorkflowReview`, and `useWorkflowNotifications`.

**Agent permission flow**: When the agent needs permission for a dangerous tool (e.g., Bash outside project dir), the sidecar emits a `permission_request` on stdout → Rust emits `agent-permission-request` Tauri event → frontend shows inline dialog → user clicks Allow/Deny → frontend invokes `agent_permission_respond` → Rust writes response to sidecar stdin → `canUseTool` Promise resolves.

**Session continuity**: The agent's `session_id` is stored in ticket metadata (`agent_session_id`). When the next workflow step starts, the sidecar resumes the session so Claude retains context from prior steps.

**Kanban board**: Issues flow through `BacklogPage` → `KanbanColumn` → `KanbanCard`. Columns are defined statically in `backlog-page.tsx`. Cards are draggable between columns, which triggers status updates through beads.

**TanStack Query**: All Tauri `invoke()` calls go through `useQuery`/`useMutation` from `@tanstack/react-query`. Query client config is in `src/shared/lib/query-client.ts`. Cache invalidation is event-driven via `src/shared/lib/invalidation.ts` — Tauri events trigger targeted `queryClient.invalidateQueries()` calls.

**Error boundaries**: `react-error-boundary` wraps the app at two levels — `AppCrashFallback` in `src/app/main.tsx` (root) and `ViewErrorFallback` for per-view recovery. Components live in `src/shared/components/error/`.

**Issue config maps**: `TYPE_CONFIG`, `PRIORITY_CONFIG`, and `STATUS_CONFIG` are defined in `src/features/tickets/constants.ts` (re-exported from `kanban-card.tsx`) and reused across ticket components for consistent styling of issue types, priorities, and statuses.

**Pre-commit hook**: Lefthook runs `biome check` on staged files, `tsc --noEmit` for type checking, and `cargo fmt --check` for Rust files. Runs automatically on commit. Install with `bunx lefthook install` (also runs via `prepare` script on `bun install`).
