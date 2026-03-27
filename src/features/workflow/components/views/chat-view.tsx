import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Play, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { commands, events } from "@/bindings";
import { ActivityBar } from "@/features/workflow/components/shared/activity-bar";
import { ActivityGroup } from "@/features/workflow/components/shared/activity-group";
import { ComposeToolbar } from "@/features/workflow/components/shared/compose-toolbar";
import { FilesChanged } from "@/features/workflow/components/shared/files-changed";
import { PermissionDialog } from "@/features/workflow/components/shared/permission-dialog";
import { StepDividerBar } from "@/features/workflow/components/shared/step-divider";
import { SubagentCard } from "@/features/workflow/components/shared/subagent-card";
import { ThinkingBlock } from "@/features/workflow/components/shared/thinking-block";
import { useAgentConfig } from "@/features/workflow/hooks/use-agent-config";
import { useConversation } from "@/shared/hooks/use-conversation";
import { snapshotToBlocks } from "@/shared/lib/conversations";
import type { PermissionRequest, StepOutputStream, StepStatus } from "@/shared/types";
import { Button } from "@/shared/ui/button";

function UserMessageBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end my-2">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
    </div>
  );
}

function SupervisorTypingIndicator() {
  return (
    <div className="flex justify-end my-2">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              Supervisor
            </span>
            <span className="flex gap-0.5">
              <span
                className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
          </div>
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 shrink-0 mt-0.5">
          <Play className="w-3.5 h-3.5 text-amber-500" />
        </div>
      </div>
    </div>
  );
}

function SupervisorReplyBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end my-2">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              Auto-reply
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 shrink-0 mt-0.5">
          <Play className="w-3.5 h-3.5 text-amber-500" />
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
  onAdvanceStep?: () => void;
  onExecute: (message?: string) => void;
  projectDir?: string;
  ticketId?: string | null;
  isInteractive?: boolean;
  pendingPermission?: PermissionRequest | null;
  onRespondToPermission?: (requestId: string, allowed: boolean) => void;
  autoAdvance?: boolean;
  onSetAutoAdvance?: (enabled: boolean) => void;
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
  isInteractive = true,
  pendingPermission,
  onRespondToPermission,
  autoAdvance,
  onSetAutoAdvance,
}: ChatViewProps) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [userMessages, setUserMessages] = useState<
    Array<{ id: string; content: string; insertAt: number }>
  >([]);
  const [supervisorActive, setSupervisorActive] = useState(false);
  const { config, setModel, setThinking, setEffort, setFastMode } = useAgentConfig(
    ticketId ?? null,
  );
  const { data: appPreferences } = useQuery({
    queryKey: ["app", "preferences"],
    queryFn: () => commands.getAppPreferences(),
  });

  // Track current raw block count so injected items record their timeline position
  const rawBlockCountRef = useRef(0);
  rawBlockCountRef.current = (stepOutput?.contentBlocks ?? []).length;

  const handleSend = useCallback(
    (message?: string) => {
      if (message) {
        setUserMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, content: message, insertAt: rawBlockCountRef.current },
        ]);
      }
      onExecute(message);
    },
    [onExecute],
  );

  // Track supervisor evaluation state for typing indicator
  const [supervisorEvaluating, setSupervisorEvaluating] = useState(false);

  // Listen for supervisor events via Tauri events (reliable, not dependent on stream chunks)
  useEffect(() => {
    const unlistenEvaluating = events.supervisorEvaluating.listen(() => {
      setSupervisorEvaluating(true);
    });
    const unlistenReply = events.supervisorReply.listen(() => {
      setSupervisorActive(true);
      setSupervisorEvaluating(false);
    });
    return () => {
      unlistenEvaluating.then((fn) => fn());
      unlistenReply.then((fn) => fn());
    };
  }, []);

  // Reset supervisor state when step completes
  useEffect(() => {
    if (stepStatus === "completed" || stepStatus === "pending") {
      setSupervisorActive(false);
      setSupervisorEvaluating(false);
    }
  }, [stepStatus]);

  // Load persisted conversation history
  const { data: snapshot } = useConversation(projectDir ?? "", ticketId ?? null);
  const historyResult = useMemo(
    () =>
      snapshot
        ? snapshotToBlocks(snapshot.events, snapshot.steps)
        : { blocks: [], filesChanged: [] },
    [snapshot],
  );
  const historyBlocks = historyResult.blocks;
  const historyFilesChanged = historyResult.filesChanged;

  // Supervisor replies flow through StreamChunk into contentBlocks directly.
  // Only user messages need injection into the timeline.
  const rawBlocks = stepOutput?.contentBlocks ?? [];
  const contentBlocks = useMemo(() => {
    if (userMessages.length === 0) return rawBlocks;

    type InjectedItem = { type: "user_message"; content: string; id: string; insertAt: number };
    const injected: InjectedItem[] = userMessages
      .map((m) => ({
        type: "user_message" as const,
        content: m.content,
        id: m.id,
        insertAt: m.insertAt,
      }))
      .sort((a, b) => a.insertAt - b.insertAt);

    type MergedBlock = (typeof rawBlocks)[number] | InjectedItem;
    const merged: MergedBlock[] = [];
    let injectIdx = 0;

    for (let i = 0; i <= rawBlocks.length; i++) {
      while (injectIdx < injected.length && injected[injectIdx].insertAt <= i) {
        merged.push(injected[injectIdx]);
        injectIdx++;
      }
      if (i < rawBlocks.length) {
        merged.push(rawBlocks[i]);
      }
    }
    while (injectIdx < injected.length) {
      merged.push(injected[injectIdx]);
      injectIdx++;
    }
    return merged;
  }, [rawBlocks, userMessages]);

  const hasContent = contentBlocks.length > 0 || response.length > 0;
  const showInput = isInteractive || !isExecuting;

  // Auto-scroll chat panel when new content arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll should fire on content/response changes
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contentBlocks.length, response, stepStatus, userMessages.length]);

  return (
    <div data-testid="chat-view" className="flex flex-col h-full">
      {/* Chat */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-4 relative">
          {/* Step status indicator */}
          {(isExecuting || statusText) && (
            <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
              {isExecuting && (
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
              )}
              <span className="font-medium">{stepName}</span>
              {statusText && <span className="animate-pulse">{statusText}</span>}
            </div>
          )}
          <div className="space-y-1">
            {/* Persisted conversation history */}
            {historyBlocks.map((block, i) => {
              if (block.type === "step_divider") {
                return (
                  <StepDividerBar
                    key={`hist-div-${block.stepId}`}
                    label={block.label}
                    stepId={block.stepId}
                  />
                );
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
              if (block.type === "user_message") {
                // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                return <UserMessageBubble key={`hist-${i}`} content={block.content} />;
              }
              if (block.type === "thinking") {
                // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                return <ThinkingBlock key={`hist-${i}`} content={block.content} isActive={false} />;
              }
              if (block.type === "supervisor_reply") {
                // biome-ignore lint/suspicious/noArrayIndexKey: history blocks lack stable IDs
                return <SupervisorReplyBubble key={`hist-${i}`} content={block.content} />;
              }
              return null;
            })}

            {/* Current step divider (if we have history and are currently executing) */}
            {historyBlocks.length > 0 && isExecuting && <StepDividerBar label={stepName} />}

            {/* Permission dialog — inline in chat timeline */}
            {pendingPermission && onRespondToPermission && (
              <PermissionDialog permission={pendingPermission} onRespond={onRespondToPermission} />
            )}

            {/* Content blocks — text-first with activity groups */}
            {contentBlocks.map((block, i) => {
              switch (block.type) {
                case "thinking":
                  return (
                    <ThinkingBlock
                      // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                      key={`thinking-${i}`}
                      content={block.content}
                      isActive={isExecuting && i === contentBlocks.length - 1}
                    />
                  );
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
                case "user_message":
                  // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                  return <UserMessageBubble key={`user-${i}`} content={block.content} />;
                case "supervisor_reply":
                  // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                  return <SupervisorReplyBubble key={`supervisor-${i}`} content={block.content} />;
                default:
                  return null;
              }
            })}

            {/* Supervisor typing indicator */}
            {supervisorEvaluating && <SupervisorTypingIndicator />}

            {/* Fallback: render response text if no contentBlocks */}
            {contentBlocks.length === 0 && response.length > 0 && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{response}</ReactMarkdown>
              </div>
            )}

            {/* Files changed summary */}
            {stepStatus === "completed" && stepOutput && (
              <FilesChanged
                filesChanged={stepOutput.filesChanged}
                toolActivities={stepOutput.toolActivities}
              />
            )}

            {!isExecuting && !stepOutput && historyFilesChanged.length > 0 && (
              <FilesChanged filesChanged={historyFilesChanged} toolActivities={[]} />
            )}

            {/* Empty states */}
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

          {/* Floating "Next Step" button — pinned to bottom-right of chat scroll area */}
          {stepStatus === "completed" && onAdvanceStep && (
            <div className="sticky bottom-0 flex justify-end pointer-events-none">
              <Button
                size="sm"
                onClick={onAdvanceStep}
                aria-label="Advance to next step"
                className="bg-emerald-500/50 hover:bg-emerald-600/50 border-emerald-500/50 border-1 shadow-sm shadow-emerald-600/20 text-white backdrop-blur-sm cursor-pointer pointer-events-auto"
              >
                Next Step
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Chat input — supervisor banner or compose toolbar */}
        {supervisorActive && autoAdvance ? (
          <div className="flex items-center justify-center gap-3 px-4 py-3 border-t bg-amber-50/50 dark:bg-amber-950/20">
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Supervisor is responding...
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetAutoAdvance?.(false)}
              className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
            >
              Take Over
            </Button>
          </div>
        ) : showInput ? (
          <ComposeToolbar
            config={config}
            onSetModel={setModel}
            onSetThinking={setThinking}
            onSetEffort={setEffort}
            onSetFastMode={setFastMode}
            onSend={(message) => {
              handleSend(message);
            }}
            contextUsage={stepOutput?.contextUsage}
            contextIndicatorVisibility={
              (appPreferences?.context_indicator_visibility as "threshold" | "always" | "never") ??
              "threshold"
            }
          />
        ) : null}
      </div>
    </div>
  );
}
