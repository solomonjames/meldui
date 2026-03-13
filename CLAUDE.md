# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (frontend + Tauri together)
bun run tauri:dev

# Frontend only (Vite dev server on :5173)
bun run dev

# Build native binary
bun run tauri:build

# Type checking
npx tsc --noEmit                    # Frontend
cd src-tauri && cargo check          # Rust

# Lint
bun run lint

# Rust formatting
cd src-tauri && cargo fmt -- --check
```

Package manager is **bun** (not npm/yarn).

## Architecture

MeldUI is a **Tauri v2** desktop app: a React frontend communicates with a Rust backend via `invoke()` commands.

### Frontend → Backend Communication

React hooks in `src/hooks/` call Tauri commands defined in `src-tauri/src/lib.rs`. The Rust side wraps two external CLIs:

- **Beads (`bd`)** — issue tracking. `src-tauri/src/beads.rs` spawns the `bd` CLI, parses JSON output into `BeadsIssue` structs.
- **Claude (`claude`)** — AI assistant. `src-tauri/src/claude.rs` spawns `claude --print --output-format stream-json`, parses streaming NDJSON.

Both CLIs are discovered at runtime by searching common install paths (homebrew, ~/.local/bin, etc.) — they are not bundled.

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

### Tauri Plugins

- `tauri-plugin-dialog` — native folder picker
- `tauri-plugin-store` — persistent JSON storage (project directory selection)
- `tauri-plugin-shell` — CLI process spawning

## Key Patterns

**Beads parent-child relationships**: `bd list --json` doesn't return a `parent_id` field. Sub-tickets have a `dependencies` array with entries where `type === "parent-child"`. The Rust `list_issues()` function derives `parent_id` from this at fetch time.

**Hook pattern**: Each integration has a custom hook (`useBeads`, `useClaude`, `useProjectDir`) that wraps Tauri invoke calls and manages loading/error state.

**Kanban board**: Issues flow through `BacklogPage` → `KanbanColumn` → `KanbanCard`. Column assignment is derived from status via `getColumnForStatus()`. Cards are draggable between columns, which triggers status updates through beads.

**Issue config maps**: `TYPE_CONFIG` and `PRIORITY_CONFIG` are exported from `kanban-card.tsx` and reused across components for consistent styling of issue types and priorities.
