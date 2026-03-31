import { useCallback } from "react";
import { commands, events } from "@/bindings";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { ReviewFinding, ReviewSubmission } from "@/shared/types";

export function useWorkflowReview(
  activeTicketId: string | null,
  setError: (issueId: string, msg: string) => void,
) {
  const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
    const store = reviewStoreFactory.getStore(payload.ticket_id);
    store.getState().setFindings(payload.findings as ReviewFinding[], payload.request_id);
  });

  const getActiveStore = () =>
    activeTicketId ? reviewStoreFactory.getStore(activeTicketId) : null;

  const reviewFindings = getActiveStore()?.getState().findings ?? [];
  const reviewComments = getActiveStore()?.getState().comments ?? [];
  const pendingReviewRequestId = getActiveStore()?.getState().pendingRequestId ?? null;
  const reviewRoundKey = getActiveStore()?.getState().roundKey ?? 0;

  const addReviewComment = useCallback(
    (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
      if (!activeTicketId) return;
      reviewStoreFactory
        .getStore(activeTicketId)
        .getState()
        .addComment(filePath, lineNumber, content, suggestion);
    },
    [activeTicketId],
  );

  const deleteReviewComment = useCallback(
    (commentId: string) => {
      if (!activeTicketId) return;
      reviewStoreFactory.getStore(activeTicketId).getState().deleteComment(commentId);
    },
    [activeTicketId],
  );

  const submitReview = useCallback(
    async (submission: ReviewSubmission) => {
      const store = activeTicketId ? reviewStoreFactory.getStore(activeTicketId) : null;
      if (!store || !activeTicketId) return;
      const requestId = store.getState().pendingRequestId;
      if (!requestId) return;

      try {
        await commands.agentReviewRespond(
          activeTicketId,
          requestId,
          submission as import("@/bindings").JsonValue,
        );
        if (submission.action === "request_changes") {
          store.getState().clearAfterRequestChanges();
        } else {
          store.getState().clearAfterApproval();
        }
      } catch (err) {
        store.getState().clearAfterApproval();
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError(
            activeTicketId,
            "Agent session expired. Click Resume to continue where you left off.",
          );
        } else {
          setError(activeTicketId, `Failed to submit review: ${err}`);
        }
      }
    },
    [activeTicketId, setError],
  );

  return {
    reviewFindings,
    reviewComments,
    pendingReviewRequestId,
    addReviewComment,
    deleteReviewComment,
    submitReview,
    reviewRoundKey,
    reviewReady,
  };
}
