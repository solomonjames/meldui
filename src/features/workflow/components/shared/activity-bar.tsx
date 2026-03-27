import { useEffect, useRef, useState } from "react";
import { TOOL_LABELS } from "@/features/workflow/components/shared/tool-labels";
import type { StepOutputStream } from "@/shared/types";

interface ActivityBarProps {
  stepOutput?: StepOutputStream;
  isExecuting: boolean;
  isWaitingForUser?: boolean;
  stepName?: string;
}

function useElapsedTimer(startTime: number | null): number {
  const computeElapsed = () => (startTime ? Math.floor((Date.now() - startTime) / 1000) : 0);
  const [elapsed, setElapsed] = useState(computeElapsed);

  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Reset synchronously when startTime changes to null (no effect needed)
  if (!startTime && elapsed !== 0) {
    return 0;
  }

  return elapsed;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ActivityBar({
  stepOutput,
  isExecuting,
  isWaitingForUser,
  stepName,
}: ActivityBarProps) {
  const activeToolName = stepOutput?.activeToolName ?? null;
  const activeToolStartTime = stepOutput?.activeToolStartTime ?? null;
  const isCompacting = stepOutput?.isCompacting ?? false;
  const isThinking =
    isExecuting &&
    (stepOutput?.thinkingContent?.length ?? 0) > 0 &&
    !activeToolName &&
    (stepOutput?.toolActivities?.length ?? 0) === 0;
  const hasRunningSubagent = (stepOutput?.subagentActivities ?? []).some(
    (s) => s.status === "running",
  );
  const toolElapsed = useElapsedTimer(activeToolStartTime);

  // Track total step elapsed time
  const stepStartRef = useRef<number | null>(null);
  if (isExecuting && !stepStartRef.current) {
    stepStartRef.current = Date.now();
  } else if (!isExecuting) {
    stepStartRef.current = null;
  }
  const stepElapsed = useElapsedTimer(stepStartRef.current);

  const hasResult = stepOutput?.resultContent != null;
  if (!isExecuting || isWaitingForUser || hasResult) {
    return <div className="h-0 opacity-0 transition-all duration-300" />;
  }

  // Determine current activity detail
  let activityIcon: React.ReactNode;
  let activityText: string;

  if (isCompacting) {
    activityIcon = (
      <svg
        aria-hidden="true"
        className="w-3 h-3 text-amber-500 animate-pulse"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
    activityText = "Compacting context";
  } else if (activeToolName) {
    activityIcon = (
      <div className="relative w-3 h-3 shrink-0">
        <div className="absolute inset-0 rounded-full border-[1.5px] border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
    const label = TOOL_LABELS[activeToolName] ?? activeToolName;
    activityText = `${label}… ${toolElapsed}s`;
  } else if (hasRunningSubagent) {
    const running = stepOutput!.subagentActivities.find((s) => s.status === "running");
    activityIcon = (
      <div className="relative w-3 h-3 shrink-0">
        <div className="absolute inset-0 rounded-full border-[1.5px] border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
    activityText = `Running: ${running?.description ?? "subagent"}`;
  } else if (isThinking) {
    activityIcon = (
      <div className="flex gap-0.5">
        <span
          className="w-0.5 h-0.5 rounded-full bg-violet-400 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-0.5 h-0.5 rounded-full bg-violet-400 animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-0.5 h-0.5 rounded-full bg-violet-400 animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    );
    activityText = "Thinking";
  } else {
    activityIcon = null;
    activityText = "";
  }

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[11px] text-muted-foreground transition-all duration-300">
      {/* Left: step indicator */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex gap-0.5">
          <span
            className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        {stepName && <span className="font-medium text-foreground truncate">{stepName}</span>}
      </div>

      {/* Center: current activity */}
      {activityText && (
        <div className="flex items-center gap-1.5 text-muted-foreground/70">
          <span className="text-muted-foreground/30">·</span>
          {activityIcon}
          <span>{activityText}</span>
        </div>
      )}

      {/* Right: total step timer */}
      <span className="ml-auto font-mono tabular-nums text-emerald-500/80">
        {formatTimer(stepElapsed)}
      </span>
    </div>
  );
}
