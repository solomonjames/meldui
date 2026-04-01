import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { commands } from "@/bindings";
import {
  advanceStep,
  cleanupWorktree,
  executeCommitAction,
  executeStep,
  respondToPermission,
  submitReview,
} from "@/features/workflow/actions/workflow-mutations";
import { fetchBranchInfo, fetchDiff } from "@/features/workflow/actions/workflow-queries";
import { ChangesTab } from "@/features/workflow/components/changes-tab";
import { CommitTab } from "@/features/workflow/components/commit-tab";
import { CompactWorkflowIndicator } from "@/features/workflow/components/compact-workflow-indicator";
import { DebugPanel } from "@/features/workflow/components/debug-panel";
import { ChatView } from "@/features/workflow/components/views/chat-view";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import { useDebugLog } from "@/shared/hooks/use-debug-log";
import type { Ticket, WorkflowDefinition } from "@/shared/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

interface WorkflowShellProps {
  ticket: Ticket;
  projectDir: string;
  workflows: WorkflowDefinition[];
  onNavigateToBacklog: () => void;
  onRefreshTicket: () => Promise<void>;
  scrollToStepRef?: React.MutableRefObject<(stepId: string) => void>;
}

export function WorkflowShell({
  ticket,
  projectDir,
  workflows,
  onNavigateToBacklog,
  onRefreshTicket,
  scrollToStepRef,
}: WorkflowShellProps) {
  const workflowState = orchestrationStoreFactory.useTicketStore(ticket.id, (s) => s.workflowState);
  const loading = orchestrationStoreFactory.useTicketStore(ticket.id, (s) => s.loading);
  const error = orchestrationStoreFactory.useTicketStore(ticket.id, (s) => s.error);
  const listenersReady = orchestrationStoreFactory.useTicketStore(
    ticket.id,
    (s) => s.listenersReady,
  );
  const autoAdvanceStore = orchestrationStoreFactory.useTicketStore(
    ticket.id,
    (s) => s.autoAdvance,
  );
  const queryStartedAt = orchestrationStoreFactory.useTicketStore(
    ticket.id,
    (s) => s.queryStartedAt,
  );

  // Narrow selector: subscribe only to the current step's output, not the entire record.
  const stepOutputKey = (() => {
    const history = workflowState?.step_history ?? [];
    const currentStepId = workflowState?.current_step_id;
    const stepId =
      currentStepId ?? (history.length > 0 ? history[history.length - 1].step_id : null);
    return stepId ? `${ticket.id}:${stepId}` : "";
  })();
  const currentStepOutput = streamingStoreFactory.useTicketStore(
    ticket.id,
    useCallback((s) => s.stepOutputs[stepOutputKey], [stepOutputKey]),
  );

  const pendingPermission = permissionsStoreFactory.useTicketStore(
    ticket.id,
    (s) => s.pendingPermission,
  );

  const notifications = notificationsStoreFactory.useTicketStore(ticket.id, (s) => s.notifications);
  const onClearNotification = useCallback(
    (index: number) => {
      notificationsStoreFactory.getStore(ticket.id).getState().clearNotification(index);
    },
    [ticket.id],
  );

  const reviewFindings = reviewStoreFactory.useTicketStore(ticket.id, (s) => s.findings);
  const reviewComments = reviewStoreFactory.useTicketStore(ticket.id, (s) => s.comments);
  const pendingReviewRequestId = reviewStoreFactory.useTicketStore(
    ticket.id,
    (s) => s.pendingRequestId,
  );
  const reviewRoundKey = reviewStoreFactory.useTicketStore(ticket.id, (s) => s.roundKey);

  const workflowDef = useWorkflowDefinition(workflowState?.workflow_id, projectDir);
  const [lastResult, setLastResult] = useState<{
    response?: string;
  } | null>(null);
  const executingRef = useRef<{ stepId: string | null; generation: number }>({
    stepId: null,
    generation: 0,
  });
  const autoResumeAttemptRef = useRef<string | null>(null);
  const [autoResuming, setAutoResuming] = useState(false);
  const debug = useDebugLog();

  const currentStep = workflowDef?.steps.find((s) => s.id === workflowState?.current_step_id);
  const [activeTab, setActiveTab] = useState<"chat" | "changes" | "commit">("chat");

  // Auto-switch tab based on step view type
  useEffect(() => {
    if (currentStep?.view === "diff_review") setActiveTab("changes");
    else if (currentStep?.view === "commit") setActiveTab("commit");
  }, [currentStep?.view]);

  // Expose scrollToStep to parent via ref
  const scrollToStep = useCallback((stepId: string) => {
    flushSync(() => setActiveTab("chat"));
    const el = document.querySelector(`[data-step-id="${stepId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (scrollToStepRef) {
      scrollToStepRef.current = scrollToStep;
    }
  }, [scrollToStepRef, scrollToStep]);

  // Reset executing guard and clear stale result when step changes.
  /* eslint-disable react-hooks/refs */
  const prevStepIdRef = useRef(workflowState?.current_step_id);
  if (prevStepIdRef.current !== workflowState?.current_step_id) {
    prevStepIdRef.current = workflowState?.current_step_id;
    executingRef.current.stepId = null;
    autoResumeAttemptRef.current = null;
    setLastResult(null);
  }
  /* eslint-enable react-hooks/refs */

  // Show toast notifications from agent
  const lastNotifCount = useRef(0);
  useEffect(() => {
    if (notifications.length > lastNotifCount.current) {
      const newNotifs = notifications.slice(lastNotifCount.current);
      for (const notif of newNotifs) {
        switch (notif.level) {
          case "success":
            toast.success(notif.title, { description: notif.message });
            break;
          case "warning":
            toast.warning(notif.title, { description: notif.message });
            break;
          case "error":
            toast.error(notif.title, { description: notif.message });
            break;
          default:
            toast.info(notif.title, { description: notif.message });
        }
      }
    }
    lastNotifCount.current = notifications.length;
  }, [notifications]);

  // Clear notifications when consumed
  useEffect(() => {
    if (notifications.length > 0) {
      for (let i = notifications.length - 1; i >= 0; i--) {
        onClearNotification(i);
      }
    }
  }, [notifications, onClearNotification]);

  // ── Action callbacks (import-based, no prop drilling) ──

  const handleExecute = useCallback(
    async (message?: string) => {
      const result = await executeStep(projectDir, ticket.id, workflows, message);
      if (result) {
        setLastResult(result);
        await onRefreshTicket();
      }
    },
    [projectDir, ticket.id, workflows, onRefreshTicket],
  );

  const handleAdvanceStep = useCallback(async () => {
    await advanceStep(projectDir, ticket.id);
    await onRefreshTicket();
  }, [projectDir, ticket.id, onRefreshTicket]);

  const handleRespondToPermission = useCallback(
    (requestId: string, allowed: boolean) => respondToPermission(ticket.id, requestId, allowed),
    [ticket.id],
  );

  const handleGetDiff = useCallback(
    (dirOverride?: string, baseCommit?: string) => fetchDiff(projectDir, dirOverride, baseCommit),
    [projectDir],
  );

  const handleGetBranchInfo = useCallback(
    (dirOverride?: string) => fetchBranchInfo(projectDir, dirOverride),
    [projectDir],
  );

  const handleExecuteCommitAction = useCallback(
    (issueId: string, action: "commit" | "commit_and_pr", commitMessage: string) =>
      executeCommitAction(projectDir, issueId, action, commitMessage),
    [projectDir],
  );

  const handleCleanupWorktree = useCallback(
    (issueId: string) => cleanupWorktree(projectDir, issueId),
    [projectDir],
  );

  const handleAddReviewComment = useCallback(
    (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
      reviewStoreFactory
        .getStore(ticket.id)
        .getState()
        .addComment(filePath, lineNumber, content, suggestion);
    },
    [ticket.id],
  );

  const handleDeleteReviewComment = useCallback(
    (commentId: string) => {
      reviewStoreFactory.getStore(ticket.id).getState().deleteComment(commentId);
    },
    [ticket.id],
  );

  const handleSubmitReview = useCallback(
    (submission: Parameters<typeof submitReview>[1]) => submitReview(ticket.id, submission),
    [ticket.id],
  );

  // Auto-execute on pending steps
  useEffect(() => {
    const guards = {
      status: workflowState?.step_status,
      loading,
      listenersReady,
      hasStep: !!currentStep,
    };

    if (workflowState?.step_status !== "pending" || !currentStep || loading || !listenersReady) {
      debug.log("lifecycle", `auto-execute skipped: ${JSON.stringify(guards)}`);
      return;
    }

    const gen = ++executingRef.current.generation;
    if (executingRef.current.stepId === currentStep.id) {
      debug.log("lifecycle", `auto-execute skipped: already executing ${currentStep.id}`);
      return;
    }
    executingRef.current.stepId = currentStep.id;

    debug.log("lifecycle", `auto-execute fired for step ${currentStep.id} (gen=${gen})`);

    let cancelled = false;
    executeStep(projectDir, ticket.id, workflows)
      .then(async (result) => {
        if (!cancelled && result) {
          debug.log("lifecycle", `auto-execute completed for step ${currentStep.id}`);
          setLastResult(result);
          await onRefreshTicket();
        }
      })
      .catch((err) => {
        debug.log("error", `auto-execute failed: ${err}`);
        executingRef.current.stepId = null;
      });

    return () => {
      cancelled = true;
    };
  }, [
    workflowState?.step_status,
    loading,
    listenersReady,
    currentStep,
    projectDir,
    ticket.id,
    workflows,
    onRefreshTicket,
    debug,
  ]);

  // Auto-resume interrupted sessions on app reopen
  useEffect(() => {
    if (!currentStep || loading || !listenersReady) return;
    if (typeof workflowState?.step_status !== "object") return;
    if (!("failed" in workflowState.step_status)) return;

    const failReason = workflowState.step_status.failed;
    const isResumable = failReason.includes("timed out") || failReason.includes("interrupted");
    if (!isResumable) return;

    const resumeKey = `${currentStep.id}-${failReason}`;
    if (autoResumeAttemptRef.current === resumeKey) return;
    autoResumeAttemptRef.current = resumeKey;

    debug.log("lifecycle", `auto-resume fired for step ${currentStep.id}`);
    setAutoResuming(true);

    let cancelled = false;
    executeStep(projectDir, ticket.id, workflows)
      .then(async (result) => {
        if (!cancelled && result) {
          debug.log("lifecycle", `auto-resume completed for step ${currentStep.id}`);
          setLastResult(result);
          await onRefreshTicket();
        }
      })
      .catch((err) => {
        debug.log("error", `auto-resume failed: ${err}`);
      })
      .finally(() => {
        if (!cancelled) {
          setAutoResuming(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    workflowState?.step_status,
    loading,
    listenersReady,
    currentStep,
    projectDir,
    ticket.id,
    workflows,
    onRefreshTicket,
    debug,
  ]);

  // Auto-advance when step completes and autoAdvance is enabled
  const autoAdvancingRef = useRef(false);
  useEffect(() => {
    if (!autoAdvanceStore) return;
    if (workflowState?.step_status !== "completed") return;
    if (!workflowState.current_step_id) return;
    if (autoAdvancingRef.current) return;

    const timer = setTimeout(() => {
      autoAdvancingRef.current = true;
      advanceStep(projectDir, ticket.id)
        .then(() => onRefreshTicket())
        .finally(() => {
          autoAdvancingRef.current = false;
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [
    autoAdvanceStore,
    workflowState?.step_status,
    workflowState?.current_step_id,
    projectDir,
    ticket.id,
    onRefreshTicket,
  ]);

  if (!workflowDef) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading workflow...</p>
      </div>
    );
  }

  if (!workflowState) {
    return null;
  }

  const completedStepIds = (workflowState?.step_history ?? []).map((r) => r.step_id);
  const workflowComplete = !currentStep && completedStepIds.length > 0;

  const isExecuting = workflowComplete
    ? loading
    : workflowState.step_status === "in_progress" || loading;
  const isFailed =
    !workflowComplete &&
    typeof workflowState.step_status === "object" &&
    "failed" in workflowState.step_status;
  const responseText = lastResult?.response ?? currentStepOutput?.textContent ?? "";
  const reviewDisabled = !pendingReviewRequestId;
  const agentCommitMessage = lastResult?.response ?? currentStepOutput?.textContent ?? null;

  return (
    <div
      data-testid="workflow-shell"
      data-status={
        typeof workflowState.step_status === "string" ? workflowState.step_status : "failed"
      }
      className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950"
    >
      {error && (
        <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {isFailed &&
        !autoResuming &&
        (() => {
          const failReason = (workflowState.step_status as { failed: string }).failed;
          const isResumable =
            failReason.includes("timed out") || failReason.includes("interrupted");
          return (
            <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {isResumable
                    ? "Session interrupted — your progress is saved."
                    : `Step failed: ${failReason}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleExecute}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
              >
                {isResumable ? "Resume" : "Retry"}
              </button>
            </div>
          );
        })()}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "chat" | "changes" | "commit")}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <TabsList className="ml-2 rounded-none border-0 bg-transparent h-auto p-0">
            <TabsTrigger
              value="chat"
              className="rounded-none border-0 px-3 py-2.5 text-xs font-medium data-active:shadow-none data-active:bg-transparent"
            >
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="changes"
              className="rounded-none border-0 px-3 py-2.5 text-xs font-medium data-active:shadow-none data-active:bg-transparent"
            >
              Changes
            </TabsTrigger>
            <TabsTrigger
              value="commit"
              className="rounded-none border-0 px-3 py-2.5 text-xs font-medium data-active:shadow-none data-active:bg-transparent"
            >
              Commit
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="chat" keepMounted className="flex flex-1 flex-col overflow-hidden">
          <div className="flex justify-center px-4 py-2.5">
            <div className="shadow-[0_0_20px_rgba(16,185,129,0.12)] dark:shadow-[0_0_20px_rgba(16,185,129,0.15)] rounded-full">
              <CompactWorkflowIndicator
                steps={workflowDef.steps}
                currentStepId={workflowState.current_step_id}
                completedStepIds={completedStepIds}
                autoAdvance={autoAdvanceStore}
                onAutoAdvanceChange={(enabled) =>
                  orchestrationStoreFactory.getStore(ticket.id).getState().setAutoAdvance(enabled)
                }
              />
            </div>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <ChatView
              stepName={currentStep?.name ?? "Complete"}
              response={responseText}
              isExecuting={isExecuting}
              stepStatus={workflowComplete ? "completed" : workflowState.step_status}
              stepOutput={currentStepOutput}
              queryStartedAt={queryStartedAt}
              onExecute={handleExecute}
              onAdvanceStep={!workflowComplete ? handleAdvanceStep : undefined}
              projectDir={projectDir}
              ticketId={ticket.id}
              isInteractive={
                workflowComplete || currentStep?.view === "chat" || currentStep?.view === "review"
              }
              pendingPermission={pendingPermission}
              onRespondToPermission={handleRespondToPermission}
              workflowComplete={workflowComplete}
              onMarkComplete={onNavigateToBacklog}
            />
          </div>
        </TabsContent>
        <TabsContent value="changes" className="flex flex-1 flex-col overflow-hidden">
          <ChangesTab
            ticket={ticket}
            onGetDiff={handleGetDiff}
            reviewFindings={reviewFindings}
            reviewComments={reviewComments}
            onAddComment={handleAddReviewComment}
            onDeleteComment={handleDeleteReviewComment}
            onSubmitReview={handleSubmitReview}
            reviewDisabled={reviewDisabled}
            reviewRoundKey={reviewRoundKey}
          />
        </TabsContent>
        <TabsContent value="commit" className="flex flex-1 flex-col overflow-hidden">
          <CommitTab
            ticket={ticket}
            agentCommitMessage={agentCommitMessage}
            onNavigateToBacklog={onNavigateToBacklog}
            onGetDiff={handleGetDiff}
            onGetBranchInfo={handleGetBranchInfo}
            onExecuteCommitAction={handleExecuteCommitAction}
            onCleanupWorktree={handleCleanupWorktree}
            onRefreshTicket={onRefreshTicket}
          />
        </TabsContent>
      </Tabs>
      <DebugPanel
        entries={debug.getEntries()}
        stateSnapshot={{
          step_status: workflowState.step_status,
          loading,
          error,
          listenersReady,
          currentStepId: workflowState.current_step_id,
        }}
        onClear={debug.clear}
        onRefresh={debug.refresh}
      />
    </div>
  );
}

/** Internal hook to load workflow definition via Tauri command */
function useWorkflowDefinition(workflowId: string | null | undefined, projectDir: string) {
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const prevWorkflowId = useRef<string | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    if (prevWorkflowId.current === workflowId) return;
    prevWorkflowId.current = workflowId;
    commands.workflowGet(projectDir, workflowId).then(setDef);
  }, [workflowId, projectDir]);

  return def;
}
