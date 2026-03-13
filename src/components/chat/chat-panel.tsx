import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage, ClaudeStatus } from "@/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  status: ClaudeStatus | null;
  onSend: (message: string) => void;
  onLogin: () => void;
  onClear: () => void;
}

export function ChatPanel({
  messages,
  loading,
  status,
  onSend,
  onLogin,
  onClear,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!status?.installed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-4xl">🔌</div>
        <h3 className="text-lg font-medium">Claude Code Not Found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          MeldUI requires Claude Code CLI to be installed. Visit{" "}
          <span className="font-mono text-primary">code.claude.com</span> to
          install it.
        </p>
      </div>
    );
  }

  if (!status?.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-4xl">🔐</div>
        <h3 className="text-lg font-medium">Authentication Required</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Log in to Claude Code to start using MeldUI.
        </p>
        <Button onClick={onLogin}>Log in to Claude</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Claude Chat</h2>
          <Badge variant="secondary" className="text-xs">
            Connected
          </Badge>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
            <p className="text-sm">Send a message to start chatting with Claude.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2 text-sm text-muted-foreground">
                  Thinking...
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude... (Enter to send, Shift+Enter for newline)"
            className="min-h-[44px] max-h-[120px] resize-none"
            disabled={loading}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
            className="self-end"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
