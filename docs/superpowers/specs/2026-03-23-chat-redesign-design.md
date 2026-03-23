# Chat Redesign — Full Overhaul

**Date:** 2026-03-23
**Status:** Approved
**Mockup:** `.superpowers/brainstorm/8130-1774298140/chat-redesign-overview.html`

## Problem

MeldUI's chat window is functional but basic. The compose area is a plain textarea + send button with no controls. Tool cards lack icons, timing, and clear status. The agent exposes 22 SDK message types but the sidecar only forwards ~12. Users have no visibility into context window usage, available skills/commands, or agent configuration. No support for file attachments or @mentions.

## Solution

A four-phase overhaul of the chat experience covering the compose area, message display, input features, and agent metadata surfacing.

## Architecture

The data flows bottom-up: Claude Agent SDK → Sidecar (JSON-RPC) → Rust (Tauri commands/events) → React (TanStack Query + hooks) → UI components.

New data from the SDK that needs to flow through this pipeline:
- Init metadata: `model`, `tools[]`, `slash_commands[]`, `skills[]`, `mcp_servers[]`
- Runtime config: model, thinking, effort, fast mode (bidirectional — UI can set these)
- Context/usage: `compact_boundary.pre_tokens`, `rate_limit_event`, `SDKResultMessage.usage/modelUsage`
- User message content blocks: text + image attachments (currently text-only)

---

## Phase 1: Compose Area + Sidecar Init Metadata

### Sidecar Changes

**New init metadata forwarding:**

The `query()` function from the SDK returns a `Query` instance. This object exposes methods for accessing session metadata and modifying runtime configuration. After the first `SDKSystemMessage` (type `"system"`, subtype `"init"`) is received from the async iterable, the sidecar extracts the init fields directly from that message and sends a JSON-RPC notification:

```
method: "agent/init_metadata"
params: {
  model: string,
  available_models: string[],
  tools: string[],
  slash_commands: string[],
  skills: string[],
  mcp_servers: { name: string, status: string }[]
}
```

The `model` field comes from `SDKSystemMessage.model`. The `available_models` list is hardcoded to `["opus-1m", "opus", "sonnet", "haiku"]` (the models the SDK supports). The `slash_commands` come from `SDKSystemMessage.slash_commands` (names only — descriptions are matched client-side from a static map). The `skills` come from `SDKSystemMessage.skills`. The `tools` and `mcp_servers` come directly from the init message fields.

**New runtime configuration methods (frontend → sidecar):**

| JSON-RPC Method | Params | SDK Call | When Applied |
|---|---|---|---|
| `agent/set_model` | `{ model: string }` | `query.setModel(model)` | Immediately (mid-session) |
| `agent/set_thinking` | `{ type: 'adaptive'\|'enabled'\|'disabled', budgetTokens?: number }` | Stored in sidecar config, passed to next `query()` call | Next workflow step (not mid-session) |
| `agent/set_effort` | `{ effort: 'low'\|'medium'\|'high'\|'max' }` | Stored in sidecar config, passed to next `query()` call | Next workflow step (not mid-session) |
| `agent/set_fast_mode` | `{ enabled: boolean }` | Stored in sidecar config, passed to next `query()` call | Next workflow step (not mid-session) |

**Important:** Only `set_model` takes effect immediately via `query.setModel()`. The other three (thinking, effort, fast mode) are stored in the sidecar's config state and applied when the next `query()` is constructed for a new workflow step. The UI should indicate this distinction — e.g., a subtle "(next step)" label on the tooltip for thinking/effort/fast mode when changed mid-session.

### Rust Changes

- New Tauri event: `agent-init-metadata` (emitted when sidecar sends init metadata)
- New Tauri commands: `agent_set_model`, `agent_set_thinking`, `agent_set_effort`, `agent_set_fast_mode` — each writes to the sidecar's JSON-RPC socket
- Store current agent config in `AgentState` so it persists across the session

### Frontend Changes

