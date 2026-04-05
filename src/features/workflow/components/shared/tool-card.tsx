import { useState } from "react";
import { getToolRenderer } from "@/features/workflow/components/shared/tool-renderers";
import { MCP_TOOL_ICON, TOOL_ICON_FALLBACK, TOOL_ICONS } from "@/features/workflow/constants";
import type { ToolActivity } from "@/shared/types";

interface ToolCardProps {
  activity: ToolActivity;
}

function getToolIcon(toolName: string) {
  if (toolName.startsWith("mcp__")) return MCP_TOOL_ICON;
  if (toolName.startsWith("Task")) return TOOL_ICONS.Agent;
  return TOOL_ICONS[toolName] ?? TOOL_ICON_FALLBACK;
}

function getDetailText(activity: ToolActivity): string | null {
  try {
    const parsed = JSON.parse(activity.input);
    if (parsed.file_path) return parsed.file_path;
    if (parsed.command) {
      const cmd = parsed.command as string;
      return cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
    }
    if (parsed.pattern) return parsed.pattern;
    if (parsed.url) return parsed.url;
    if (parsed.query) return parsed.query;
  } catch {
    // no parseable input
  }
  return null;
}

function formatElapsed(seconds?: number): string | null {
  if (seconds == null) return null;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  return `${seconds.toFixed(1)}s`;
}

export function ToolCard({ activity }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const isRunning = activity.status === "running";
  const hasInput = activity.input.length > 0;

  const Icon = getToolIcon(activity.tool_name);
  const detailText = getDetailText(activity);
  const elapsed = formatElapsed(activity.elapsed_seconds);
  const renderTool = getToolRenderer(activity.tool_name);

  // Hide meldui MCP tool cards
  if (activity.tool_name.startsWith("mcp__meldui")) return null;

  return (
    <div
      className={`rounded-lg border my-1 ${
        activity.is_error ? "bg-destructive/5 border-destructive/20" : "bg-white dark:bg-zinc-900"
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => hasInput && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:bg-accent"
      >
        {/* Tool icon */}
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

        {/* Tool name */}
        <span
          className={`font-mono text-xs shrink-0 ${
            activity.is_error ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {activity.tool_name}
        </span>

        {/* Detail text */}
        {detailText && !expanded && (
          <span className="text-xs text-muted-foreground/70 truncate font-mono">{detailText}</span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Elapsed time */}
        {elapsed && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {elapsed}
            {isRunning ? "..." : ""}
          </span>
        )}

        {/* Status dot */}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isRunning
              ? "bg-amber-500 animate-pulse"
              : activity.is_error
                ? "bg-destructive"
                : "bg-emerald-500"
          }`}
        />

        {/* Expand chevron */}
        {hasInput && (
          <svg
            aria-hidden="true"
            className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Expanded: formatted view */}
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

      {/* Expanded: raw view */}
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
            <div
              className={`px-3 pb-2 border-t ${activity.is_error ? "border-destructive/20" : ""}`}
            >
              <p className="text-xs font-medium text-zinc-500 mt-2 mb-1">
                Result{activity.is_error ? " (error)" : ""}:
              </p>
              <pre
                className={`text-xs overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto ${
                  activity.is_error ? "text-destructive" : "text-muted-foreground"
                }`}
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
