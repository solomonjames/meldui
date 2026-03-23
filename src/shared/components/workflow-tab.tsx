import { Check, Circle, CircleDot } from "lucide-react";
import type { StepRecord, WorkflowStep } from "@/shared/types";

interface WorkflowTabProps {
  steps: Pick<WorkflowStep, "id" | "name" | "description">[];
  currentStepId: string | null;
  stepHistory: StepRecord[];
  onStepClick: (stepId: string) => void;
}

export function WorkflowTab({ steps, currentStepId, stepHistory, onStepClick }: WorkflowTabProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        No workflow assigned
      </div>
    );
  }

  const completedMap = new Map(stepHistory.map((h) => [h.step_id, h]));

  return (
    <div className="flex flex-col gap-1 p-2">
      {steps.map((step) => {
        const historyEntry = completedMap.get(step.id);
        const isCompleted = !!historyEntry;
        const isCurrent = step.id === currentStepId;
        const isClickable = isCompleted;

        return (
          <button
            type="button"
            key={step.id}
            onClick={() => isClickable && onStepClick(step.id)}
            disabled={!isClickable}
            data-testid={
              isCompleted ? "step-completed" : isCurrent ? "step-current" : "step-pending"
            }
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-left transition-colors ${
              isCurrent
                ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : isCompleted
                  ? "cursor-pointer text-emerald-400 hover:bg-muted/50"
                  : "cursor-default text-muted-foreground/50"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {isCompleted ? (
                <Check className="h-4 w-4" />
              ) : isCurrent ? (
                <CircleDot className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{step.name}</div>
              {step.description && (
                <div className="text-xs text-muted-foreground/70">{step.description}</div>
              )}
              {historyEntry?.completed_at && (
                <div className="mt-0.5 text-xs text-muted-foreground/50">
                  {new Date(historyEntry.completed_at).toLocaleTimeString()}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
