import { useState } from "react";
import { ToolCard } from "@/features/workflow/components/shared/tool-card";
import { TOOL_LABELS } from "@/features/workflow/components/shared/tool-labels";
import type { ToolActivity } from "@/shared/types";

interface ActivityGroupProps {
  activities: ToolActivity[];
  summaryText?: string;
  isActive: boolean;
}

function generateSummary(activities: ToolActivity[]): string {
  const counts: Record<string, number> = {};
  for (const a of activities) {
    if (a.tool_name.startsWith("mcp__meldui")) continue;
    const label = TOOL_LABELS[a.tool_name] ?? a.tool_name;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([label, count]) => {
    if (count === 1) return label.replace(/ing /, "ed ").replace("Running", "Ran");
    // Pluralize: "Read 3 files" etc.
    const verb = label.split(" ")[0];
    const rest = label.split(" ").slice(1).join(" ");
    const pastVerb = verb
      .replace(/ing$/, "ed")
      .replace("Running", "Ran")
      .replace("Searching", "Searched");
    return `${pastVerb} ${count} ${rest}${rest && !rest.endsWith("s") ? "s" : ""}`;
  });
  return parts.join(", ") || `${activities.length} tool calls`;
}

export function ActivityGroup({ activities, summaryText, isActive }: ActivityGroupProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  // Auto-expand when active; user toggle overrides
  const expanded = userExpanded ?? isActive;

  const visibleActivities = activities.filter((a) => !a.tool_name.startsWith("mcp__meldui"));
  if (visibleActivities.length === 0) return null;

  const summary = summaryText || generateSummary(activities);

  return (
    <div
      className={`my-2 rounded-lg border-l-2 ${isActive ? "border-l-emerald-500" : "border-l-zinc-200 dark:border-l-zinc-700"}`}
    >
      <button
        type="button"
        onClick={() => setUserExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r-lg"
      >
        {isActive ? (
          <div className="relative w-3.5 h-3.5 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="w-3.5 h-3.5 rounded-full bg-zinc-300 dark:bg-zinc-600 flex items-center justify-center shrink-0">
            <svg
              aria-hidden="true"
              className="w-2 h-2 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{summary}</span>
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
      </button>
      {expanded && (
        <div className="px-2 pb-2">
          {visibleActivities.map((activity, i) => (
            <ToolCard
              // biome-ignore lint/suspicious/noArrayIndexKey: activities may share tool_id
              key={`${activity.tool_id}-${i}`}
              activity={activity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
