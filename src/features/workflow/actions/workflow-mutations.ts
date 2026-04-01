import type { JsonValue } from "@/bindings";
import { commands } from "@/bindings";
import {
  createStreamChannel,
  executingSteps,
} from "@/features/workflow/actions/create-stream-channel";
import { fetchWorkflowState } from "@/features/workflow/actions/workflow-queries";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { queryClient } from "@/shared/lib/query-client";
import type {
  CommitActionResult,
  ReviewSubmission,
  StepExecutionResult,
  WorkflowDefinition,
  WorkflowSuggestion,
} from "@/shared/types";

// ── Shared helpers ──

/** Tracks which tickets are currently running (for sidebar indicators). */
export const runningTicketIds = new Set<string>();

/** Registered callback for notifying React of runningTicketIds changes. */
let onRunningTicketsChange: ((ids: Set<string>) => void) | null = null;

export function setRunningTicketsListener(cb: (ids: Set<string>) => void) {
  onRunningTicketsChange = cb;
}

function addRunning(issueId: string) {
  runningTicketIds.add(issueId);
  onRunningTicketsChange?.(new Set(runningTicketIds));
}

function removeRunning(issueId: string) {
  runningTicketIds.delete(issueId);
  onRunningTicketsChange?.(new Set(runningTicketIds));
}

function setSessionExpiredError(ticketId: string) {
  orchestrationStoreFactory
    .getStore(ticketId)
    .getState()
    .setError("Agent session expired. Click Resume to continue where you left off.");
}

// ── Mutations ──

export async function assignWorkflow(projectDir: string, issueId: string, workflowId: string) {
  const store = orchestrationStoreFactory.getStore(issueId);
  try {
    store.getState().setLoading(true);
    const state = await commands.workflowAssign(projectDir, issueId, workflowId);
    store.getState().setWorkflowState(state);
    return state;
  } catch (err) {
    store.getState().setError(`Failed to assign workflow: ${err}`);
    return null;
  } finally {
    store.getState().setLoading(false);
  }
}

export async function executeStep(
  projectDir: string,
  issueId: string,
  workflows: WorkflowDefinition[],
  userMessage?: string,
): Promise<StepExecutionResult | null> {
  const store = orchestrationStoreFactory.getStore(issueId);

  try {
    store.getState().setLoading(true);
    store.getState().setError(null);
    addRunning(issueId);

    const ticketState = store.getState().workflowState;
    if (ticketState?.workflow_id) {
      const wf = workflows.find((w) => w.id === ticketState.workflow_id);
      if (wf?.ticket_sections && wf.ticket_sections.length > 0) {
        try {
          await commands.ticketInitializeSections(projectDir, issueId, wf.ticket_sections);
        } catch {
          // Non-fatal
        }
      }
    }

    const lastCompletedStepId = ticketState?.step_history?.length
      ? ticketState.step_history[ticketState.step_history.length - 1].step_id
      : null;
    executingSteps[issueId] = ticketState?.current_step_id ?? lastCompletedStepId;
    const ws = store.getState().workflowState;
    if (ws) {
      store.getState().setWorkflowState({ ...ws, step_status: "in_progress" });
    }
    const channel = createStreamChannel();
    const result = await commands.workflowExecuteStep(
      projectDir,
      issueId,
      channel,
      userMessage ?? null,
    );

    executingSteps[issueId] = null;
    await fetchWorkflowState(projectDir, issueId);
    return result as StepExecutionResult;
  } catch (err) {
    executingSteps[issueId] = null;
    permissionsStoreFactory.getStore(issueId).getState().clearPendingPermission();
    store.getState().setError(`Step execution failed: ${err}`);
    await fetchWorkflowState(projectDir, issueId);
    return null;
  } finally {
    store.getState().setLoading(false);
    removeRunning(issueId);
  }
}

export async function suggestWorkflow(
  projectDir: string,
  issueId: string,
): Promise<WorkflowSuggestion | null> {
  const store = orchestrationStoreFactory.getStore(issueId);
  try {
    store.getState().setLoading(true);
    store.getState().setError(null);
    addRunning(issueId);
    const channel = createStreamChannel();
    const suggestion = await commands.workflowSuggest(projectDir, issueId, channel);
    return suggestion as WorkflowSuggestion;
  } catch {
    store.getState().setError("Unable to suggest workflow — please select manually");
    return null;
  } finally {
    store.getState().setLoading(false);
    removeRunning(issueId);
  }
}

export async function advanceStep(projectDir: string, issueId: string) {
  try {
    const newState = await commands.workflowAdvance(projectDir, issueId);
    orchestrationStoreFactory.getStore(issueId).getState().setWorkflowState(newState);
    queryClient.invalidateQueries({
      queryKey: ["conversations", projectDir, issueId],
    });
  } catch (err) {
    orchestrationStoreFactory
      .getStore(issueId)
      .getState()
      .setError(`Failed to advance step: ${err}`);
  }
}

export async function executeCommitAction(
  projectDir: string,
  issueId: string,
  action: "commit" | "commit_and_pr",
  commitMessage: string,
): Promise<CommitActionResult | null> {
  const store = orchestrationStoreFactory.getStore(issueId);
  try {
    store.getState().setLoading(true);
    store.getState().setError(null);
    const channel = createStreamChannel();
    return (await commands.workflowExecuteCommitAction(
      projectDir,
      issueId,
      action,
      commitMessage,
      channel,
    )) as CommitActionResult;
  } catch (err) {
    store.getState().setError(`Commit action failed: ${err}`);
    return null;
  } finally {
    store.getState().setLoading(false);
  }
}

export async function cleanupWorktree(projectDir: string, issueId: string) {
  try {
    await commands.workflowCleanupWorktree(projectDir, issueId);
  } catch (err) {
    orchestrationStoreFactory
      .getStore(issueId)
      .getState()
      .setError(`Failed to cleanup worktree: ${err}`);
  }
}

export async function respondToPermission(ticketId: string, requestId: string, allowed: boolean) {
  const store = permissionsStoreFactory.getStore(ticketId);
  const pending = store.getState().pendingPermission;
  if (!pending || pending.request_id !== requestId) return;
  try {
    await commands.agentPermissionRespond(ticketId, requestId, allowed);
    store.getState().clearPendingPermission();
  } catch (err) {
    store.getState().clearPendingPermission();
    const errStr = String(err);
    if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
      setSessionExpiredError(ticketId);
    } else {
      orchestrationStoreFactory
        .getStore(ticketId)
        .getState()
        .setError(`Failed to respond to permission: ${err}`);
    }
  }
}

export async function submitReview(ticketId: string, submission: ReviewSubmission) {
  const store = reviewStoreFactory.getStore(ticketId);
  const requestId = store.getState().pendingRequestId;
  if (!requestId) return;
  try {
    await commands.agentReviewRespond(ticketId, requestId, submission as JsonValue);
    if (submission.action === "request_changes") {
      store.getState().clearAfterRequestChanges();
    } else {
      store.getState().clearAfterApproval();
    }
  } catch (err) {
    store.getState().clearAfterApproval();
    const errStr = String(err);
    if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
      setSessionExpiredError(ticketId);
    } else {
      orchestrationStoreFactory
        .getStore(ticketId)
        .getState()
        .setError(`Failed to submit review: ${err}`);
    }
  }
}