**New hook: `useAgentConfig`**
- Listens for `agent-init-metadata` event
- Caches in TanStack Query (key: `['agent', 'config']`)
- Exposes: `model`, `availableModels` (from init's `available_models`), `thinking`, `effort`, `fastMode`
- Mutations for `setModel`, `setThinking`, `setEffort`, `setFastMode` that invoke Tauri commands

**Compose toolbar (inside input border, below textarea):**

```
[🟠 Opus 4.6 ▼] [🧠 Adaptive ▼] [⚡ High ▼] [Fast] ————— [📎] [→ Send]
```

Four pill controls in a horizontal row:

| Control | Default | Visual | Interaction |
|---|---|---|---|
| Model | From init | `model-dot` color + name + chevron | Click → dropdown with available models |
| Thinking | Adaptive | Brain icon + mode label, purple accent | Click → dropdown: Adaptive, Enabled, Disabled |
| Effort | High | `Gauge` icon + level, green accent | Click → dropdown: Low, Medium, High, Max |
| Fast mode | Off | `Zap` icon, amber when on | Click → toggle on/off |

All pills: `bg-secondary border border-border rounded-md px-2 py-0.5 text-xs cursor-pointer hover:bg-accent`. Each has a shadcn `Tooltip` on hover explaining what it does.

Dropdowns use shadcn `DropdownMenu` positioned above the pill.

---

## Phase 2: Tool Cards Overhaul

Pure frontend — no sidecar or Rust changes. Uses existing `StreamChunk` data.

### Tool Icon Map

New constant `TOOL_ICONS` in `src/features/workflow/constants.ts`:

| Tool Name Pattern | Lucide Icon |
|---|---|
| `Read`, `FileRead` | `FileText` |
| `Bash`, `BashOutput` | `Terminal` |
| `Edit`, `FileEdit`, `MultiEdit` | `FilePen` |
| `Write`, `FileWrite` | `FilePlus` |
| `Grep` | `Search` |
| `Glob` | `FileSearch` |
| `WebSearch`, `WebFetch` | `Globe` |
| `Agent`, `Task*` | `Bot` |
| `Skill` | `Sparkles` |
| `TodoWrite`, `TodoRead` | `ListChecks` |
| `NotebookEdit` | `BookOpen` |
| `mcp__*` | `Wrench` |
| Fallback | `Cog` |

### Tool Card Component

Single row layout:

```
[icon 14px] [tool-name mono] [detail-text truncated] ——— [0.3s] [●]
```

- **Detail text**: contextual per tool type — file path for file ops, command for Bash, pattern for search, URL for web. Extracted from tool input JSON.
- **Timer**: while running, updated from `tool_progress` events (`elapsed_time_seconds`). On completion (`tool_end` chunk), the timer freezes at the last `tool_progress` value. Format: `0.3s` (complete) or `1.2s...` (running, with trailing ellipsis). `font-variant-numeric: tabular-nums`.
- **Status dot**: 6px circle. Green (`bg-emerald-500`) = success, red (`bg-destructive`) = error, pulsing amber (`bg-amber-500 animate-pulse`) = running.
- **Error state**: card gets `bg-destructive/5`, tool name turns red, result shows in red-bordered collapsible.

### Tool Group (ActivityGroup)

- Auto-generated summary (current behavior) overridden by `tool_use_summary` text when available
- Collapsed by default, auto-expanded when active (has running tools)
- Header: `[summary text] ——— [count badge] [chevron]`
- Click to toggle expand/collapse

### Thinking Block

Separate component (not inside tool groups):
- `border-l-2 border-purple-500/30` left accent
- Header: `[Brain icon] Thinking [duration] [chevron]`
- Collapsed by default, click to expand
- Purple color scheme (`text-purple-400`)

### Subagent Card

- Header: `[Bot icon] Subagent [description] ——— [timer]`
- Animated indeterminate progress bar when running
- Token count badge
- Collapsed result when complete

---

## Phase 3: Slash Commands + Skills Menus

### Sidecar Changes

None — Phase 1's `agent/init_metadata` already includes `slash_commands` and `skills` arrays. Command descriptions are not available from the SDK init message (only names), so the frontend maintains a static description map for known commands. Unknown commands show no description.

### Frontend Changes

**Shared `AutocompleteMenu` component** (`src/shared/components/chat/autocomplete-menu.tsx`):

Props:
```typescript
interface AutocompleteMenuProps {
  trigger: string           // '/' or '#' or '@'
  items: AutocompleteItem[]
  onSelect: (item: AutocompleteItem) => void
  isOpen: boolean
  filter: string
  onClose: () => void
}

interface AutocompleteItem {
  name: string
  description?: string
  icon?: LucideIcon
  category?: string        // For section grouping
  accentColor?: string     // e.g., 'purple' for skills
}
```

Behavior:
- Positioned above textarea via portal
- Max 8 visible items with scroll
- Fuzzy filter on name as user types after trigger char
- Arrow keys navigate, Enter selects, Escape dismisses
- Sections grouped by `category`

**`/` Commands menu:**

- Triggered when `/` is typed as first char or after whitespace
- Items sourced from `useAgentConfig().slashCommands`
- Icon map: `commit` → `GitCommit`, `review-pr` → `GitPullRequest`, `compact` → `Minimize2`, fallback → `Slash`
- Selecting replaces the trigger + typed chars with the full command

**`#` Skills menu:**

- Triggered when `#` is typed as first char or after whitespace
- Items sourced from `useAgentConfig().skills`
- All items use `Sparkles` icon in purple (`text-purple-400`)
- Section header: "Skills"
- Selecting inserts `#skill-name`

---

## Phase 4: @Mentions, Attachments, Context Indicator

### @File Mentions

- Triggered when `@` typed in input
- File list: new Tauri command `list_project_files` that uses `ignore::WalkBuilder` (respects .gitignore) to walk the project directory, returning relative paths. Limited to 1000 results, sorted alphabetically. Called once when the compose area mounts and cached in TanStack Query (key: `['project', 'files']`, staleTime: 30s). Subsequent `@` triggers use the cached list with client-side fuzzy filtering. Files deeper than 6 directories are excluded to keep results manageable in large repos.
- Uses same `AutocompleteMenu` component, trigger `@`
- Items: `[FileText] [relative/path]`
- Selecting inserts file path as styled inline chip in the textarea (visually distinct, monospace, `bg-secondary` badge)
- Sent to agent as plain text file path in the message content

### File Attachments

**Compose area:**
- Paperclip button in toolbar opens native file picker via `tauri-plugin-dialog`
- Keyboard shortcut: Cmd+U
- Accepted: images (png, jpg, gif, webp), text files
- Max 5 attachments per message
- Attached files render as removable chips between textarea and toolbar:
  ```
  [📄 auth-spec.png ×] [📄 notes.txt ×]
  ```

**Sidecar changes:**
- `agent/send_message` JSON-RPC method accepts content blocks array (not just plain text string):
  ```typescript
  params: {
    content: Array<
      | { type: 'text', text: string }
      | { type: 'image', source: { type: 'base64', media_type: string, data: string } }
    >
  }
  ```
- Sidecar constructs `SDKUserMessage` with mixed content blocks

**Rust changes:**
- Read file, base64-encode images, pass as content blocks to sidecar
- Validate file size (max 5MB per image) and type before sending

### Context Window Indicator

**Sidecar changes — forward new events:**

| SDK Event | JSON-RPC Notification | Key Fields |
|---|---|---|
| `compact_boundary` | `agent/compact_boundary` | `pre_tokens`, `trigger` |
| `rate_limit_event` | `agent/rate_limit` | `status`, `utilization`, `resetsAt` |
| `SDKResultMessage` | Extend existing `agent/result` | `usage`, `modelUsage`, `total_cost_usd`, `duration_ms` |

**Rust changes:**
- New `chunk_type` string values for `StreamChunk`: `"compact_boundary"`, `"rate_limit"` (the existing `StreamChunk` struct uses stringly-typed `chunk_type` with JSON-encoded `content`, so no struct changes needed — just new type values and their corresponding JSON payloads)
- Note: the existing `"compacting"` chunk_type (boolean is-compacting status) is retained for the activity bar's "Compacting..." indicator. The new `"compact_boundary"` is a distinct event that carries token count data for the context indicator. They serve different purposes.
- Aggregate usage state in `AgentState`: total tokens, context limit, cost, rate limit info
- New Tauri command: `get_context_usage` returns current aggregated state

**Frontend — `ContextIndicator` component:**

Location: compose toolbar, between fast mode toggle and paperclip button.

Visual: 20px SVG radial progress ring + percentage text.

Color thresholds:
- < 50%: default (`text-muted-foreground`)
- 50-69%: default (hidden in threshold mode)
- 70-89%: amber (`text-amber-500`)
- ≥ 90%: red (`text-destructive`)

Hover popover (shadcn `HoverCard`):
```
Context Window
━━━━━━━━━━━━━━━━━━━━━
Used          156,000 tokens
Limit         200,000
Available      44,000
───────────────────────
Input tokens  120,400
Output tokens  35,600
Cache reads    82,100
───────────────────────
Cost          $0.42
Rate limit    72% utilized
```

**Global preference:**

New preference `contextIndicatorVisibility`:
- `'threshold'` (default) — visible at ≥70%
- `'always'` — always visible
- `'never'` — never visible

Added to Preferences window → Appearance section as a labeled select/radio group: "Context indicator: Show at threshold (70%) / Always show / Never show"

Stored via `tauri-plugin-store` alongside existing preferences.

---

## Files Affected (by phase)

### Phase 1
- `src/agent/claude-agent.ts` — extract init metadata from `SDKSystemMessage` (init event), forward via JSON-RPC notification
- `src/agent/main.ts` — handle new JSON-RPC methods for set_model/thinking/effort/fast
- `src/agent/protocol.ts` — new method names and param types
- `src-tauri/src/agent.rs` — new commands, events, state storage
- `src/features/workflow/hooks/use-agent-config.ts` — new hook
- `src/features/workflow/components/views/chat-view.tsx` — new compose toolbar
- `src/features/workflow/components/shared/compose-toolbar.tsx` — new component
- `src/bindings.ts` — regenerated

### Phase 2
- `src/features/workflow/constants.ts` — TOOL_ICONS map
- `src/features/workflow/components/shared/tool-card.tsx` — redesigned
- `src/features/workflow/components/shared/activity-group.tsx` — updated grouping
- `src/features/workflow/components/shared/thinking-block.tsx` — new component
- `src/features/workflow/components/shared/subagent-card.tsx` — new component

### Phase 3
- `src/shared/components/chat/autocomplete-menu.tsx` — new shared component
- `src/features/workflow/components/views/chat-view.tsx` — integrate autocomplete
- `src/features/workflow/constants.ts` — command icon map

### Phase 4
- `src/agent/main.ts` — accept content blocks in send_message
- `src/agent/protocol.ts` — content block types
- `src-tauri/src/agent.rs` — file reading, base64 encoding, new chunk types
- `src/features/workflow/components/shared/compose-toolbar.tsx` — attachment button, context indicator
- `src/features/workflow/components/shared/context-indicator.tsx` — new component
- `src/features/workflow/components/shared/file-mention.tsx` — new component
- `src/features/preferences/components/preferences-app.tsx` — add context indicator visibility control to Appearance section

---

## Out of Scope

- Turn-based message grouping (future iteration)
- Command palette / Cmd+K (future iteration)
- Keyboard shortcuts for controls (Alt+T, Alt+P, etc.) (future iteration)
- Session management / conversation history browser
- Multi-model conversations (using different models simultaneously in a single turn)
- MCP server management UI
