import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
  WorkflowSuggestion,
  DiffFile,
  BranchInfo,
  CommitActionResult,
} from "@/types";
import { useWorkflowStreaming } from "./use-workflow-streaming";
import { useWorkflowPermissions } from "./use-workflow-permissions";
import { useWorkflowNotifications } from "./use-workflow-notifications";
import { useWorkflowFeedback } from "./use-workflow-feedback";
import { useWorkflowReview } from "./use-workflow-review";

export function useWorkflow(projectDir: string) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [currentState, setCurrentState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const currentStepRef = useRef<string | null>(null);
  // Tracks which step is actively receiving streaming output from the sidecar.
  // Unlike currentStepRef (which tracks workflow state), this only changes when
  // a new executeStep call starts — preventing late-arriving output from the
  // previous step from leaking into the next step's output.
  const executingStepRef = useRef<string | null>(null);
  const onRefreshTicketRef = useRef<(() => Promise<void>) | null>(null);
  const getWorkflowStateRef = useRef<((issueId: string) => Promise<unknown>) | null>(null);

  // Keep currentStepRef in sync
  useEffect(() => {
    currentStepRef.current = currentState?.current_step_id ?? null;
  }, [currentState?.current_step_id]);

  // Compose sub-hooks
  const streaming = useWorkflowStreaming(activeTicketId, executingStepRef);
  const permissions = useWorkflowPermissions(activeTicketId, setError);
  const feedback = useWorkflowFeedback(activeTicketId, setError);
  const review = useWorkflowReview(activeTicketId, setError);
  const notifications = useWorkflowNotifications(activeTicketId, onRefreshTicketRef, getWorkflowStateRef);

  // Derive listenersReady from all sub-hooks
  const listenersReady =
    streaming.streamingReady &&
    permissions.permissionsReady &&
    feedback.feedbackReady &&
    review.reviewReady &&
    notifications.notificationsReady;

  const listWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<WorkflowDefinition[]>("workflow_list", {
        projectDir,
      });
      setWorkflows(result);
      return result;
    } catch (err) {
      setError(`Failed to list workflows: ${err}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  const getWorkflow = useCallback(
    async (workflowId: string) => {
      try {
        return await invoke<WorkflowDefinition>("workflow_get", {
          projectDir,
          workflowId,
        });
      } catch (err) {
        setError(`Failed to get workflow: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  const assignWorkflow = useCallback(
    async (issueId: string, workflowId: string) => {
      try {
        setLoading(true);
        const state = await invoke<WorkflowState>("workflow_assign", {
          projectDir,
          issueId,
          workflowId,
        });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to assign workflow: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const getWorkflowState = useCallback(
    async (issueId: string) => {
      try {
        const state = await invoke<WorkflowState | null>("workflow_state", {
          projectDir,
          issueId,
        });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to get workflow state: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  // Keep ref in sync so event listeners can call getWorkflowState without
  // needing it in the useEffect dependency array (avoids TDZ errors)
  getWorkflowStateRef.current = getWorkflowState;

  // Extract stable function references for executeStep's dependency array.
  // Sub-hook return objects are new references every render, so we depend on
  // the individual useCallback-stable methods instead.
  const { clearPending: clearFeedbackPending } = feedback;
  const { clearPending: clearPermissionPending } = permissions;

  const executeStep = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);

        // Initialize typed sections if the workflow defines them
        if (currentState?.workflow_id) {
          const wf = workflows.find((w) => w.id === currentState.workflow_id);
          if (wf?.ticket_sections && wf.ticket_sections.length > 0) {
            try {
              await invoke("ticket_initialize_sections", {
                projectDir,
                ticketId: issueId,
                sectionDefs: wf.ticket_sections,
              });
            } catch {
              // Non-fatal — sections may already exist
            }
          }
        }

        // Lock the executing step so streaming output goes to the right place
        executingStepRef.current = currentStepRef.current;
        // Optimistic isExecuting update
        setCurrentState((prev) =>
          prev ? { ...prev, step_status: "in_progress" } : prev
        );
        const result = await invoke<StepExecutionResult>(
          "workflow_execute_step",
          { projectDir, issueId }
        );

        // Unlock executing step — sidecar is done
        executingStepRef.current = null;

        // Refresh state to pick up latest workflow state
        await getWorkflowState(issueId);

        return result;
      } catch (err) {
        executingStepRef.current = null;
        // Clear stale pending states — the sidecar is dead
        clearFeedbackPending();
        clearPermissionPending();
        setError(`Step execution failed: ${err}`);
        // Refresh state to pick up the failed status
        await getWorkflowState(issueId);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir, getWorkflowState, currentState?.workflow_id, workflows, clearFeedbackPending, clearPermissionPending]
  );

  const respondToFeedback = feedback.respondToFeedback;

  const suggestWorkflow = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);
        const suggestion = await invoke<WorkflowSuggestion>(
          "workflow_suggest",
          { projectDir, issueId }
        );
        return suggestion;
      } catch {
        setError(`Unable to suggest workflow — please select manually`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const respondToPermission = permissions.respondToPermission;

  const getDiff = useCallback(async (dirOverride?: string, baseCommit?: string) => {
    try {
      return await invoke<DiffFile[]>("workflow_get_diff", {
        projectDir: dirOverride ?? projectDir,
        baseCommit: baseCommit ?? null,
      });
    } catch (err) {
      setError(`Failed to get diff: ${err}`);
      return [];
    }
  }, [projectDir]);

  const getBranchInfo = useCallback(async (dirOverride?: string) => {
    try {
      return await invoke<BranchInfo>("workflow_get_branch_info", { projectDir: dirOverride ?? projectDir });
    } catch (err) {
      setError(`Failed to get branch info: ${err}`);
      return null;
    }
  }, [projectDir]);

  const executeCommitAction = useCallback(
    async (issueId: string, action: "commit" | "commit_and_pr", commitMessage: string) => {
      try {
        setLoading(true);
        setError(null);
        return await invoke<CommitActionResult>("workflow_execute_commit_action", {
          projectDir,
          issueId,
          action,
          commitMessage,
        });
      } catch (err) {
        setError(`Commit action failed: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const cleanupWorktree = useCallback(
    async (issueId: string) => {
      try {
        await invoke("workflow_cleanup_worktree", { projectDir, issueId });
      } catch (err) {
        setError(`Failed to cleanup worktree: ${err}`);
      }
    },
    [projectDir]
  );

  const setOnRefreshTicket = useCallback((fn: () => Promise<void>) => {
    onRefreshTicketRef.current = fn;
  }, []);

  return {
    workflows,
    currentState,
    loading,
    error,
    listenersReady,
    stepOutputs: streaming.stepOutputs,
    activeTicketId,
    setActiveTicketId,
    pendingPermission: permissions.pendingPermission,
    respondToPermission,
    notifications: notifications.notifications,
    clearNotification: notifications.clearNotification,
    statusText: notifications.statusText,
    lastUpdatedSectionId: notifications.lastUpdatedSectionId,
    pendingFeedback: feedback.pendingFeedback,
    respondToFeedback,
    setOnRefreshTicket,
    listWorkflows,
    getWorkflow,
    assignWorkflow,
    getWorkflowState,
    executeStep,
    suggestWorkflow,
    getDiff,
    getBranchInfo,
    executeCommitAction,
    cleanupWorktree,
    getStepOutput: streaming.getStepOutput,
    reviewFindings: review.reviewFindings,
    reviewComments: review.reviewComments,
    addReviewComment: review.addReviewComment,
    deleteReviewComment: review.deleteReviewComment,
    submitReview: review.submitReview,
    pendingReviewRequestId: review.pendingReviewRequestId,
    reviewRoundKey: review.reviewRoundKey,
  };
}
