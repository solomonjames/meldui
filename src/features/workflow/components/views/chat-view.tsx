import { ArrowRight, Check, Play, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActivityBar } from "@/features/workflow/components/shared/activity-bar";
import { ActivityGroup } from "@/features/workflow/components/shared/activity-group";
import { FilesChanged } from "@/features/workflow/components/shared/files-changed";
import { StepDividerBar } from "@/features/workflow/components/shared/step-divider";
import { SubagentCard } from "@/features/workflow/components/shared/subagent-card";
import { useConversation } from "@/shared/hooks/use-conversation";
import { snapshotToBlocks } from "@/shared/lib/conversations";
import type { StepOutputStream, StepStatus } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

function StepCompleteCard({
  onAdvance,
  onContinue,
}: {
  onAdvance: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-3">
      <div className="flex items-center gap-2 mb-3">
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Step complete</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onContinue}>
          Continue Chatting
        </Button>
        <Button
          size="sm"
          onClick={onAdvance}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Next Step
          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Button>
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
  onAdvanceStep?: () => void;
  onExecute: () => void;
  projectDir?: string;
  ticketId?: string | null;
}

export function ChatView({
  stepName,
  response,
  isExecuting,
  stepStatus,
  stepOutput,
  statusText,
  onAdvanceStep,
  onExecute,
  projectDir,
  ticketId,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Load persisted conversation history
  const { data: snapshot } = useConversation(projectDir ?? "", ticketId ?? null);
  const historyBlocks = useMemo(
    () => (snapshot ? snapshotToBlocks(snapshot.events, snapshot.steps) : []),
    [snapshot],
  );

  const contentBlocks = stepOutput?.contentBlocks ?? [];
  const hasContent = contentBlocks.length > 0 || response.length > 0;
  const isThinking = isExecuting && (stepOutput?.thinkingContent?.length ?? 0) > 0 && !hasContent;
  const isStepComplete = stepOutput?.resultContent != null;

  // Auto-scroll chat panel when new content arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll should fire on content/response changes
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contentBlocks.length, response, isStepComplete]);

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
              <span className="text-xs text-muted-foreground animate-pulse">{statusText}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 relative">
          <div className="space-y-1">
            {/* Persisted conversation history */}
            {historyBlocks.map((block, i) => {
              if (block.type === "step_divider") {
                return <StepDividerBar key={`hist-div-${block.stepId}`} label={block.label} />;
              }
              if (block.type === "text") {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                  <div key={`hist-${i}`} className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
                  </div>
                );
              }
              if (block.type === "tool_group") {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                  <ActivityGroup key={`hist-${i}`} activities={block.activities} isActive={false} />
                );
              }
              if (block.type === "subagent") {
                // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                return <SubagentCard key={`hist-${i}`} activity={block.activity} />;
              }
              return null;
            })}

            {/* Current step divider (if we have history and are currently executing) */}
            {historyBlocks.length > 0 && isExecuting && <StepDividerBar label={stepName} />}

            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-1">
                <div className="flex gap-1">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
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
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                      key={`text-${i}`}
                      className="prose prose-sm dark:prose-invert max-w-none mt-2"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
                    </div>
                  );
                case "tool_group": {
                  const isLastGroup = !contentBlocks
                    .slice(i + 1)
                    .some((b) => b.type === "tool_group");
                  const isActive =
                    isExecuting &&
                    isLastGroup &&
                    block.activities.some((a) => a.status === "running");
                  return (
                    <ActivityGroup
                      // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                      key={`group-${i}`}
                      activities={block.activities}
                      summaryText={block.summaryText}
                      isActive={isActive}
                    />
                  );
                }
                case "subagent":
                  // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                  return <SubagentCard key={`subagent-${i}`} activity={block.activity} />;
                default:
                  return null;
              }
            })}

            {/* Fallback: render response text if no contentBlocks */}
            {contentBlocks.length === 0 && response.length > 0 && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{response}</ReactMarkdown>
              </div>
            )}

            {/* Files changed summary */}
            {isStepComplete && stepOutput && (
              <FilesChanged
                filesChanged={stepOutput.filesChanged}
                toolActivities={stepOutput.toolActivities}
              />
            )}

            {/* Step complete card — show when agent finished (resultContent set) and not mid-execution */}
            {isStepComplete && !isExecuting && onAdvanceStep && (
              <StepCompleteCard onAdvance={onAdvanceStep} onContinue={onExecute} />
            )}

            {/* Empty states */}
            {/* ActivityBar below handles processing state */}
            {!isExecuting && stepStatus === "pending" && (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <p className="text-sm text-muted-foreground">Starting execution...</p>
                <Button variant="outline" size="sm" onClick={onExecute}>
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Run manually
                </Button>
              </div>
            )}
            {!isExecuting &&
              !hasContent &&
              stepOutput?.stderrLines &&
              stepOutput.stderrLines.length > 0 && (
                <div className="w-full max-w-lg space-y-2">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Agent returned an error:
                  </p>
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs font-mono text-red-700 dark:text-red-300 max-h-[200px] overflow-y-auto">
                    {stepOutput.stderrLines.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stderr lines lack stable IDs
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={onExecute}>
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              )}
          </div>

          {/* Activity bar — sticky at bottom of scroll area */}
          <ActivityBar stepOutput={stepOutput} isExecuting={isExecuting} isWaitingForUser={false} />
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
