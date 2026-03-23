interface StepDividerProps {
  label: string;
  stepId?: string;
}

export function StepDividerBar({ label, stepId }: StepDividerProps) {
  return (
    <div className="flex items-center gap-3 py-3" data-step-id={stepId}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
