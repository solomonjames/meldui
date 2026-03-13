import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ProgressViewProps {
  stepName: string;
  streamOutput: string;
  isExecuting: boolean;
  response?: string;
}

export function ProgressView({
  stepName,
  streamOutput,
  isExecuting,
  response,
}: ProgressViewProps) {
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamOutput, response]);

  const displayContent = response || streamOutput;
  const hasContent = displayContent.length > 0;

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
          {!isExecuting && hasContent && (
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          <h3 className="text-sm font-medium">
            {isExecuting ? `Running: ${stepName}...` : stepName}
          </h3>
        </div>
      </div>

      {/* Streaming output */}
      <div className="flex-1 overflow-y-auto p-6">
        {hasContent ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayContent}
            </ReactMarkdown>
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
