import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClaudeStatus, ChatMessage } from "@/types";

export function useClaude() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<string>("claude_status");
      setStatus(JSON.parse(result));
    } catch (err) {
      setStatus({
        installed: false,
        authenticated: false,
        message: `Error: ${err}`,
      });
    }
  }, []);

  const login = useCallback(async () => {
    try {
      await invoke<string>("claude_login");
      await checkStatus();
    } catch (err) {
      console.error("Login failed:", err);
    }
  }, [checkStatus]);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);

      try {
        const responses = await invoke<
          Array<{ role: string; content: string; msg_type: string }>
        >("claude_send", { prompt: content });

        const assistantMessages: ChatMessage[] = responses.map((r) => ({
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: r.content,
          timestamp: new Date(),
        }));

        setMessages((prev) => [...prev, ...assistantMessages]);
      } catch (err) {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${err}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    status,
    messages,
    loading,
    checkStatus,
    login,
    sendMessage,
    clearMessages,
  };
}
