import { useEffect, useCallback, useState } from "react";
import { StageBar } from "./stage-bar";
import { ChatView } from "./views/chat-view";
import { ReviewView } from "./views/review-view";
import { ProgressView } from "./views/progress-view";
import { DiffReviewView } from "./views/diff-review-view";
import { CommitView } from "./views/commit-view";
import type {
  BeadsIssue,
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
  DiffFile,
} from "@/types";

interface WorkflowShellProps {
  issue: BeadsIssue;
  projectDir: string;
  workflowState: WorkflowState;
  workflowDefinition: WorkflowDefinition | null;
  streamOutput: string;
  loading: boolean;
  error: string | null;
  onExecuteStep: (issueId: string) => Promise<StepExecutionResult | null>;
  onApproveGate: (issueId: string) => Promise<unknown>;
  onGetDiff: () => Promise<DiffFile[]>;
  onBack: () => void;
}

export function WorkflowShell({
  issue,
  workflowState,
  workflowDefinition,
  streamOutput,
  loading,
  error,
  onExecuteStep,
  onApproveGate,
  onGetDiff,
  onBack,
}: WorkflowShellProps) {
  const [lastResult, setLastResult] = useState<StepExecutionResult | null>(null);

  const currentStep = workflowDefinition?.steps.find(
    (s) => s.id === workflowState.current_step_id
  );

  const handleExecute = useCallback(async () => {
    const result = await onExecuteStep(issue.id);
    if (result) {
      setLastResult(result);
    }
  }, [issue.id, onExecuteStep]);

  // Auto-execute on pending steps — subscribe to step output events
  useEffect(() => {
    if (
      workflowState.step_status !== "pending" ||
      !currentStep ||
      loading
    ) {
      return;
    }

    let cancelled = false;
    onExecuteStep(issue.id)
      .then((result) => {
        if (!cancelled && result) setLastResult(result);
      })
      .catch(() => {
        // Error is already handled by the hook's setError
      });

    return () => { cancelled = true; };
    // Only trigger on step changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowState.current_step_id]);

  const handleApprove = useCallback(async () => {
    await onApproveGate(issue.id);
    setLastResult(null);
  }, [issue.id, onApproveGate]);

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
              All steps have been completed for {issue.title}
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
  const isFailed = typeof workflowState.step_status === "object" && "failed" in workflowState.step_status;
  const responseText = lastResult?.response ?? streamOutput;

  const renderView = () => {
    switch (currentStep.view) {
      case "chat":
        return (
          <ChatView
            issue={issue}
            stepName={currentStep.name}
            response={responseText}
            isExecuting={isExecuting}
            isAwaitingGate={isAwaitingGate}
            onApprove={handleApprove}
            onExecute={handleExecute}
          />
        );
      case "review":
        return (
          <ReviewView
            issue={issue}
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
            streamOutput={streamOutput}
            isExecuting={isExecuting}
            response={lastResult?.response}
          />
        );
      case "diff_review":
        return (
          <DiffReviewView
            issue={issue}
            isAwaitingGate={isAwaitingGate}
            onApprove={handleApprove}
            onGetDiff={onGetDiff}
          />
        );
      case "commit":
        return (
          <CommitView
            issue={issue}
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
    <div className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950">
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
    </div>
  );
}
