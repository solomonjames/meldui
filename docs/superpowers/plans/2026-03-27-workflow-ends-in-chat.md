# Workflow Ends in Chat View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dedicated "Workflow Complete" screen with the chat view, keeping all tabs active and enabling follow-up conversation with the agent after workflow completion.

**Architecture:** Remove the early-return completion screen in WorkflowShell and instead pass a `workflowComplete` flag through to ChatView. ChatView renders a completion divider (reusing StepDividerBar with emerald styling) and swaps the "Next Step" button for "Mark Complete". The Rust backend's `execute_step` gains a `workflow_complete` code path that sends follow-up messages to the agent without requiring a current step.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Rust (Tauri v2)

---

### Task 1: Add `variant` prop to StepDividerBar

**Files:**
- Modify: `src/features/workflow/components/shared/step-divider.tsx:1-16`

The completion divider needs emerald accent styling to distinguish it from regular step dividers. Add an optional `variant` prop.

- [ ] **Step 1: Update StepDividerBar component**

Replace the entire file content:

```tsx
interface StepDividerProps {
  label: string;
  stepId?: string;
  variant?: "default" | "complete";
}

export function StepDividerBar({ label, stepId, variant = "default" }: StepDividerProps) {
  const isComplete = variant === "complete";
  return (
    <div className="flex items-center gap-3 py-3" data-step-id={stepId}>
      <div
        className={`h-px flex-1 ${isComplete ? "bg-emerald-500/30" : "bg-border"}`}
      />
      <span
        className={`text-xs font-medium uppercase tracking-wider ${
          isComplete
            ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <div
        className={`h-px flex-1 ${isComplete ? "bg-emerald-500/30" : "bg-border"}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors (existing callers don't pass `variant`, so they get `"default"` automatically)

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/components/shared/step-divider.tsx
git commit -m "feat: add variant prop to StepDividerBar for completion styling"
```

---

### Task 2: Add "Workflow Complete" entry to WorkflowTab sidebar

**Files:**
- Modify: `src/shared/components/workflow-tab.tsx:1-72`

Add a completion entry at the bottom of the step list when all steps are done and there's no current step.

- [ ] **Step 1: Update WorkflowTab component**

Add the completion entry after the `steps.map()` block. Import `CheckCheck` icon for a distinctive completion icon (differentiates from the per-step `Check`).

At the top of the file, add `CheckCheck` to the import:

```tsx
import { Check, CheckCheck, Circle, CircleDot } from "lucide-react";
```

Inside the `return` block, after the closing `})}` of `steps.map()` (line 69), before the closing `</div>` (line 70), add:

```tsx
      {!currentStepId && stepHistory.length === steps.length && steps.length > 0 && (
        <button
          type="button"
          onClick={() => onStepClick("workflow-complete")}
          className="flex items-start gap-2 rounded-md px-3 py-2 text-left text-emerald-400 cursor-pointer hover:bg-muted/50"
        >
          <div className="mt-0.5 shrink-0">
            <CheckCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Workflow Complete</div>
          </div>
        </button>
      )}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/workflow-tab.tsx
git commit -m "feat: add Workflow Complete entry to WorkflowTab sidebar"
```

---

### Task 3: Update ChatView to support completion state

**Files:**
- Modify: `src/features/workflow/components/views/chat-view.tsx:89-453`

Add `workflowComplete` and `onMarkComplete` props. When `workflowComplete` is true:
1. Render a completion divider after all content
2. Show "Mark Complete" button instead of "Next Step"
3. Keep input active with updated placeholder

- [ ] **Step 1: Add new props to ChatViewProps interface**

At `chat-view.tsx:89`, update the interface. Add after `onSetAutoAdvance`:

```tsx
  workflowComplete?: boolean;
  onMarkComplete?: () => void;
```

- [ ] **Step 2: Destructure new props**

At `chat-view.tsx:106`, add `workflowComplete` and `onMarkComplete` to the destructuring:

```tsx
export function ChatView({
  stepName,
  response,
  isExecuting,
  stepStatus,
  stepOutput,
  onAdvanceStep,
  onExecute,
  projectDir,
  ticketId,
  isInteractive = true,
  pendingPermission,
  onRespondToPermission,
  autoAdvance,
  onSetAutoAdvance,
  workflowComplete,
  onMarkComplete,
}: ChatViewProps) {
```

- [ ] **Step 3: Add Check icon to imports**

At `chat-view.tsx:2`, add `Check` to the lucide-react import:

```tsx
import { ArrowRight, Check, Play, User } from "lucide-react";
```

- [ ] **Step 4: Update showInput logic**

At `chat-view.tsx:227`, update `showInput` to also be true when workflow is complete:

```tsx
const showInput = isInteractive || !isExecuting || workflowComplete;
```

- [ ] **Step 5: Add completion divider after content blocks**

After the files changed sections (after line 367, before the empty states block at line 370), add the completion divider:

```tsx
            {/* Workflow completion divider */}
            {workflowComplete && (
              <StepDividerBar
                label="All Workflow Steps Complete"
                stepId="workflow-complete"
                variant="complete"
              />
            )}
```

- [ ] **Step 6: Replace Next Step button with Mark Complete when workflow is complete**

Replace the floating button block at lines 394-407 with:

```tsx
          {/* Floating action button — "Next Step" during workflow, "Mark Complete" after */}
          {workflowComplete && onMarkComplete && (
            <div className="sticky bottom-0 flex justify-end pointer-events-none">
              <Button
                size="sm"
                onClick={onMarkComplete}
                aria-label="Mark workflow complete"
                className="bg-emerald-500/50 hover:bg-emerald-600/50 border-emerald-500/50 border-1 shadow-sm shadow-emerald-600/20 text-white backdrop-blur-sm cursor-pointer pointer-events-auto"
              >
                <Check className="w-3.5 h-3.5 mr-1.5" />
                Mark Complete
              </Button>
            </div>
          )}
          {!workflowComplete && stepStatus === "completed" && onAdvanceStep && (
            <div className="sticky bottom-0 flex justify-end pointer-events-none">
              <Button
                size="sm"
                onClick={onAdvanceStep}
                aria-label="Advance to next step"
                className="bg-emerald-500/50 hover:bg-emerald-600/50 border-emerald-500/50 border-1 shadow-sm shadow-emerald-600/20 text-white backdrop-blur-sm cursor-pointer pointer-events-auto"
              >
                Next Step
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          )}
```

- [ ] **Step 7: Update ComposeToolbar placeholder when workflow is complete**

In the `ComposeToolbar` render (around line 434), add a conditional placeholder:

```tsx
          <ComposeToolbar
            config={config}
            onSetModel={setModel}
            onSetThinking={setThinking}
            onSetEffort={setEffort}
            onSetFastMode={setFastMode}
            onSend={(message) => {
              handleSend(message);
            }}
            placeholder={workflowComplete ? "Ask a follow-up question..." : undefined}
            contextUsage={stepOutput?.contextUsage}
            contextIndicatorVisibility={
              (appPreferences?.context_indicator_visibility as "threshold" | "always" | "never") ??
              "threshold"
            }
          />
```

- [ ] **Step 8: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/features/workflow/components/views/chat-view.tsx
git commit -m "feat: add completion divider and Mark Complete button to ChatView"
```

---

### Task 4: Update WorkflowShell to render chat view on completion

**Files:**
- Modify: `src/features/workflow/components/workflow-shell.tsx:292-324`

Remove the dedicated completion screen. Instead, fall through to the tab view and pass `workflowComplete` to ChatView.

- [ ] **Step 1: Remove the completion early-return block**

Delete lines 292-324 (the `if (!currentStep) { return ... }` block).

- [ ] **Step 2: Compute workflowComplete flag**

After line 290 (`const completedStepIds = ...`), add:

```tsx
  const workflowComplete = !currentStep && completedStepIds.length > 0;
```

- [ ] **Step 3: Guard the variables that depend on currentStep**

The variables at lines 326-333 reference `currentStep` which may now be null. Update them to handle the completion case:

```tsx
  const isExecuting = workflowComplete
    ? loading
    : workflowState.step_status === "in_progress" || loading;
  const isFailed =
    !workflowComplete &&
    typeof workflowState.step_status === "object" &&
    "failed" in workflowState.step_status;
  const lastStepId = workflowComplete
    ? completedStepIds[completedStepIds.length - 1]
    : currentStep?.id;
  const stepOutputKey = lastStepId && ticket.id ? `${ticket.id}:${lastStepId}` : undefined;
  const currentStepOutput = stepOutputKey ? stepOutputs[stepOutputKey] : undefined;
  const responseText = lastResult?.response ?? currentStepOutput?.textContent ?? "";
  const reviewDisabled = !pendingReviewRequestId;
  const agentCommitMessage = lastResult?.response ?? currentStepOutput?.textContent ?? null;
```

- [ ] **Step 4: Update ChatView props in the tab content**

Replace the ChatView render (lines 413-427) with:

```tsx
            <ChatView
              stepName={currentStep?.name ?? "Complete"}
              response={responseText}
              isExecuting={isExecuting}
              stepStatus={workflowComplete ? "completed" : workflowState.step_status}
              stepOutput={currentStepOutput}
              onExecute={handleExecute}
              onAdvanceStep={
                !workflowComplete
                  ? () => advanceStep(ticket.id).then(() => onRefreshTicket())
                  : undefined
              }
              projectDir={projectDir}
              ticketId={ticket.id}
              isInteractive={
                workflowComplete || currentStep?.view === "chat" || currentStep?.view === "review"
              }
              pendingPermission={pendingPermission}
              onRespondToPermission={respondToPermission}
              workflowComplete={workflowComplete}
              onMarkComplete={onNavigateToBacklog}
            />
```

- [ ] **Step 5: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/components/workflow-shell.tsx
git commit -m "feat: render chat view on workflow completion instead of dedicated screen"
```

---

### Task 5: Backend — allow follow-up execution after workflow completion

**Files:**
- Modify: `src-tauri/src/workflow/mod.rs:88-215`

The current `execute_step` function returns `Err("Workflow already completed")` when `current_step_id` is `None`. For post-completion follow-ups, we need to allow execution using the last completed step's context.

- [ ] **Step 1: Update execute_step to handle completion follow-ups**

Replace lines 100-114 (the `current_step_id` extraction and step lookup) with logic that handles the completed case:

```rust
    // For completed workflows, allow follow-up messages using the last step's context
    let (current_step_id, step) = if let Some(ref step_id) = state.current_step_id {
        let wf = get_workflow(project_dir, &state.workflow_id)
            .ok_or_else(|| format!("Workflow '{}' not found", state.workflow_id))?;
        let s = wf
            .steps
            .iter()
            .find(|s| &s.id == step_id)
            .ok_or_else(|| format!("Step '{step_id}' not found in workflow"))?
            .clone();
        (step_id.clone(), s)
    } else {
        // Workflow completed — require a user message for follow-up
        if user_message.is_none() {
            return Err("Workflow already completed".to_string());
        }
        let wf = get_workflow(project_dir, &state.workflow_id)
            .ok_or_else(|| format!("Workflow '{}' not found", state.workflow_id))?;
        let last_step = wf
            .steps
            .last()
            .ok_or("Workflow has no steps")?
            .clone();
        let last_step_id = state
            .step_history
            .last()
            .map(|r| r.step_id.clone())
            .unwrap_or_else(|| last_step.id.clone());
        (last_step_id, last_step)
    };
```

Also update the variable references below this block. The existing code uses `current_step_id` as a `&str` reference — since we now own a `String`, update the references:
- Line ~117-121 (`has_worktree` check): no change needed, doesn't use `current_step_id`
- Line ~145 (`update_step_status`): skip this for completed workflows
- Line ~150-167 (prompt building): `current_step_id` usage works with the owned String via `&current_step_id`

After the worktree logic and before the status update at line 145, add a guard:

```rust
    // Skip status update for completed workflow follow-ups (no current step to update)
    if state.current_step_id.is_some() {
        update_step_status(project_dir, ticket_id, StepStatus::InProgress)?;
    }
```

And remove the original unconditional `update_step_status` call at line 145.

- [ ] **Step 2: Update the is_follow_up check**

The `is_follow_up` check at line ~150 compares against `current_step_id`. For completed workflows, it's always a follow-up. Update:

```rust
    let is_follow_up = state.current_step_id.is_none()
        || state
            .step_history
            .iter()
            .any(|r| r.step_id == current_step_id);
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/workflow/mod.rs
git commit -m "feat: allow follow-up agent messages after workflow completion"
```

---

### Task 6: Handle workflow-complete step output key in streaming

**Files:**
- Modify: `src/features/workflow/components/workflow-shell.tsx` (already modified in Task 4)

When the workflow is complete and the user sends a follow-up, the streaming output needs a key to store against. The backend will use the last completed step's ID, so the frontend's `stepOutputKey` computed in Task 4 (using `lastStepId`) should align.

- [ ] **Step 1: Verify the streaming key alignment**

Read `src/features/workflow/hooks/use-workflow-streaming.ts` to confirm that `executingStepsRef` is used to key step outputs. After completion follow-ups, the backend will return with the last step's ID in the stream events. Verify the streaming hook picks this up correctly.

Check that `executingStepsRef.current[issueId]` is set before `executeStep` is called. In `use-workflow.ts:268`:

```tsx
executingStepsRef.current[issueId] = currentStepsRef.current[issueId] ?? null;
```

For completed workflows, `currentStepsRef.current[issueId]` will be `null`. The streaming hook needs to handle `null` step IDs gracefully — if it already does (by falling back to a default or using the issue-level key), no change is needed. If not, update `executeStep` in `use-workflow.ts` to set the executing step to the last completed step ID:

```tsx
// In executeStep, before the commands.workflowExecuteStep call:
const lastCompletedStepId = ticketState?.step_history?.length
  ? ticketState.step_history[ticketState.step_history.length - 1].step_id
  : null;
executingStepsRef.current[issueId] = currentStepsRef.current[issueId] ?? lastCompletedStepId;
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/features/workflow/hooks/use-workflow.ts
git commit -m "fix: use last completed step ID for streaming output key after completion"
```

---

### Task 7: Prevent auto-execute from firing on completed workflows

**Files:**
- Modify: `src/features/workflow/components/workflow-shell.tsx`

The auto-execute effect (lines 148-198) fires when `step_status === "pending"`. After completion, `step_status` may still be `"completed"` from the last step, but we need to make sure the auto-execute and auto-resume effects don't accidentally trigger for completed workflows.

- [ ] **Step 1: Add currentStep guard to auto-execute and auto-resume**

The auto-execute effect at line 156 already checks `!currentStep`:

```tsx
if (workflowState?.step_status !== "pending" || !currentStep || loading || !listenersReady) {
```

And auto-resume at line 202:

```tsx
if (!currentStep || loading || !listenersReady) return;
```

Both already bail when `!currentStep`, so completed workflows are safe. No changes needed.

- [ ] **Step 2: Verify the auto-advance effect is safe**

The auto-advance effect at line 255 already checks:

```tsx
if (!workflowState.current_step_id) return; // workflow done
```

This correctly prevents auto-advance after completion. No changes needed.

- [ ] **Step 3: Commit (skip if no changes)**

No commit needed — existing guards are sufficient.

---

### Task 8: Manual integration test

- [ ] **Step 1: Build and run the app**

```bash
bun run tauri:dev
```

- [ ] **Step 2: Test workflow completion flow**

1. Open a ticket with a workflow assigned
2. Run through all workflow steps to completion
3. Verify: completion divider "All Workflow Steps Complete" appears in chat with emerald styling
4. Verify: "Mark Complete" button appears in bottom-right (same position as "Next Step")
5. Verify: All three tabs (Chat/Changes/Commit) are accessible
6. Verify: Chat input is active with "Ask a follow-up question..." placeholder

- [ ] **Step 3: Test follow-up messages**

1. Type a follow-up question in the chat input
2. Verify: message appears as a user bubble in the chat
3. Verify: agent responds (streaming works)
4. Verify: response appears below the completion divider

- [ ] **Step 4: Test Mark Complete**

1. Click "Mark Complete"
2. Verify: navigates back to the board/backlog view

- [ ] **Step 5: Test WorkflowTab sidebar**

1. During a completed workflow, check the right sidebar "Workflow" tab
2. Verify: "Workflow Complete" entry appears at the bottom with CheckCheck icon
3. Click it — verify it scrolls to the completion divider in chat

- [ ] **Step 6: Test edge cases**

1. Reload the app with a completed workflow — verify it renders correctly (chat view, not completion screen)
2. Verify auto-advance doesn't trigger on completed workflows
