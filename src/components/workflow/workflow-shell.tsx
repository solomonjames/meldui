import { useEffect, useCallback, useState, useRef } from "react";
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
  PermissionRequest,
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
  onApproveGate: (issueId: string) => Promise<unknown>;
  onGetDiff: () => Promise<DiffFile[]>;
  onBack: () => void;
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
  onApproveGate,
  onGetDiff,
  onBack,
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

  const handleExecute = useCallback(async () => {
    const result = await onExecuteStep(ticket.id);
    if (result) {
      setLastResult(result);
    }
  }, [ticket.id, onExecuteStep]);

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
      .then((result) => {
        if (!cancelled && result) {
          debug.log("lifecycle", `auto-execute completed for step ${currentStep.id}`);
          setLastResult(result);
        }
      })
      .catch((err) => {
        debug.log("error", `auto-execute failed: ${err}`);
        // Reset so retry is possible
        executingRef.current.stepId = null;
      });

    return () => { cancelled = true; };
  }, [workflowState.current_step_id, workflowState.step_status, loading, listenersReady, currentStep, onExecuteStep, ticket.id, debug]);

  const handleApprove = useCallback(async () => {
    await onApproveGate(ticket.id);
    setLastResult(null);
  }, [ticket.id, onApproveGate]);

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

  const isAwaitingGate = workflowState.step_status === "awaiting_gate";
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
            isAwaitingGate={isAwaitingGate}
            stepStatus={workflowState.step_status}
            stepOutput={currentStepOutput}
            onApprove={handleApprove}
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
            isAwaitingGate={isAwaitingGate}
            onApprove={handleApprove}
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
            isAwaitingGate={isAwaitingGate}
            onApprove={handleApprove}
            onGetDiff={onGetDiff}
          />
        );
      case "commit":
        return (
          <CommitView
            ticket={ticket}
            response={responseText}
            isAwaitingGate={isAwaitingGate}
            onApprove={handleApprove}
            onBack={onBack}
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
      {isFailed && (
        <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">
            Step failed: {(workflowState.step_status as { failed: string }).failed}
          </p>
          <button
            onClick={handleExecute}
            className="mt-1 text-xs text-red-600 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
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
