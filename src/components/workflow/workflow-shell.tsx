import { useEffect, useCallback, useState, useRef } from "react";
import { Toaster, toast } from "sonner";
import { StageBar } from "./stage-bar";
import { DebugPanel } from "./debug-panel";
import { ChatView } from "./views/chat-view";
import { ReviewView } from "./views/review-view";
import { ProgressView } from "./views/progress-view";
import { DiffReviewView } from "./views/diff-review-view";
import { CommitView } from "./views/commit-view";
import { useDebugLog } from "@/hooks/use-debug-log";
import type {
  Ticket,
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
  StepOutputStream,
  DiffFile,
  BranchInfo,
  CommitActionResult,
  PermissionRequest,
  NotificationEvent,
  FeedbackRequestEvent,
  ReviewFinding,
  ReviewComment,
  ReviewSubmission,
} from "@/types";

interface WorkflowShellProps {
  ticket: Ticket;
  projectDir: string;
  workflowState: WorkflowState;
  workflowDefinition: WorkflowDefinition | null;
  stepOutputs: Record<string, StepOutputStream>;
  loading: boolean;
  error: string | null;
  listenersReady: boolean;
  pendingPermission: PermissionRequest | null;
  onRespondToPermission: (requestId: string, allowed: boolean) => void;
  onExecuteStep: (issueId: string) => Promise<StepExecutionResult | null>;
  onGetDiff: (dirOverride?: string) => Promise<DiffFile[]>;
  onBack: () => void;
  onRefreshTicket: () => Promise<void>;
  notifications: NotificationEvent[];
  onClearNotification: (index: number) => void;
  statusText: string | null;
  pendingFeedback: FeedbackRequestEvent | null;
  onRespondToFeedback: (requestId: string, approved: boolean, feedback?: string) => void;
  reviewFindings: ReviewFinding[];
  reviewComments: ReviewComment[];
  onAddReviewComment: (filePath: string, lineNumber: number, content: string, suggestion?: string) => void;
  onDeleteReviewComment: (commentId: string) => void;
  onSubmitReview: (submission: ReviewSubmission) => void;
  reviewDisabled?: boolean;
  onGetBranchInfo: (dirOverride?: string) => Promise<BranchInfo | null>;
  onExecuteCommitAction: (issueId: string, action: "commit" | "commit_and_pr", commitMessage: string) => Promise<CommitActionResult | null>;
  onCleanupWorktree: (issueId: string) => Promise<void>;
}

