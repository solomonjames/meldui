# Chat-First Workflow Redesign

## Problem

The current workflow system renders each step in a dedicated view component (ChatView, ProgressView, ReviewView, DiffReviewView, CommitView). This creates unnecessary visual context-switching between steps and locks diff viewing and committing behind specific workflow steps. Some workflows (brainstorming, research) don't need diffs or commits at all, yet the architecture assumes every workflow follows the same step-to-view mapping.

## Solution

Unify all workflow steps into a single chat-based timeline. Make diff viewing and committing always-available tab features rather than discrete workflow steps. Move workflow navigation to the right panel and replace the top StageBar with a compact inline indicator.

## Layout

### Current
```
┌──────────┬──────────────────────────────┬──────────────┐
│          │  StageBar (step pills + auto)│              │
│  Left    ├──────────────────────────────┤  Right Panel │
│  Sidebar │                              │  (Ticket     │
│          │  View (chat/progress/review/ │   details)   │
│          │        diff/commit)          │              │
└──────────┴──────────────────────────────┴──────────────┘
```

### New
```
┌──────────┬──────────────────────────────┬──────────────────┐
│          │  Chat | Changes | Commit     │ Ticket | Workflow │
│  Left    ├──────────────────────────────┤                  │
│  Sidebar │                              │  (content based  │
│          │  Tab content area            │   on active tab) │
│          │                              │                  │
│          ├──────────────────────────────┤                  │
│          │  [●●●○○○ step [3/6] | auto] │                  │
│          │  [chat input .............. ]│                  │
└──────────┴──────────────────────────────┴──────────────────┘
```

Key structural changes:
- Right panel extends to the top of the window (same vertical start as the content tabs)
- StageBar removed — replaced by compact indicator and Workflow tab
- ResizablePanelGroup starts at the very top of the content area
- Right panel only visible on ticket/workflow pages (not kanban board)
- Default split remains ~70/30, still resizable and collapsible

## Chat Tab (Unified Step Renderer)

The Chat tab renders all workflow steps in a single scrollable timeline, replacing ChatView, ProgressView, and ReviewView.

### Timeline content
- **Step dividers** — visual separators between steps showing step name and timestamp. These are scroll anchors targeted by the Workflow tab.
- **Content blocks** — text, tool groups, subagent activities (unchanged from current ChatView)
- **Thinking sections** — collapsible thinking indicator
- **Permission dialogs** — inline (unchanged)
- **Files changed summary** — inline after tool activity
- **Step complete card** — appears when a step finishes. Shows "Continue Chatting" and "Next Step" buttons when auto-advance is off.

### Chat input behavior
- **Interactive steps** (view type `chat` in workflow YAML): input is always active
- **Hands-off steps** (view type `progress`): input disabled while running, enabled after completion for follow-up questions
- **No workflow active**: input is always active (freeform chat)

## Changes Tab

Absorbs the current DiffReviewView functionality. Available at any time, not gated by workflow step.

### Content
- File diff list with syntax-highlighted diffs
- Inline comments on specific lines (with optional suggestions)
- Review findings (critical/warning/info) when the agent triggers a review flow
- Finding actions (fix/accept/dismiss) per finding
- Approve / Request Changes buttons for submitting review back to agent

### States
- **Changes exist**: shows diffs, optionally with review findings
- **No changes**: empty state — "No changes yet"

### Key difference from current
Diffs are accessible at any time (e.g., mid-implementation) rather than only during a dedicated review step. Review findings still only appear when the agent sends `agentReviewFindingsRequest`.

## Commit Tab

Absorbs the current CommitView functionality. Available at any time, not gated by workflow step.

### Content
- Stat cards (files changed, lines added/removed)
- Editable commit message (auto-populated by agent when available, or user-written)
- Expandable file list with per-file changes
- Action buttons: "Commit Only" and "Create Pull Request"
- Worktree cleanup option (when applicable)
- Success/error states

### States
- **Changes exist**: full commit interface
- **No changes**: empty state — "Nothing to commit"

