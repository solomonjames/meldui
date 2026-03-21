import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { commands } from "@/bindings";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  WorkflowState,
  StepExecutionResult,
  WorkflowSuggestion,
  DiffFile,
  BranchInfo,
  CommitActionResult,
} from "@/shared/types";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";
import { useWorkflowPermissions } from "@/features/workflow/hooks/use-workflow-permissions";
import { useWorkflowNotifications } from "@/features/workflow/hooks/use-workflow-notifications";
import { useWorkflowFeedback } from "@/features/workflow/hooks/use-workflow-feedback";
import { useWorkflowReview } from "@/features/workflow/hooks/use-workflow-review";

export const workflowKeys = {
  list: (projectDir: string) => ["workflows", "list", projectDir] as const,
  detail: (projectDir: string, workflowId: string) =>
    ["workflows", "detail", projectDir, workflowId] as const,
  state: (projectDir: string, issueId: string) =>
    ["workflows", "state", projectDir, issueId] as const,
  diff: (dir: string, baseCommit?: string | null) =>
    ["workflows", "diff", dir, baseCommit ?? null] as const,
  branchInfo: (dir: string) => ["workflows", "branchInfo", dir] as const,
};

export function useWorkflow(projectDir: string) {
  const queryClient = useQueryClient();
  const [currentState, setCurrentState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const currentStepRef = useRef<string | null>(null);
  const executingStepRef = useRef<string | null>(null);
  const onRefreshTicketRef = useRef<(() => Promise<void>) | null>(null);
  const getWorkflowStateRef = useRef<((issueId: string) => Promise<unknown>) | null>(null);

  useEffect(() => {
    currentStepRef.current = currentState?.current_step_id ?? null;
  }, [currentState?.current_step_id]);

  // Compose sub-hooks (untouched)
  const streaming = useWorkflowStreaming(activeTicketId, executingStepRef);
  const permissions = useWorkflowPermissions(activeTicketId, setError);
  const feedback = useWorkflowFeedback(activeTicketId, setError);
  const review = useWorkflowReview(activeTicketId, setError);
  const notifications = useWorkflowNotifications(activeTicketId, onRefreshTicketRef, getWorkflowStateRef);

  const listenersReady =
    streaming.streamingReady &&
    permissions.permissionsReady &&
    feedback.feedbackReady &&
    review.reviewReady &&
    notifications.notificationsReady;

  // ── Queries ──

  const workflowsQuery = useQuery({
    queryKey: workflowKeys.list(projectDir),
    queryFn: () => commands.workflowList({ projectDir }),
    enabled: !!projectDir,
  });

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);

  const listWorkflows = useCallback(async () => {
    const result = await queryClient.fetchQuery({
      queryKey: workflowKeys.list(projectDir),
      queryFn: () => commands.workflowList({ projectDir }),
    });
    return result ?? [];
  }, [projectDir, queryClient]);

  const getWorkflow = useCallback(
    async (workflowId: string) => {
      try {
        return await queryClient.fetchQuery({
          queryKey: workflowKeys.detail(projectDir, workflowId),
          queryFn: () => commands.workflowGet({ projectDir, workflowId }),
        });
      } catch (err) {
        setError(`Failed to get workflow: ${err}`);
        return null;
      }
    },
    [projectDir, queryClient]
  );

  // getWorkflowState — imperative (called after executeStep, from notifications, etc.)
  const getWorkflowState = useCallback(
    async (issueId: string) => {
      try {
        const state = await commands.workflowState({ projectDir, issueId });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to get workflow state: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  getWorkflowStateRef.current = getWorkflowState;

  // getDiff — imperative, called by views with variable params
  const getDiff = useCallback(
    async (dirOverride?: string, baseCommit?: string) => {
      try {
        return await commands.workflowGetDiff({
          projectDir: dirOverride ?? projectDir,
          baseCommit: baseCommit ?? null,
        });
      } catch (err) {
        setError(`Failed to get diff: ${err}`);
        return [] as DiffFile[];
      }
    },
    [projectDir]
  );

  // getBranchInfo — imperative
  const getBranchInfo = useCallback(
    async (dirOverride?: string) => {
      try {
        return await commands.workflowGetBranchInfo({
          projectDir: dirOverride ?? projectDir,
        });
      } catch (err) {
        setError(`Failed to get branch info: ${err}`);
        return null as BranchInfo | null;
      }
    },
    [projectDir]
  );

  // ── Mutations ──

  const assignWorkflow = useCallback(
    async (issueId: string, workflowId: string) => {
      try {
        setLoading(true);
        const state = await commands.workflowAssign({
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

  const { clearPending: clearFeedbackPending } = feedback;
  const { clearPending: clearPermissionPending } = permissions;

  const executeStep = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);

        if (currentState?.workflow_id) {
          const wf = workflows.find((w) => w.id === currentState.workflow_id);
          if (wf?.ticket_sections && wf.ticket_sections.length > 0) {
            try {
              await commands.ticketInitializeSections({
                projectDir,
                ticketId: issueId,
                sectionDefs: wf.ticket_sections,
              });
            } catch {
              // Non-fatal
            }
          }
        }

        executingStepRef.current = currentStepRef.current;
        setCurrentState((prev) =>
          prev ? { ...prev, step_status: "in_progress" } : prev
        );
        const result = await commands.workflowExecuteStep({ projectDir, issueId });

        executingStepRef.current = null;
        await getWorkflowState(issueId);
        return result as StepExecutionResult;
      } catch (err) {
        executingStepRef.current = null;
        clearFeedbackPending();
        clearPermissionPending();
        setError(`Step execution failed: ${err}`);
        await getWorkflowState(issueId);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir, getWorkflowState, currentState?.workflow_id, workflows, clearFeedbackPending, clearPermissionPending]
  );

  const suggestWorkflow = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);
        const suggestion = await commands.workflowSuggest({ projectDir, issueId });
        return suggestion as WorkflowSuggestion;
      } catch {
        setError(`Unable to suggest workflow — please select manually`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const executeCommitActionMutation = useMutation({
    mutationFn: (vars: {
      issueId: string;
      action: "commit" | "commit_and_pr";
      commitMessage: string;
    }) =>
      commands.workflowExecuteCommitAction({
        projectDir,
        issueId: vars.issueId,
        action: vars.action,
        commitMessage: vars.commitMessage,
      }),
  });

  const executeCommitAction = useCallback(
    async (
      issueId: string,
      action: "commit" | "commit_and_pr",
      commitMessage: string
    ) => {
      try {
        setLoading(true);
        setError(null);
        return await executeCommitActionMutation.mutateAsync({
          issueId,
          action,
          commitMessage,
        }) as CommitActionResult;
      } catch (err) {
        setError(`Commit action failed: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [executeCommitActionMutation]
  );

  const cleanupWorktree = useCallback(
    async (issueId: string) => {
      try {
        await commands.workflowCleanupWorktree({ projectDir, issueId });
      } catch (err) {
        setError(`Failed to cleanup worktree: ${err}`);
      }
    },
    [projectDir]
  );

  const setOnRefreshTicket = useCallback((fn: () => Promise<void>) => {
    onRefreshTicketRef.current = fn;
  }, []);

  const respondToFeedback = feedback.respondToFeedback;
  const respondToPermission = permissions.respondToPermission;

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
