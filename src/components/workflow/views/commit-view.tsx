import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GitCommit, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Ticket } from "@/types";

interface CommitViewProps {
  ticket: Ticket;
  response: string;
  onBack: () => void;
}

export function CommitView({
  ticket,
  response,
  onBack,
}: CommitViewProps) {
  const fallbackMessage = `feat: ${ticket.title.toLowerCase()}`;
  // User override: once edited, the local value takes precedence over response
  const [userOverride, setUserOverride] = useState<string | null>(null);
  const commitMessage = userOverride ?? (response || fallbackMessage);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <GitCommit className="w-5 h-5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Commit & Complete</h3>
            <p className="text-xs text-muted-foreground">{ticket.title}</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Summary */}
          {response && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Summary
              </h4>
              <div className="rounded-lg border bg-white dark:bg-zinc-900 p-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {response}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Commit message */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Commit Message
            </h4>
            <Textarea
              value={commitMessage}
              onChange={(e) => setUserOverride(e.target.value)}
              className="min-h-[120px] font-mono text-sm"
              placeholder="feat: describe your changes..."
            />
          </div>
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="px-6 py-4 border-t bg-white dark:bg-zinc-900 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
          Back to Board
        </Button>
      </div>
    </div>
  );
}
