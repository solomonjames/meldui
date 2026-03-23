import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";

interface CompactWorkflowIndicatorProps {
  steps: Array<{ id: string; name: string }>;
  currentStepId: string | null;
  completedStepIds: string[];
  autoAdvance: boolean;
  onAutoAdvanceChange: (value: boolean) => void;
}

export function CompactWorkflowIndicator({
  steps,
  currentStepId,
  completedStepIds,
  autoAdvance,
  onAutoAdvanceChange,
}: CompactWorkflowIndicatorProps) {
  if (steps.length === 0 || !currentStepId) return null;

  const currentIndex = steps.findIndex((s) => s.id === currentStepId);
  const currentStep = steps[currentIndex];
  const completedSet = new Set(completedStepIds);

  return (
    <div className="flex items-center justify-center gap-2.5 rounded-full border border-border bg-muted/50 px-5 py-2">
      <div className="flex items-center gap-1">
        {steps.map((step) => (
          <div
            key={step.id}
            data-testid={`step-dot-${step.id}`}
            data-completed={completedSet.has(step.id) ? "true" : "false"}
            className={`h-2 w-2 rounded-full ${
              completedSet.has(step.id)
                ? "bg-emerald-500"
                : "border-[1.5px] border-muted-foreground/40 bg-muted"
            }`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-foreground">{currentStep?.name}</span>
      <span className="font-mono text-xs text-muted-foreground">
        [{currentIndex + 1}/{steps.length}]
      </span>
      <div className="h-4 w-px bg-border" />
      <Label htmlFor="auto-advance-compact" className="text-xs text-muted-foreground">
        auto
      </Label>
      <Switch
        id="auto-advance-compact"
        checked={autoAdvance}
        onCheckedChange={onAutoAdvanceChange}
        className="data-[state=checked]:bg-emerald-500"
      />
    </div>
  );
}
