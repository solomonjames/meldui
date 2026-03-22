import { useState } from "react";
import { SubagentModal } from "@/features/workflow/components/shared/subagent-modal";
import type { SubagentActivity } from "@/shared/types";

interface SubagentCardProps {
  activity: SubagentActivity;
}

export function SubagentCard({ activity }: SubagentCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const isRunning = activity.status === "running";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`w-full text-left rounded-lg border my-2 p-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
          isRunning
            ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20"
            : activity.status === "failed"
              ? "border-red-300 dark:border-red-700"
              : "border-zinc-200 dark:border-zinc-700"
        }`}
      >
        <div className="flex items-center gap-2">
          {isRunning ? (
            <div className="relative w-4 h-4 shrink-0">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            </div>
          ) : activity.status === "completed" ? (
            <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
              <svg
                aria-hidden="true"
                className="w-2.5 h-2.5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center shrink-0">
              <svg
                aria-hidden="true"
                className="w-2.5 h-2.5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
            {activity.description || "Subagent"}
          </span>
          {activity.status !== "running" && (
            <span
              className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                activity.status === "completed"
                  ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
              }`}
            >
              {activity.status}
            </span>
          )}
        </div>
        {isRunning && activity.last_tool_name && (
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            Using: {activity.last_tool_name}
          </p>
        )}
        {!isRunning && activity.summary && (
          <p className="text-xs text-muted-foreground mt-1 ml-6 line-clamp-2">{activity.summary}</p>
        )}
      </button>
      <SubagentModal activity={activity} open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
