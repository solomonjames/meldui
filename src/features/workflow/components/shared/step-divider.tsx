interface StepDividerProps {
  label: string;
  stepId?: string;
  variant?: "default" | "complete";
}

export function StepDividerBar({ label, stepId, variant = "default" }: StepDividerProps) {
  const isComplete = variant === "complete";
  return (
    <div className="flex items-center gap-3 py-3" data-step-id={stepId}>
      <div className={`h-px flex-1 ${isComplete ? "bg-emerald-500/30" : "bg-border"}`} />
      <span
        className={`text-xs font-medium uppercase tracking-wider ${
          isComplete
            ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 leading-none"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <div className={`h-px flex-1 ${isComplete ? "bg-emerald-500/30" : "bg-border"}`} />
    </div>
  );
}
