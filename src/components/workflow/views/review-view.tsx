import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BeadsIssue, StepRecord } from "@/types";

interface ReviewViewProps {
  issue: BeadsIssue;
  stepName: string;
  response: string;
  stepHistory: StepRecord[];
  isExecuting: boolean;
  isAwaitingGate: boolean;
  onApprove: () => void;
}

export function ReviewView({
  issue,
  stepName,
  response,
  stepHistory,
  isExecuting,
  isAwaitingGate,
  onApprove,
}: ReviewViewProps) {
  return (
    <div className="flex h-full">
      {/* Left: Timeline */}
      <div className="w-48 border-r bg-white dark:bg-zinc-900 flex flex-col">
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Timeline
          </h3>
        </div>
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-1">
            {stepHistory.map((record) => (
              <div
                key={record.step_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
              >
                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                <span className="truncate text-muted-foreground">
                  {record.step_id}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-emerald-50 dark:bg-emerald-900/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate font-medium">{stepName}</span>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Center: Content */}
      <div className="flex-1 flex flex-col">
        <div className="px-6 py-3 border-b bg-white dark:bg-zinc-900 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{stepName}</h3>
            <p className="text-xs text-muted-foreground">{issue.title}</p>
          </div>
          {isAwaitingGate && (
            <Button
              size="sm"
              onClick={onApprove}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Continue to Next Step
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 p-6">
          {response ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {response}
              </ReactMarkdown>
            </div>
          ) : isExecuting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Running review...
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting for review results...
            </p>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
