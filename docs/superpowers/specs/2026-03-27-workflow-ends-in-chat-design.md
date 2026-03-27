# Workflow Ends in Chat View

## Problem

When a workflow completes, MeldUI replaces the entire chat view with a centered "Workflow Complete" screen and a single "Back to Board" button. This forces the user out of context — they lose sight of the conversation, can't review changes inline, and can't ask follow-up questions before leaving.

## Solution

Stay in the chat view after workflow completion. Insert a completion divider into the chat stream (matching the existing step divider pattern), keep the chat input active for follow-up conversation with the agent, and replace the "Next Step →" floating button with a "Mark Complete" button.

## Scope

**In scope:**
- Remove the dedicated completion screen from `workflow-shell.tsx`
- Add completion divider to chat stream using `StepDividerBar` pattern
- Keep all three tabs (Chat / Changes / Commit) active after completion
- Enable follow-up chat messages that resume the agent session
- Replace "Next Step →" with "Mark Complete" floating button in same position
- Add a "Workflow Complete" entry to the WorkflowTab sidebar panel

**Out of scope:**
- Changes to the agent sidecar or Rust backend
- Changes to workflow step execution or advancement logic
- Auto-commit or auto-close behavior

## Design

### 1. WorkflowShell: Remove Completion Screen

**File:** `src/features/workflow/components/workflow-shell.tsx`

Currently, when `!currentStep`, WorkflowShell renders a dedicated completion screen (lines ~293-324). Replace this with the same tab-based view used during workflow execution:

- Render the tab bar (Chat / Changes / Commit) regardless of whether `currentStep` exists
- Pass a `workflowComplete` prop to `ChatView` so it knows to render the completion state
- The CompactWorkflowIndicator at the top already handles `currentStepId={null}` with all-green styling — no changes needed there

### 2. ChatView: Completion Divider

**File:** `src/features/workflow/components/views/chat-view.tsx`

After all history blocks and the final step's content, render a completion divider using the existing `StepDividerBar` component from `src/features/workflow/components/shared/step-divider.tsx`:

```tsx
<StepDividerBar label="All Workflow Steps Complete" stepId="workflow-complete" />
```

This uses the same line-label-line pattern as step transitions (`data-step-id` attribute for scroll navigation). The `stepId="workflow-complete"` allows the WorkflowTab to scroll to it.

**Styling enhancement:** The completion divider should use emerald accent color to distinguish it from regular step dividers. This can be done via an optional `variant` prop on `StepDividerBar` (e.g., `variant="complete"`) or a new `WorkflowCompleteDivider` wrapper that applies emerald styling.

### 3. ChatView: Mark Complete Button

**File:** `src/features/workflow/components/views/chat-view.tsx`

The existing "Next Step →" button renders when `stepStatus === "completed" && onAdvanceStep`:

```tsx
<div className="sticky bottom-0 flex justify-end pointer-events-none">
  <Button ...>Next Step <ArrowRight /></Button>
</div>
```

Add a parallel condition: when the workflow is complete (`workflowComplete` prop is true), render a "Mark Complete" button in the same sticky-bottom-right position:

```tsx
{workflowComplete && (
  <div className="sticky bottom-0 flex justify-end pointer-events-none">
    <Button
      size="sm"
      onClick={onMarkComplete}
      className="bg-emerald-500/50 hover:bg-emerald-600/50 border-emerald-500/50 border-1 shadow-sm shadow-emerald-600/20 text-white backdrop-blur-sm cursor-pointer pointer-events-auto"
    >
      <Check className="w-3.5 h-3.5 mr-1.5" />
      Mark Complete
    </Button>
  </div>
)}
```

Same emerald styling, same position, same size. Uses `Check` icon instead of `ArrowRight`. The `onMarkComplete` callback navigates back to the board (same as the current "Back to Board" behavior).

### 4. ChatView: Follow-up Messages

The existing `handleSend` → `onExecute(message)` → `executeStep(ticket.id, message)` pipeline already supports sending user messages to the agent with the workflow step context.

When the workflow is complete (`!currentStep`), the chat input should remain active. The `ComposeToolbar` is already rendered regardless of step status — we just need to ensure `onExecute` still works when there's no active step. The `executeStep` function in `use-workflow.ts` will need a small adjustment to handle the "no current step" case — it should still send the message to the agent using the same session, just without a step context.

The placeholder text in the input should change to "Ask a follow-up question..." when the workflow is complete.

### 5. WorkflowTab: Completion Entry

**File:** `src/shared/components/workflow-tab.tsx`

After the list of step buttons, add a completion entry when all steps are done:

```tsx
{!currentStepId && stepHistory.length === steps.length && (
  <button
    className="flex items-start gap-2 rounded-md px-3 py-2 text-left text-emerald-400"
    onClick={() => onStepClick("workflow-complete")}
  >
    <Check className="h-4 w-4 mt-0.5 shrink-0" />
    <div className="text-sm font-medium">Workflow Complete</div>
  </button>
)}
```

Clicking scrolls to the completion divider in the chat (using `data-step-id="workflow-complete"`).

### 6. Follow-up Execution (use-workflow.ts)

**File:** `src/features/workflow/hooks/use-workflow.ts`

`executeStep` currently requires a valid step to execute against. For post-completion follow-ups, we need to allow execution without a current step:

- When `workflowState.current_step_id` is null and a `userMessage` is provided, still call `commands.workflowExecuteStep` — the backend should route this to the agent session without step context
- The streaming infrastructure (`useWorkflowStreaming`) should work unchanged since it listens to the same Tauri events

If the Rust backend rejects execution without a current step, a minimal backend change may be needed to allow "free-form" messages to the agent session. This should be investigated during implementation.

## Data Flow

```
User types follow-up → ComposeToolbar.onSend
  → ChatView.handleSend(message) — injects UserMessageBubble
  → WorkflowShell.handleExecute(message)
  → executeStep(ticket.id, message) — sends to agent via existing pipeline
  → Agent responds → streaming events → contentBlocks update
  → ChatView re-renders with agent response below completion divider

User clicks "Mark Complete" → onMarkComplete callback
  → App.handleNavigateToBacklog() — same as current "Back to Board"
  → Clears active ticket, resets workflow, returns to backlog
```

## Files Changed

| File | Change |
|------|--------|
| `src/features/workflow/components/workflow-shell.tsx` | Remove completion screen, render tab view when `!currentStep`, pass `workflowComplete` prop |
| `src/features/workflow/components/views/chat-view.tsx` | Add completion divider, "Mark Complete" button, follow-up input placeholder |
| `src/features/workflow/components/shared/step-divider.tsx` | Add optional `variant="complete"` for emerald styling |
| `src/shared/components/workflow-tab.tsx` | Add "Workflow Complete" entry at bottom |
| `src/features/workflow/hooks/use-workflow.ts` | Allow `executeStep` when no current step (for follow-ups) |

## Testing

- Verify completion divider appears after final step completes
- Verify all three tabs remain accessible after completion
- Verify follow-up messages send to agent and responses render
- Verify "Mark Complete" button appears in correct position and navigates to board
- Verify WorkflowTab shows completion entry and scrolls to divider on click
- Verify step dividers for normal steps are visually distinct from completion divider
