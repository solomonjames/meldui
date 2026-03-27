import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, events } from "@/bindings";
import { useWorkflowNotifications } from "@/features/workflow/hooks/use-workflow-notifications";
import { useWorkflowPermissions } from "@/features/workflow/hooks/use-workflow-permissions";
import { useWorkflowReview } from "@/features/workflow/hooks/use-workflow-review";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";
import type {
  BranchInfo,
  CommitActionResult,
  DiffFile,
  StepExecutionResult,
  WorkflowState,
  WorkflowSuggestion,
} from "@/shared/types";

const workflowKeys = {
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

  // ── Per-ticket state ──
  const [workflowStates, setWorkflowStates] = useState<Record<string, WorkflowState>>({});
  const [loadingTickets, setLoadingTickets] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  // Auto-advance state (backed by Rust)
  const autoAdvanceQuery = useQuery({
    queryKey: ["autoAdvance", projectDir],
    queryFn: () => commands.getAutoAdvance(projectDir),
    staleTime: Infinity, // Only changes via mutation
  });

  const autoAdvance = autoAdvanceQuery.data ?? false;

  const setAutoAdvanceMutation = useMutation({
    mutationFn: (enabled: boolean) => commands.setAutoAdvance(projectDir, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoAdvance", projectDir] });
    },
  });

  const setAutoAdvance = useCallback(
    (enabled: boolean) => setAutoAdvanceMutation.mutate(enabled),
    [setAutoAdvanceMutation],
  );

  const currentStepsRef = useRef<Record<string, string | null>>({});
  const executingStepsRef = useRef<Record<string, string | null>>({});
  const unloadTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const onRefreshTicketRef = useRef<(() => Promise<void>) | null>(null);
  const createStreamChannelRef = useRef<
    ReturnType<typeof useWorkflowStreaming>["createStreamChannel"]
  >(null!);

  useEffect(() => {
    for (const [issueId, state] of Object.entries(workflowStates)) {
      currentStepsRef.current[issueId] = state?.current_step_id ?? null;
    }
  }, [workflowStates]);

  // Keyed error setter for sub-hooks
  const setErrorKeyed = useCallback((issueId: string, msg: string) => {
    setErrors((prev) => ({ ...prev, [issueId]: msg }));
  }, []);

  // Compose sub-hooks
  const streaming = useWorkflowStreaming(activeTicketId, executingStepsRef);
  createStreamChannelRef.current = streaming.createStreamChannel;
  const permissions = useWorkflowPermissions(activeTicketId, setErrorKeyed);
  const review = useWorkflowReview(activeTicketId, setErrorKeyed);
  const notifications = useWorkflowNotifications(activeTicketId, onRefreshTicketRef);

  const listenersReady =
    streaming.streamingReady &&
    permissions.permissionsReady &&
    review.reviewReady &&
    notifications.notificationsReady;

  // ── Idle timeout: unload state 10 minutes after agent session ends ──
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    events.agentSessionEnded
      .listen((event) => {
        if (cancelled) return;
        const { issue_id } = event.payload;

        // Start 10-minute unload timer
        unloadTimersRef.current[issue_id] = setTimeout(
          () => {
            setWorkflowStates((prev) => {
              const next = { ...prev };
              delete next[issue_id];
              return next;
            });
            setLoadingTickets((prev) => {
              const next = { ...prev };
              delete next[issue_id];
              return next;
            });
            setErrors((prev) => {
              const next = { ...prev };
              delete next[issue_id];
              return next;
            });
            streaming.clearTicketOutputs?.(issue_id);
            delete unloadTimersRef.current[issue_id];
          },
          10 * 60 * 1000,
        ); // 10 minutes
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

    return () => {
      cancelled = true;
      unlisten?.();
      for (const timer of Object.values(unloadTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, [streaming.clearTicketOutputs]);

  // ── Queries ──

  const workflowsQuery = useQuery({
    queryKey: workflowKeys.list(projectDir),
    queryFn: () => commands.workflowList(projectDir),
    enabled: !!projectDir,
  });

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);

  const listWorkflows = useCallback(async () => {
    const result = await queryClient.fetchQuery({
      queryKey: workflowKeys.list(projectDir),
      queryFn: () => commands.workflowList(projectDir),
    });
    return result ?? [];
  }, [projectDir, queryClient]);

  const getWorkflow = useCallback(
    async (workflowId: string) => {
      try {
        return await queryClient.fetchQuery({
          queryKey: workflowKeys.detail(projectDir, workflowId),
          queryFn: () => commands.workflowGet(projectDir, workflowId),
        });
      } catch (err) {
        if (activeTicketId) {
          setErrors((prev) => ({ ...prev, [activeTicketId]: `Failed to get workflow: ${err}` }));
        }
        return null;
      }
    },
    [projectDir, queryClient, activeTicketId],
  );

  // getWorkflowState — imperative (called after executeStep, from notifications, etc.)
  const getWorkflowState = useCallback(
    async (issueId: string) => {
      try {
        const state = await commands.workflowState(projectDir, issueId);
        if (state) {
          setWorkflowStates((prev) => ({ ...prev, [issueId]: state }));
        }
        return state;
      } catch (err) {
        setErrors((prev) => ({ ...prev, [issueId]: `Failed to get workflow state: ${err}` }));
        return null;
      }
    },
    [projectDir],
  );

  // getDiff — imperative, called by views with variable params
  const getDiff = useCallback(
    async (dirOverride?: string, baseCommit?: string) => {
      try {
        return await commands.workflowGetDiff(dirOverride ?? projectDir, baseCommit ?? null);
      } catch (err) {
        if (activeTicketId) {
          setErrors((prev) => ({ ...prev, [activeTicketId]: `Failed to get diff: ${err}` }));
        }
        return [] as DiffFile[];
      }
    },
    [projectDir, activeTicketId],
  );

  // getBranchInfo — imperative
  const getBranchInfo = useCallback(
    async (dirOverride?: string) => {
      try {
        return await commands.workflowGetBranchInfo(dirOverride ?? projectDir);
      } catch (err) {
        if (activeTicketId) {
          setErrors((prev) => ({
            ...prev,
            [activeTicketId]: `Failed to get branch info: ${err}`,
          }));
        }
        return null as BranchInfo | null;
      }
    },
    [projectDir, activeTicketId],
  );

  // ── Mutations ──

  const assignWorkflow = useCallback(
    async (issueId: string, workflowId: string) => {
      try {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: true }));
        const state = await commands.workflowAssign(projectDir, issueId, workflowId);
        setWorkflowStates((prev) => ({ ...prev, [issueId]: state }));
        return state;
      } catch (err) {
        setErrors((prev) => ({ ...prev, [issueId]: `Failed to assign workflow: ${err}` }));
        return null;
      } finally {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: false }));
      }
    },
    [projectDir],
  );

  const { clearPending: clearPermissionPending } = permissions;

  const executeStep = useCallback(
    async (issueId: string, userMessage?: string) => {
      // Cancel any pending unload timer when agent restarts
      if (unloadTimersRef.current[issueId]) {
        clearTimeout(unloadTimersRef.current[issueId]);
        delete unloadTimersRef.current[issueId];
      }

      try {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: true }));
        setErrors((prev) => ({ ...prev, [issueId]: null }));

        const ticketState = workflowStates[issueId];
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
        executingStepsRef.current[issueId] =
          currentStepsRef.current[issueId] ?? lastCompletedStepId;
        setWorkflowStates((prev) => {
          const s = prev[issueId];
          return s ? { ...prev, [issueId]: { ...s, step_status: "in_progress" } } : prev;
        });
        const channel = createStreamChannelRef.current();
        const result = await commands.workflowExecuteStep(
          projectDir,
          issueId,
          channel,
          userMessage ?? null,
        );

        executingStepsRef.current[issueId] = null;
        await getWorkflowState(issueId);
        return result as StepExecutionResult;
      } catch (err) {
        executingStepsRef.current[issueId] = null;
        clearPermissionPending(issueId);
        setErrors((prev) => ({ ...prev, [issueId]: `Step execution failed: ${err}` }));
        await getWorkflowState(issueId);
        return null;
      } finally {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: false }));
      }
    },
    [projectDir, getWorkflowState, workflowStates, workflows, clearPermissionPending],
  );

  const suggestWorkflow = useCallback(
    async (issueId: string) => {
      try {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: true }));
        setErrors((prev) => ({ ...prev, [issueId]: null }));
        const channel = createStreamChannelRef.current();
        const suggestion = await commands.workflowSuggest(projectDir, issueId, channel);
        return suggestion as WorkflowSuggestion;
      } catch {
        setErrors((prev) => ({
          ...prev,
          [issueId]: `Unable to suggest workflow — please select manually`,
        }));
        return null;
      } finally {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: false }));
      }
    },
    [projectDir],
  );

  const executeCommitActionMutation = useMutation({
    mutationFn: (vars: {
      issueId: string;
      action: "commit" | "commit_and_pr";
      commitMessage: string;
    }) => {
      const channel = createStreamChannelRef.current();
      return commands.workflowExecuteCommitAction(
        projectDir,
        vars.issueId,
        vars.action,
        vars.commitMessage,
        channel,
      );
    },
  });

  const executeCommitAction = useCallback(
    async (issueId: string, action: "commit" | "commit_and_pr", commitMessage: string) => {
      try {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: true }));
        setErrors((prev) => ({ ...prev, [issueId]: null }));
        return (await executeCommitActionMutation.mutateAsync({
          issueId,
          action,
          commitMessage,
        })) as CommitActionResult;
      } catch (err) {
        setErrors((prev) => ({ ...prev, [issueId]: `Commit action failed: ${err}` }));
        return null;
      } finally {
        setLoadingTickets((prev) => ({ ...prev, [issueId]: false }));
      }
    },
    [executeCommitActionMutation],
  );

  const cleanupWorktree = useCallback(
    async (issueId: string) => {
      try {
        await commands.workflowCleanupWorktree(projectDir, issueId);
      } catch (err) {
        setErrors((prev) => ({ ...prev, [issueId]: `Failed to cleanup worktree: ${err}` }));
      }
    },
    [projectDir],
  );

  const advanceStep = useCallback(
    async (issueId: string) => {
      try {
        const newState = await commands.workflowAdvance(projectDir, issueId);
        setWorkflowStates((prev) => ({ ...prev, [issueId]: newState }));
        // Invalidate conversation cache so the next step sees prior step history
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectDir, issueId],
        });
      } catch (err) {
        setErrors((prev) => ({ ...prev, [issueId]: `Failed to advance step: ${err}` }));
      }
    },
    [projectDir, queryClient],
  );

  const setOnRefreshTicket = useCallback((fn: () => Promise<void>) => {
    onRefreshTicketRef.current = fn;
  }, []);

  const respondToPermission = permissions.respondToPermission;

  // ── Convenience accessors for the active ticket ──
  const currentState = activeTicketId ? (workflowStates[activeTicketId] ?? null) : null;
  const loading = activeTicketId ? (loadingTickets[activeTicketId] ?? false) : false;
  const error = activeTicketId ? (errors[activeTicketId] ?? null) : null;

  const runningTicketIds = useMemo(
    () =>
      new Set(
        Object.entries(loadingTickets)
          .filter(([, v]) => v)
          .map(([k]) => k),
      ),
    [loadingTickets],
  );

  return {
    workflows,
    currentState,
    loading,
    error,
    listenersReady,
    stepOutputs: streaming.stepOutputs,
    activeTicketId,
    setActiveTicketId,
    runningTicketIds,
    pendingPermission: permissions.pendingPermission,
    respondToPermission,
    notifications: notifications.notifications,
    clearNotification: notifications.clearNotification,
    lastUpdatedSectionId: notifications.lastUpdatedSectionId,
    statusText: notifications.statusText,
    autoAdvance,
    setAutoAdvance,
    advanceStep,
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
