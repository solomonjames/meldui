import { useState } from "react";
import { TOOL_LABELS } from "@/features/workflow/components/shared/tool-labels";
import { getToolRenderer } from "@/features/workflow/components/shared/tool-renderers";
import type { ToolActivity } from "@/shared/types";

interface ToolCardProps {
  activity: ToolActivity;
}

export function ToolCard({ activity }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const isRunning = activity.status === "running";
  const hasInput = activity.input.length > 0;

  const renderTool = getToolRenderer(activity.tool_name);

  // Hide meldui MCP tool cards
  if (activity.tool_name.startsWith("mcp__meldui")) return null;

  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 my-1">
      <button
        type="button"
        onClick={() => hasInput && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm"
      >
        {isRunning ? (
          <div className="relative w-4 h-4 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-emerald-200 dark:border-emerald-800" />
            <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : (
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
        )}
        <span className="font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
          {TOOL_LABELS[activity.tool_name] ?? activity.tool_name}
        </span>
        {!expanded && renderTool({ activity, expanded: false })}
        {hasInput && (
          <svg
            aria-hidden="true"
            className={`w-3 h-3 ml-auto text-muted-foreground transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && !showRaw && (
        <div>
          {renderTool({ activity, expanded: true })}
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowRaw(true);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              Show raw
            </button>
          </div>
        </div>
      )}
      {expanded && showRaw && (
        <div className="border-t">
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowRaw(false);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground underline mb-2"
            >
              Show formatted
            </button>
            <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {activity.input}
            </pre>
          </div>
          {activity.result && (
            <div className="px-3 pb-2 border-t">
              <p className="text-xs font-medium text-zinc-500 mt-2 mb-1">
                Result{activity.is_error ? " (error)" : ""}:
              </p>
              <pre
                className={`text-xs overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto ${activity.is_error ? "text-red-500" : "text-muted-foreground"}`}
              >
                {activity.result.slice(0, 2000)}
                {activity.result.length > 2000 ? "..." : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
