import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Play, Send, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Ticket, StepStatus, StepOutputStream, ToolActivity, FeedbackRequestEvent } from "@/types";

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

function ToolCard({ activity }: { activity: ToolActivity }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = activity.status === "running";
  const hasInput = activity.input.length > 0;

  // Hide meldui MCP tool cards — these are app-internal communication
  if (activity.tool_name.startsWith("mcp__meldui")) return null;

  let summary = "";
  try {
    const parsed = JSON.parse(activity.input);
    if (parsed.file_path) summary = parsed.file_path;
    else if (parsed.command) summary = parsed.command;
    else if (parsed.pattern) summary = parsed.pattern;
    else if (parsed.content?.slice) summary = `${parsed.content.slice(0, 60)}...`;
  } catch {
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
          {TOOL_LABELS[activity.tool_name] ?? activity.tool_name}
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

function FeedbackCard({
  request,
  onRespond,
}: {
  request: FeedbackRequestEvent;
  onRespond: (requestId: string, approved: boolean, feedback?: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showInput) {
      inputRef.current?.focus();
    }
  }, [showInput]);

  const handleSubmitFeedback = () => {
    if (!feedbackText.trim()) return;
    onRespond(request.request_id, false, feedbackText.trim());
    setFeedbackText("");
    setShowInput(false);
  };

  return (
    <div className="rounded-lg border-2 border-emerald-300 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-3">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
            Ready for Review
          </p>
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            {request.summary}
          </p>

          {!showInput ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => onRespond(request.request_id, true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Approve & Continue
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowInput(true)}
                className="border-emerald-300 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              >
                Give Feedback
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                ref={inputRef}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitFeedback();
                  }
                }}
                placeholder="What would you like to change?"
                className="min-h-[60px] max-h-[120px] resize-none text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSubmitFeedback}
                  disabled={!feedbackText.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  Send Feedback
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowInput(false);
                    setFeedbackText("");
                  }}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChatViewProps {
  ticket: Ticket;
  stepName: string;
  response: string;
  isExecuting: boolean;
  stepStatus: StepStatus;
  stepOutput?: StepOutputStream;
  statusText?: string | null;
  pendingFeedback?: FeedbackRequestEvent | null;
  onRespondToFeedback?: (requestId: string, approved: boolean, feedback?: string) => void;
  onExecute: () => void;
}

export function ChatView({
  ticket,
  stepName,
  response,
  isExecuting,
  stepStatus,
  stepOutput,
  statusText,
  pendingFeedback,
  onRespondToFeedback,
  onExecute,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const contextScrollRef = useRef<HTMLDivElement>(null);

  const hasToolActivity = (stepOutput?.toolActivities?.length ?? 0) > 0;
  const hasText = response.length > 0;
  const isThinking = isExecuting && (stepOutput?.thinkingContent?.length ?? 0) > 0 && !hasText && !hasToolActivity;

  // Auto-scroll chat panel
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [response, stepOutput?.toolActivities.length, pendingFeedback]);

  const handleSend = () => {
    if (!input.trim() || isExecuting) return;
    onExecute();
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Build spec content from ticket fields (refreshed live via meldui-section-update)
  const specContent = [
    ticket.design && `## Design\n${ticket.design}`,
    ticket.notes && `## Notes\n${ticket.notes}`,
    ticket.acceptance_criteria && `## Acceptance Criteria\n${ticket.acceptance_criteria}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div data-testid="chat-view" className="flex h-full">
      {/* Left: Ticket Context — always shows live ticket fields */}
      <div className="w-1/2 border-r flex flex-col">
        <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900 flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Ticket Context
          </h3>
          {isExecuting && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {specContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {specContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No spec content available
            </p>
          )}
          <div ref={contextScrollRef} />
        </div>
      </div>

      {/* Right: Chat */}
      <div className="w-1/2 flex flex-col">
        <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{stepName}</h3>
            {statusText && (
              <span className="text-xs text-muted-foreground animate-pulse">
                {statusText}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {isThinking && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-1">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                Thinking...
              </div>
            )}
            {hasToolActivity && (
              stepOutput!.toolActivities.map((activity, i) => (
                <ToolCard key={`${activity.tool_id}-${i}`} activity={activity} />
              ))
            )}
            {hasText && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {response}
                </ReactMarkdown>
              </div>
            )}
            {pendingFeedback && onRespondToFeedback && (
              <FeedbackCard request={pendingFeedback} onRespond={onRespondToFeedback} />
            )}
            {!hasToolActivity && !hasText && !isThinking && isExecuting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Processing...
              </div>
            )}
            {!isExecuting && stepStatus === "pending" && (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <p className="text-sm text-muted-foreground">
                  Starting execution...
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExecute}
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Run manually
                </Button>
              </div>
            )}
            {!isExecuting && !hasText && stepOutput?.stderrLines && stepOutput.stderrLines.length > 0 && (
              <div className="w-full max-w-lg space-y-2">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Agent returned an error:
                </p>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs font-mono text-red-700 dark:text-red-300 max-h-[200px] overflow-y-auto">
                  {stepOutput.stderrLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExecute}
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Retry
                </Button>
              </div>
            )}
          </div>
          <div ref={chatScrollRef} />
        </div>

        {/* Chat input */}
        <div className="p-4 border-t bg-white dark:bg-zinc-900">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add context or ask questions... (Enter to send)"
              className="min-h-[44px] max-h-[120px] resize-none"
              disabled={isExecuting}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isExecuting}
              className="self-end"
              size="sm"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