## Right Panel

### Ticket Tab
Unchanged from current TicketDetailsPanel:
- Metadata (status, priority, type, dates, subtask progress)
- Dynamic sections from workflow definition (description, design, acceptance criteria, implementation tasks, notes)
- Comments section
- Collapsible accordion behavior

### Workflow Tab (new)
Replaces StageBar as the primary workflow navigation.

- Vertical step list showing all workflow steps
- Each step displays:
  - Status icon: ✓ (completed), ● (current), ○ (pending)
  - Step name
  - Step description (from workflow YAML)
  - Completion time (for completed steps)
- Completed steps are clickable — clicking scrolls the chat timeline to that step's divider
- Current step has distinct background/border highlight
- When no workflow is assigned: prompt to select a workflow

### Panel behavior
- Resizable drag handle between main content and right panel
- Collapsible via toggle button
- Default ~70/30 split
- Remembers last active tab

## Compact Workflow Indicator

A pill-shaped element centered above the chat input. Only visible when a workflow is active.

### Contents (left to right)
- Progress dots: filled (green) = completed, hollow = uncompleted (current + future)
- Current step name
- Step count in brackets: `[3/6]`
- Vertical divider
- "auto" label + toggle switch

### States
- **Workflow active**: indicator visible with current progress
- **No workflow**: indicator hidden, just the bare chat input
- **Step complete (auto off)**: step complete card appears above the indicator

### Optional enhancement
Clicking the indicator switches the right panel to the Workflow tab.

## Workflow YAML Compatibility

No structural changes to workflow definition files. The `view` field on each step (`chat`, `progress`, `review`, `diff_review`, `commit`) is reinterpreted:

- `chat` → interactive step (chat input active during execution)
- `progress` → hands-off step (chat input disabled during execution, enabled after)
- `review` → interactive step (same as chat, content renders in timeline)
- `diff_review` → triggers review findings flow (populates Changes tab)
- `commit` → triggers commit flow (populates Commit tab)

The `view` field becomes a behavioral hint rather than a component selector.

## Components Removed

| Component | File | Replacement |
|-----------|------|-------------|
| StageBar | `src/features/workflow/components/stage-bar.tsx` | Compact indicator + Workflow tab |
| ProgressView | `src/features/workflow/components/views/progress-view.tsx` | Chat tab (unified timeline) |
| ReviewView | `src/features/workflow/components/views/review-view.tsx` | Chat tab + Workflow tab navigation |
| DiffReviewView | `src/features/workflow/components/views/diff-review-view.tsx` | Changes tab |
| CommitView | `src/features/workflow/components/views/commit-view.tsx` | Commit tab |

## Components Refactored

| Component | Change |
|-----------|--------|
| WorkflowShell | No longer switches between views. Becomes tab container (Chat \| Changes \| Commit) with compact indicator in footer. |
| ChatView | Becomes universal step renderer. Absorbs ProgressView streaming display. Handles both interactive and hands-off steps. |
| TicketDetailsPanel | Gains tab bar (Ticket \| Workflow) and new Workflow tab component. |
| ticket-page.tsx | ResizablePanelGroup restructured so right panel extends to window top. |

## New Components

| Component | Purpose |
|-----------|---------|
| CompactWorkflowIndicator | Pill-shaped progress dots + step name + count + auto toggle |
| WorkflowTab | Vertical step list with click-to-scroll, lives in right panel |
| ChangesTab | Absorbs DiffReviewView: file diffs, inline comments, review findings |
| CommitTab | Absorbs CommitView: commit message, file list, push/PR actions |

## Type Changes

`StepViewType` remains as-is (`"chat" | "review" | "progress" | "diff_review" | "commit"`) but its role changes from component selector to behavioral hint controlling:
- Whether chat input is active during step execution
- Whether the step triggers review findings or commit flows

## Backend Impact

None. This is a frontend-only restructure. The Rust backend, agent sidecar, workflow state machine, and JSON-RPC protocol remain unchanged.
