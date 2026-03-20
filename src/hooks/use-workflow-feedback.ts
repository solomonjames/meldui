import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FeedbackRequestEvent } from "@/types";

export function useWorkflowFeedback(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackRequestEvent | null>(null);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeedbackReady(false);

    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const unlisten = await listen<FeedbackRequestEvent>(
        "agent-feedback-request",
        (event) => {
          if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
            setPendingFeedback(event.payload);
          }
        }
      );

      if (!cancelled) {
        unlistenRef.current = unlisten;
        setFeedbackReady(true);
      } else {
        unlisten();
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [activeTicketId]);

  const respondToFeedback = useCallback(
    async (requestId: string, approved: boolean, feedback?: string) => {
      try {
        await invoke("agent_feedback_respond", { requestId, approved, feedback });
        setPendingFeedback(null);
      } catch (err) {
        // Clear stale feedback — the sidecar is likely dead (broken pipe)
        setPendingFeedback(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to respond to feedback: ${err}`);
        }
      }
    },
    [setError]
  );

  const clearPending = useCallback(() => {
    setPendingFeedback(null);
  }, []);

  return { pendingFeedback, respondToFeedback, clearPending, feedbackReady };
}
