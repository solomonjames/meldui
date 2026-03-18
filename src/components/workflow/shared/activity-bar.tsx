import { useState, useEffect } from "react";
import type { StepOutputStream } from "@/types";
import { TOOL_LABELS } from "./tool-card";

interface ActivityBarProps {
  stepOutput?: StepOutputStream;
  isExecuting: boolean;
  isWaitingForUser?: boolean;
}

function useElapsedTimer(startTime: number | null): number {
  const computeElapsed = () => startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
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

export function ActivityBar({ stepOutput, isExecuting, isWaitingForUser }: ActivityBarProps) {
  const activeToolName = stepOutput?.activeToolName ?? null;
  const activeToolStartTime = stepOutput?.activeToolStartTime ?? null;
  const isCompacting = stepOutput?.isCompacting ?? false;
  const isThinking = isExecuting
    && (stepOutput?.thinkingContent?.length ?? 0) > 0
    && !activeToolName
    && (stepOutput?.toolActivities?.length ?? 0) === 0;
  const hasRunningSubagent = (stepOutput?.subagentActivities ?? []).some((s) => s.status === "running");
  const elapsed = useElapsedTimer(activeToolStartTime);

  const hasResult = stepOutput?.resultContent != null;
  if (!isExecuting || isWaitingForUser || hasResult) {
    return <div className="h-0 opacity-0 transition-all duration-300" />;
  }

  let icon: React.ReactNode;
  let text: string;

  if (isCompacting) {
    icon = (
      <svg className="w-3.5 h-3.5 text-amber-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
    text = "Compacting context...";
  } else if (activeToolName) {
    icon = (
      <div className="relative w-3.5 h-3.5 shrink-0">
        <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
    const label = TOOL_LABELS[activeToolName] ?? activeToolName;
    text = `${label}... ${elapsed}s`;
  } else if (hasRunningSubagent) {
    const running = stepOutput!.subagentActivities.find((s) => s.status === "running");
    icon = (
      <div className="relative w-3.5 h-3.5 shrink-0">
        <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
    text = `Running: ${running?.description ?? "subagent"}...`;
  } else if (isThinking) {
    icon = (
      <div className="flex gap-0.5">
        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    );
    text = "Thinking...";
  } else {
    icon = (
      <div className="relative w-3.5 h-3.5 shrink-0">
        <div className="absolute inset-0 rounded-full border-2 border-emerald-200 dark:border-emerald-800" />
        <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
    text = "Processing...";
  }

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border-t text-xs text-muted-foreground transition-all duration-300">
      {icon}
      <span>{text}</span>
    </div>
  );
}
