import { useState, useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/bindings";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { FeedbackRequestEvent } from "@/shared/types";

export function useWorkflowFeedback(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackRequestEvent | null>(null);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mark not-ready before re-subscribing to Tauri events
    setFeedbackReady(false);

    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const unlisten = await events.agentFeedbackRequest.listen((event) => {
        if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
          setPendingFeedback(event.payload);
        }
      });

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
        await commands.agentFeedbackRespond(requestId, approved, feedback ?? null);
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
