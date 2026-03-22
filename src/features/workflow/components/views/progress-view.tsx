import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActivityBar } from "@/features/workflow/components/shared/activity-bar";
import { ActivityGroup } from "@/features/workflow/components/shared/activity-group";
import { FilesChanged } from "@/features/workflow/components/shared/files-changed";
import { PermissionDialog } from "@/features/workflow/components/shared/permission-dialog";
import { SubagentCard } from "@/features/workflow/components/shared/subagent-card";
import { ThinkingSection } from "@/features/workflow/components/shared/thinking-section";
import type { PermissionRequest, StepOutputStream } from "@/shared/types";

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

  const contentBlocks = stepOutput?.contentBlocks ?? [];
  const hasThinking = (stepOutput?.thinkingContent?.length ?? 0) > 0;
  const hasContent =
    contentBlocks.length > 0 || (stepOutput?.textContent?.length ?? 0) > 0 || hasThinking;
  const hasStderr = (stepOutput?.stderrLines?.length ?? 0) > 0;
  const isStepComplete = stepOutput?.resultContent != null;

  // Fallback text (for backward compatibility when contentBlocks is empty)
  const displayText =
    contentBlocks.length === 0 ? stepOutput?.textContent || stepOutput?.resultContent || "" : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll should fire on content changes
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contentBlocks.length, stepOutput?.textContent]);

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
              <svg
                aria-hidden="true"
                className="w-3 h-3 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
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
            // biome-ignore lint/suspicious/noArrayIndexKey: stderr lines lack stable IDs
            <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400 font-mono">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Streaming output */}
      <div className="flex-1 overflow-y-auto p-6 relative">
        {hasContent ? (
          <div className="space-y-1">
            {/* Permission dialog */}
            {pendingPermission && onRespondToPermission && (
              <PermissionDialog permission={pendingPermission} onRespond={onRespondToPermission} />
            )}

            {/* Thinking section */}
            {hasThinking && <ThinkingSection content={stepOutput!.thinkingContent} />}

            {/* Content blocks */}
            {contentBlocks.map((block, i) => {
              switch (block.type) {
                case "text":
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: content blocks lack stable IDs
                      key={`text-${i}`}
                      className="prose prose-sm dark:prose-invert max-w-none mt-4"
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

            {/* Fallback text content (backward compatibility) */}
            {displayText && (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
              </div>
            )}

            {/* Files changed */}
            {isStepComplete && stepOutput && (
              <FilesChanged
                filesChanged={stepOutput.filesChanged}
                toolActivities={stepOutput.toolActivities}
              />
            )}
          </div>
        ) : isExecuting ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-200 dark:border-emerald-800" />
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">Waiting for output...</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            Step will start automatically...
          </p>
        )}

        {/* Activity bar — sticky at bottom */}
        <ActivityBar
          stepOutput={stepOutput}
          isExecuting={isExecuting}
          isWaitingForUser={!!pendingPermission}
        />
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
}
