import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BeadsIssue } from "@/types";

interface ChatViewProps {
  issue: BeadsIssue;
  stepName: string;
  response: string;
  isExecuting: boolean;
  isAwaitingGate: boolean;
  onApprove: () => void;
  onExecute: () => void;
}

export function ChatView({
  issue,
  stepName,
  response,
  isExecuting,
  isAwaitingGate,
  onApprove,
  onExecute,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [response]);

  const handleSend = () => {
    if (!input.trim() || isExecuting) return;
    // TODO: Pass user input as conversation context to Claude
    // For now, trigger a re-execution of the current step
    onExecute();
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Build spec content from issue fields
  const specContent = [
    issue.design && `## Design\n${issue.design}`,
    issue.notes && `## Notes\n${issue.notes}`,
    issue.acceptance && `## Acceptance Criteria\n${issue.acceptance}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="flex h-full">
      {/* Left: Spec content */}
      <div className="w-1/2 border-r flex flex-col">
        <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900">
          <h3 className="text-sm font-medium text-muted-foreground">
            Ticket Context
          </h3>
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
        </div>
      </div>

      {/* Right: Chat */}
      <div className="w-1/2 flex flex-col">
        <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900 flex items-center justify-between">
          <h3 className="text-sm font-medium">{stepName}</h3>
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

        <div className="flex-1 overflow-y-auto p-4">
          {response ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {response}
              </ReactMarkdown>
            </div>
          ) : isExecuting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Processing...
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting for execution...
            </p>
          )}
          <div ref={scrollEndRef} />
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