export function WorkflowShell({
  ticket,
  workflowState,
  workflowDefinition,
  stepOutputs,
  loading,
  error,
  listenersReady,
  pendingPermission,
  onRespondToPermission,
  onExecuteStep,
  onGetDiff,
  onBack,
  onRefreshTicket,
  notifications,
  onClearNotification,
  statusText,
  pendingFeedback,
  onRespondToFeedback,
  reviewFindings,
  reviewComments,
  onAddReviewComment,
  onDeleteReviewComment,
  onSubmitReview,
  reviewDisabled,
  onGetBranchInfo,
  onExecuteCommitAction,
  onCleanupWorktree,
}: WorkflowShellProps) {
  const [lastResult, setLastResult] = useState<StepExecutionResult | null>(null);
  // Use a ref with a monotonic counter to prevent StrictMode double-fire
  const executingRef = useRef<{ stepId: string | null; generation: number }>({ stepId: null, generation: 0 });
  const debug = useDebugLog();

  const currentStep = workflowDefinition?.steps.find(
    (s) => s.id === workflowState.current_step_id
  );

  // Reset executing guard when step changes so next step can auto-execute
  const prevStepId = useRef(workflowState.current_step_id);
  if (prevStepId.current !== workflowState.current_step_id) {
    prevStepId.current = workflowState.current_step_id;
    executingRef.current.stepId = null;
  }

  // Clear stale result from previous step so it doesn't appear in the new step's view
  useEffect(() => {
    setLastResult(null);
  }, [workflowState.current_step_id]);

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

  const handleExecute = useCallback(async () => {
    const result = await onExecuteStep(ticket.id);
    if (result) {
      setLastResult(result);
      await onRefreshTicket();
    }
  }, [ticket.id, onExecuteStep, onRefreshTicket]);

  // Auto-execute on pending steps
  useEffect(() => {
    const guards = { status: workflowState.step_status, loading, listenersReady, hasStep: !!currentStep };

    if (
      workflowState.step_status !== "pending" ||
      !currentStep ||
      loading ||
      !listenersReady
    ) {
      debug.log("lifecycle", `auto-execute skipped: ${JSON.stringify(guards)}`);
      return;
    }

    // Prevent double execution — generation counter survives StrictMode remounts
    const gen = ++executingRef.current.generation;
    if (executingRef.current.stepId === currentStep.id) {
      debug.log("lifecycle", `auto-execute skipped: already executing ${currentStep.id}`);
      return;
    }
    executingRef.current.stepId = currentStep.id;

    debug.log("lifecycle", `auto-execute fired for step ${currentStep.id} (gen=${gen})`);

    let cancelled = false;
    onExecuteStep(ticket.id)
      .then(async (result) => {
        if (!cancelled && result) {
          debug.log("lifecycle", `auto-execute completed for step ${currentStep.id}`);
          setLastResult(result);
          await onRefreshTicket();
        }
      })
      .catch((err) => {
        debug.log("error", `auto-execute failed: ${err}`);
        // Reset so retry is possible
        executingRef.current.stepId = null;
      });

    return () => { cancelled = true; };
  }, [workflowState.current_step_id, workflowState.step_status, loading, listenersReady, currentStep, onExecuteStep, onRefreshTicket, ticket.id, debug]);

  if (!workflowDefinition) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading workflow...</p>
      </div>
    );
  }

  // Workflow completed
  if (!currentStep) {
    return (
      <div className="flex flex-col h-full">
        <StageBar
          steps={workflowDefinition.steps}
          currentStepId={null}
          stepHistory={workflowState.step_history}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <h2 className="text-xl font-semibold">Workflow Complete</h2>
            <p className="text-muted-foreground">
              All steps have been completed for {ticket.title}
            </p>
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium"
            >
              Back to Board
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isExecuting = workflowState.step_status === "in_progress" || loading;
  const isCompleted = workflowState.step_status === "completed";
  const isFailed = typeof workflowState.step_status === "object" && "failed" in workflowState.step_status;
  const currentStepOutput = currentStep ? stepOutputs[currentStep.id] : undefined;
  const responseText = lastResult?.response ?? currentStepOutput?.textContent ?? "";

  const renderView = () => {
    switch (currentStep.view) {
      case "chat":
        return (
          <ChatView
            ticket={ticket}
            stepName={currentStep.name}
            response={responseText}
            isExecuting={isExecuting}
            stepStatus={workflowState.step_status}
            stepOutput={currentStepOutput}
            statusText={statusText}
            pendingFeedback={pendingFeedback}
            onRespondToFeedback={onRespondToFeedback}
            onExecute={handleExecute}
          />
        );
      case "review":
        return (
          <ReviewView
            ticket={ticket}
            stepName={currentStep.name}
            response={responseText}
            stepHistory={workflowState.step_history}
            isExecuting={isExecuting}
          />
        );
      case "progress":
        return (
          <ProgressView
            stepName={currentStep.name}
            stepOutput={currentStepOutput}
            isExecuting={isExecuting}
            isCompleted={isCompleted}
            pendingPermission={pendingPermission}
            onRespondToPermission={onRespondToPermission}
          />
        );
      case "diff_review":
        return (
          <DiffReviewView
            ticket={ticket}
            onGetDiff={onGetDiff}
            reviewFindings={reviewFindings}
            reviewComments={reviewComments}
            onAddComment={onAddReviewComment}
            onDeleteComment={onDeleteReviewComment}
            onSubmitReview={onSubmitReview}
            reviewDisabled={reviewDisabled}
          />
        );
      case "commit":
        return (
          <CommitView
            ticket={ticket}
            response={responseText}
            onBack={onBack}
            onGetDiff={onGetDiff}
            onGetBranchInfo={onGetBranchInfo}
            onExecuteCommitAction={onExecuteCommitAction}
            onCleanupWorktree={onCleanupWorktree}
          />
        );
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">
              Unknown view type: {currentStep.view}
            </p>
          </div>
        );
    }
  };

  return (
    <div data-testid="workflow-shell" data-status={typeof workflowState.step_status === 'string' ? workflowState.step_status : 'failed'} className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950">
      <Toaster position="top-right" richColors />
      <StageBar
        steps={workflowDefinition.steps}
        currentStepId={workflowState.current_step_id}
        stepHistory={workflowState.step_history}
      />
      {error && (
        <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {isFailed && (() => {
        const failReason = (workflowState.step_status as { failed: string }).failed;
        const isResumable = failReason.includes("timed out") || failReason.includes("interrupted");
        return (
          <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm text-red-600 dark:text-red-400">
                {isResumable ? "Session interrupted — your progress is saved." : `Step failed: ${failReason}`}
              </p>
            </div>
            <button
              onClick={handleExecute}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
            >
              {isResumable ? "Resume" : "Retry"}
            </button>
          </div>
        );
      })()}
      <div className="flex-1 overflow-hidden">{renderView()}</div>
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
