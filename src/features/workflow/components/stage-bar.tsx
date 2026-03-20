import { Check, ChevronRight } from "lucide-react";
import type { WorkflowStep, StepRecord } from "@/shared/types";

interface StageBarProps {
  steps: WorkflowStep[];
  currentStepId: string | null;
  stepHistory: StepRecord[];
  onStepClick?: (stepId: string) => void;
}

export function StageBar({
  steps,
  currentStepId,
  stepHistory,
  onStepClick,
}: StageBarProps) {
  const completedIds = new Set(
    stepHistory
      .filter((r) => r.status === "completed")
      .map((r) => r.step_id)
  );

  return (
    <div data-testid="stage-bar" className="flex items-center gap-1 px-6 py-3 border-b bg-white dark:bg-zinc-900 overflow-x-auto">
      {steps.map((step, idx) => {
        const isCompleted = completedIds.has(step.id);
        const isCurrent = step.id === currentStepId;
        const isPending = !isCompleted && !isCurrent;

        return (
          <div key={step.id} data-testid={`stage-step-${step.id}`} className="flex items-center gap-1 shrink-0">
            {idx > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />
            )}
            <button
              onClick={() => onStepClick?.(step.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isCurrent
                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                  : isCompleted
                    ? "text-zinc-500 dark:text-zinc-400"
                    : isPending
                      ? "text-zinc-400 dark:text-zinc-600"
                      : ""
              }`}
            >
              {isCompleted && (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              )}
              {isCurrent && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
              {step.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
