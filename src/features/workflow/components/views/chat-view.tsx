import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Play, Send, MessageSquare } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import type { StepStatus, StepOutputStream, FeedbackRequestEvent } from "@/shared/types";
import { ActivityGroup } from "@/features/workflow/components/shared/activity-group";
import { ActivityBar } from "@/features/workflow/components/shared/activity-bar";
import { SubagentCard } from "@/features/workflow/components/shared/subagent-card";
import { FilesChanged } from "@/features/workflow/components/shared/files-changed";

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

  const contentBlocks = stepOutput?.contentBlocks ?? [];
  const hasContent = contentBlocks.length > 0 || response.length > 0;
  const isThinking = isExecuting && (stepOutput?.thinkingContent?.length ?? 0) > 0 && !hasContent;
  const isStepComplete = stepOutput?.resultContent != null;

  // Auto-scroll chat panel
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contentBlocks.length, response, pendingFeedback]);

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

  return (
    <div data-testid="chat-view" className="flex flex-col h-full">
      {/* Chat */}
      <div className="flex flex-col flex-1 min-h-0">
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

        <div className="flex-1 overflow-y-auto p-4 relative">
          <div className="space-y-1">
            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-1">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="truncate max-w-[250px]">
                  {stepOutput?.thinkingContent && stepOutput.thinkingContent.length > 0
                    ? stepOutput.thinkingContent.slice(-60).trim()
                    : "Thinking..."}
                </span>
              </div>
            )}

            {/* Content blocks — text-first with activity groups */}
            {contentBlocks.map((block, i) => {
              switch (block.type) {
                case "text":
                  return (
                    <div key={`text-${i}`} className="prose prose-sm dark:prose-invert max-w-none mt-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  );
                case "tool_group": {
                  const isLastGroup = !contentBlocks.slice(i + 1).some((b) => b.type === "tool_group");
                  const isActive = isExecuting && isLastGroup && block.activities.some((a) => a.status === "running");
                  return (
                    <ActivityGroup
                      key={`group-${i}`}
                      activities={block.activities}
                      summaryText={block.summaryText}
                      isActive={isActive}
                    />
                  );
                }
                case "subagent":
                  return (
                    <SubagentCard key={`subagent-${i}`} activity={block.activity} />
                  );
                default:
                  return null;
              }
            })}

            {/* Fallback: render response text if no contentBlocks */}
            {contentBlocks.length === 0 && response.length > 0 && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {response}
                </ReactMarkdown>
              </div>
            )}

            {/* Files changed summary */}
            {isStepComplete && stepOutput && (
              <FilesChanged
                filesChanged={stepOutput.filesChanged}
                toolActivities={stepOutput.toolActivities}
              />
            )}

            {/* Feedback card */}
            {pendingFeedback && onRespondToFeedback && (
              <FeedbackCard request={pendingFeedback} onRespond={onRespondToFeedback} />
            )}

            {/* Empty states */}
            {/* ActivityBar below handles processing state */}
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
            {!isExecuting && !hasContent && stepOutput?.stderrLines && stepOutput.stderrLines.length > 0 && (
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

          {/* Activity bar — sticky at bottom of scroll area */}
          <ActivityBar stepOutput={stepOutput} isExecuting={isExecuting} isWaitingForUser={!!pendingFeedback} />
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
