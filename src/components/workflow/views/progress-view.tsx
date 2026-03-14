import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StepOutputStream, ToolActivity, PermissionRequest } from "@/types";

const TOOL_LABELS: Record<string, string> = {
  Write: "Writing file",
  Read: "Reading file",
  Edit: "Editing file",
  Bash: "Running command",
  Glob: "Searching files",
  Grep: "Searching content",
  Agent: "Running agent",
  WebSearch: "Searching web",
  WebFetch: "Fetching URL",
};

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function ToolCard({ activity }: { activity: ToolActivity }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = activity.status === "running";
  const hasInput = activity.input.length > 0;

  // Try to extract a short summary from the tool input
  let summary = "";
  try {
    const parsed = JSON.parse(activity.input);
    if (parsed.file_path) summary = parsed.file_path;
    else if (parsed.command) summary = parsed.command;
    else if (parsed.pattern) summary = parsed.pattern;
    else if (parsed.content?.slice) summary = `${parsed.content.slice(0, 60)}...`;
  } catch {
    // partial JSON — show truncated raw input
    if (activity.input.length > 0) {
      summary = activity.input.slice(0, 80);
      if (activity.input.length > 80) summary += "...";
    }
  }

  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 my-2">
      <button
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
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {getToolLabel(activity.tool_name)}
        </span>
        {summary && (
          <span className="text-xs text-muted-foreground truncate">
            {summary}
          </span>
        )}
        {hasInput && (
          <svg
            className={`w-3 h-3 ml-auto text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && hasInput && (
        <div className="px-3 pb-2 border-t">
          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap mt-2 max-h-48 overflow-y-auto">
            {activity.input}
          </pre>
        </div>
      )}
      {expanded && activity.result && (
        <div className="px-3 pb-2 border-t">
          <p className="text-xs font-medium text-zinc-500 mt-2 mb-1">Result{activity.is_error ? " (error)" : ""}:</p>
          <pre className={`text-xs overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto ${activity.is_error ? "text-red-500" : "text-muted-foreground"}`}>
            {activity.result.slice(0, 2000)}{activity.result.length > 2000 ? "..." : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

function PermissionDialog({
  permission,
  onRespond,
}: {
  permission: PermissionRequest;
  onRespond: (requestId: string, allowed: boolean) => void;
}) {
  // Summarize the input for display
  let summary = "";
  const input = permission.input;
  if (input.command) summary = String(input.command);
  else if (input.file_path) summary = String(input.file_path);
  else if (input.pattern) summary = String(input.pattern);
  else summary = JSON.stringify(input).slice(0, 200);

  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 my-2 p-4">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Permission Required: {permission.tool_name}
          </p>
          <pre className="text-xs text-amber-700 dark:text-amber-300 mt-1 whitespace-pre-wrap break-all">
            {summary}
          </pre>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onRespond(permission.request_id, true)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              Allow
            </button>
            <button
              onClick={() => onRespond(permission.request_id, false)}
              className="px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        Thinking ({content.length} chars)
      </button>
      {expanded && (
        <pre className="text-xs text-muted-foreground/60 mt-1 whitespace-pre-wrap max-h-64 overflow-y-auto pl-5 border-l-2 border-zinc-200 dark:border-zinc-700">
          {content}
        </pre>
      )}
    </div>
  );
}

interface ProgressViewProps {
  stepName: string;
  stepOutput?: StepOutputStream;
  isExecuting: boolean;
  isCompleted: boolean;
  pendingPermission?: PermissionRequest | null;
  onRespondToPermission?: (requestId: string, allowed: boolean) => void;
}

export function ProgressView({
  stepName,
  stepOutput,
  isExecuting,
  isCompleted,
  pendingPermission,
  onRespondToPermission,
}: ProgressViewProps) {
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [stepOutput?.textContent, stepOutput?.toolActivities.length]);

  const hasText = (stepOutput?.textContent?.length ?? 0) > 0;
  const hasTools = (stepOutput?.toolActivities?.length ?? 0) > 0;
  const hasThinking = (stepOutput?.thinkingContent?.length ?? 0) > 0;
  const hasContent = hasText || hasTools || hasThinking;
  const hasStderr = (stepOutput?.stderrLines?.length ?? 0) > 0;

  // Build an interleaved timeline of text chunks and tool activities
  // For now, render text first, then tools — since text deltas and tool blocks
  // come in sequence from the stream, the order in the arrays is chronological
  const displayText = stepOutput?.textContent || stepOutput?.resultContent || "";

  return (
    <div className="flex flex-col h-full">
      {/* Header with progress indicator */}
      <div className="px-6 py-4 border-b bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          {isExecuting && (
            <div className="relative w-5 h-5">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-200 dark:border-emerald-800" />
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            </div>
          )}
          {!isExecuting && (hasContent || isCompleted) && (
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          <h3 className="text-sm font-medium">
            {isExecuting
              ? `Running: ${stepName}...`
              : isCompleted
                ? `${stepName} — complete`
                : stepName}
          </h3>
        </div>
      </div>

      {/* Stderr warnings */}
      {hasStderr && (
        <div className="px-6 py-2 bg-yellow-50 dark:bg-yellow-950/30 border-b border-yellow-200 dark:border-yellow-800">
          {stepOutput!.stderrLines.map((line, i) => (
            <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400 font-mono">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Streaming output */}
      <div className="flex-1 overflow-y-auto p-6">
        {hasContent ? (
          <div className="space-y-1">
            {/* Permission dialog — shows above everything when pending */}
            {pendingPermission && onRespondToPermission && (
              <PermissionDialog
                permission={pendingPermission}
                onRespond={onRespondToPermission}
              />
            )}

            {/* Thinking section — collapsible */}
            {hasThinking && (
              <ThinkingSection content={stepOutput!.thinkingContent} />
            )}

            {/* Tool activities */}
            {stepOutput?.toolActivities.map((activity, i) => (
              <ToolCard key={`${activity.tool_id}-${i}`} activity={activity} />
            ))}

            {/* Text content as markdown */}
            {displayText && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {displayText}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ) : isExecuting ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-200 dark:border-emerald-800" />
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">
              Waiting for output...
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            Step will start automatically...
          </p>
        )}
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
}
