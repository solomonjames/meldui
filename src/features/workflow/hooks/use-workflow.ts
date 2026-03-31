import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, events } from "@/bindings";
import { useWorkflowNotifications } from "@/features/workflow/hooks/use-workflow-notifications";
import { useWorkflowPermissions } from "@/features/workflow/hooks/use-workflow-permissions";
import { useWorkflowReview } from "@/features/workflow/hooks/use-workflow-review";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";
import { disposeTicketStores } from "@/features/workflow/stores/dispose";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import type {
  BranchInfo,
  CommitActionResult,
  DiffFile,
  StepExecutionResult,
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

  // ── Per-ticket state now in orchestration store ──
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [loadingTicketSet, setLoadingTicketSet] = useState<Set<string>>(new Set());

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

  // Keyed error setter for sub-hooks
  const setErrorKeyed = useCallback((issueId: string, msg: string) => {
    orchestrationStoreFactory.getStore(issueId).getState().setError(msg);
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

  // Update the active ticket's store when listenersReady changes
  useEffect(() => {
    if (activeTicketId) {
      orchestrationStoreFactory
        .getStore(activeTicketId)
        .getState()
        .setListenersReady(listenersReady);
    }
  }, [activeTicketId, listenersReady]);

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
            disposeTicketStores(issue_id);
            delete unloadTimersRef.current[issue_id];
          },
          10 * 60 * 1000, // 10 minutes
        );
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
  }, []);

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
          orchestrationStoreFactory
            .getStore(activeTicketId)
            .getState()
            .setError(`Failed to get workflow: ${err}`);
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
          orchestrationStoreFactory.getStore(issueId).getState().setWorkflowState(state);
          currentStepsRef.current[issueId] = state.current_step_id ?? null;
        }
        return state;
      } catch (err) {
        orchestrationStoreFactory
          .getStore(issueId)
          .getState()
          .setError(`Failed to get workflow state: ${err}`);
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
          orchestrationStoreFactory
            .getStore(activeTicketId)
            .getState()
            .setError(`Failed to get diff: ${err}`);
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
          orchestrationStoreFactory
            .getStore(activeTicketId)
            .getState()
            .setError(`Failed to get branch info: ${err}`);
        }
        return null as BranchInfo | null;
      }
    },
    [projectDir, activeTicketId],
  );

  // ── Mutations ──

  const assignWorkflow = useCallback(
    async (issueId: string, workflowId: string) => {
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

      const store = orchestrationStoreFactory.getStore(issueId);

      try {
        store.getState().setLoading(true);
        store.getState().setError(null);
        setLoadingTicketSet((prev) => new Set(prev).add(issueId));

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
        executingStepsRef.current[issueId] =
          currentStepsRef.current[issueId] ?? lastCompletedStepId;
        const ws = store.getState().workflowState;
        if (ws) {
          store.getState().setWorkflowState({ ...ws, step_status: "in_progress" });
        }
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
        store.getState().setError(`Step execution failed: ${err}`);
        await getWorkflowState(issueId);
        return null;
      } finally {
        store.getState().setLoading(false);
        setLoadingTicketSet((prev) => {
          const next = new Set(prev);
          next.delete(issueId);
          return next;
        });
      }
    },
    [projectDir, getWorkflowState, workflows, clearPermissionPending],
  );

  const suggestWorkflow = useCallback(
    async (issueId: string) => {
      const store = orchestrationStoreFactory.getStore(issueId);
      try {
        store.getState().setLoading(true);
        store.getState().setError(null);
        setLoadingTicketSet((prev) => new Set(prev).add(issueId));
        const channel = createStreamChannelRef.current();
        const suggestion = await commands.workflowSuggest(projectDir, issueId, channel);
        return suggestion as WorkflowSuggestion;
      } catch {
        store.getState().setError("Unable to suggest workflow — please select manually");
        return null;
      } finally {
        store.getState().setLoading(false);
        setLoadingTicketSet((prev) => {
          const next = new Set(prev);
          next.delete(issueId);
          return next;
        });
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
      const store = orchestrationStoreFactory.getStore(issueId);
      try {
        store.getState().setLoading(true);
        store.getState().setError(null);
        return (await executeCommitActionMutation.mutateAsync({
          issueId,
          action,
          commitMessage,
        })) as CommitActionResult;
      } catch (err) {
        store.getState().setError(`Commit action failed: ${err}`);
        return null;
      } finally {
        store.getState().setLoading(false);
      }
    },
    [executeCommitActionMutation],
  );

  const cleanupWorktree = useCallback(
    async (issueId: string) => {
      try {
        await commands.workflowCleanupWorktree(projectDir, issueId);
      } catch (err) {
        orchestrationStoreFactory
          .getStore(issueId)
          .getState()
          .setError(`Failed to cleanup worktree: ${err}`);
      }
    },
    [projectDir],
  );

  const advanceStep = useCallback(
    async (issueId: string) => {
      try {
        const newState = await commands.workflowAdvance(projectDir, issueId);
        orchestrationStoreFactory.getStore(issueId).getState().setWorkflowState(newState);
        // Invalidate conversation cache so the next step sees prior step history
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectDir, issueId],
        });
      } catch (err) {
        orchestrationStoreFactory
          .getStore(issueId)
          .getState()
          .setError(`Failed to advance step: ${err}`);
      }
    },
    [projectDir, queryClient],
  );

  const setOnRefreshTicket = useCallback((fn: () => Promise<void>) => {
    onRefreshTicketRef.current = fn;
  }, []);

  const respondToPermission = permissions.respondToPermission;

  // ── Convenience accessors for the active ticket ──
  const currentState = activeTicketId
    ? orchestrationStoreFactory.getStore(activeTicketId).getState().workflowState
    : null;
  const loading = activeTicketId
    ? orchestrationStoreFactory.getStore(activeTicketId).getState().loading
    : false;
  const error = activeTicketId
    ? orchestrationStoreFactory.getStore(activeTicketId).getState().error
    : null;

  return {
    workflows,
    currentState,
    loading,
    error,
    listenersReady,
    stepOutputs: streaming.stepOutputs,
    activeTicketId,
    setActiveTicketId,
    runningTicketIds: loadingTicketSet,
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
