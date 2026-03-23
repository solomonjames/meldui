import { ArrowRight, Check, Play } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  onExecute: (message?: string) => void;
  projectDir?: string;
  ticketId?: string | null;
  isInteractive?: boolean;
  pendingPermission?: PermissionRequest | null;
  onRespondToPermission?: (requestId: string, allowed: boolean) => void;
}

export function ChatView({
  stepName,
  response,
  isExecuting,
  stepStatus: _stepStatus,
  stepOutput,
  statusText,
  onAdvanceStep,
  onExecute,
  projectDir,
  ticketId,
  isInteractive = true,
  pendingPermission,
  onRespondToPermission,
}: ChatViewProps) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { config, setModel, setThinking, setEffort, setFastMode } = useAgentConfig();

  // Load persisted conversation history
  const { data: snapshot } = useConversation(projectDir ?? "", ticketId ?? null);
  const historyBlocks = useMemo(
    () => (snapshot ? snapshotToBlocks(snapshot.events, snapshot.steps) : []),
    [snapshot],
  );

  const contentBlocks = stepOutput?.contentBlocks ?? [];
  const hasContent = contentBlocks.length > 0 || response.length > 0;
  const isStepComplete = stepOutput?.resultContent != null;
  const showInput = isInteractive || !isExecuting;

  // Auto-scroll chat panel when new content arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll should fire on content/response changes
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contentBlocks.length, response, isStepComplete]);

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

        {/* Chat input — hidden for non-interactive steps while executing */}
        {showInput && (
          <ComposeToolbar
            config={config}
            onSetModel={setModel}
            onSetThinking={setThinking}
            onSetEffort={setEffort}
            onSetFastMode={setFastMode}
            onSend={(message) => {
              onExecute(message);
            }}
            disabled={isExecuting}
            contextUsage={stepOutput?.contextUsage}
            contextIndicatorVisibility="threshold"
          />
        )}
      </div>
    </div>
  );
}
