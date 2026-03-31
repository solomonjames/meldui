import { useCallback } from "react";
import { commands, events } from "@/bindings";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { ReviewFinding, ReviewSubmission } from "@/shared/types";

// Stable ID used when no ticket is active — ensures hooks are called unconditionally
const EMPTY_TICKET = "__none__";

export function useWorkflowReview(
  activeTicketId: string | null,
  setError: (issueId: string, msg: string) => void,
) {
  const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
    const store = reviewStoreFactory.getStore(payload.ticket_id);
    store.getState().setFindings(payload.findings as ReviewFinding[], payload.request_id);
  });

  // Reactive store subscriptions (always called — rules of hooks)
  const storeId = activeTicketId ?? EMPTY_TICKET;
  const reviewFindings = reviewStoreFactory.useTicketStore(storeId, (s) => s.findings);
  const reviewComments = reviewStoreFactory.useTicketStore(storeId, (s) => s.comments);
  const pendingReviewRequestId = reviewStoreFactory.useTicketStore(
    storeId,
    (s) => s.pendingRequestId,
  );
  const reviewRoundKey = reviewStoreFactory.useTicketStore(storeId, (s) => s.roundKey);

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
    reviewFindings: activeTicketId ? reviewFindings : [],
    reviewComments: activeTicketId ? reviewComments : [],
    pendingReviewRequestId: activeTicketId ? pendingReviewRequestId : null,
    addReviewComment,
    deleteReviewComment,
    submitReview,
    reviewRoundKey: activeTicketId ? reviewRoundKey : 0,
    reviewReady,
  };
}
