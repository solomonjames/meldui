import { useCallback, useState } from "react";
import { commands, events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { FeedbackRequestEvent } from "@/shared/types";

export function useWorkflowFeedback(
  activeTicketId: string | null,
  setError: (msg: string) => void,
) {
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackRequestEvent | null>(null);

  const feedbackReady = useTauriEvent(events.agentFeedbackRequest, (payload) => {
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      setPendingFeedback(payload);
    }
  });

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
    [setError],
  );

  const clearPending = useCallback(() => {
    setPendingFeedback(null);
  }, []);

  return { pendingFeedback, respondToFeedback, clearPending, feedbackReady };
}
