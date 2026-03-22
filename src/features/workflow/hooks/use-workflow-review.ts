import { useState, useCallback } from "react";
import { commands, events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { ReviewFinding, ReviewComment, ReviewSubmission } from "@/shared/types";

export function useWorkflowReview(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [pendingReviewRequestId, setPendingReviewRequestId] = useState<string | null>(null);
  const [reviewRoundKey, setReviewRoundKey] = useState(0);

  const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      setReviewFindings(payload.findings as ReviewFinding[]);
      setPendingReviewRequestId(payload.request_id);
      setReviewRoundKey(prev => prev + 1);
    }
  });

  const addReviewComment = useCallback(
    (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
      const comment: ReviewComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file_path: filePath,
        line_number: lineNumber,
        content,
        suggestion,
        resolved: false,
      };
      setReviewComments((prev) => [...prev, comment]);
    },
    []
  );

  const deleteReviewComment = useCallback((commentId: string) => {
    setReviewComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  const submitReview = useCallback(
    async (submission: ReviewSubmission) => {
      if (!pendingReviewRequestId) return;
      try {
        await commands.agentReviewRespond(pendingReviewRequestId, submission as import("@/bindings").JsonValue);
        setPendingReviewRequestId(null);

        // Mark existing comments as resolved for next round
        if (submission.action === "request_changes") {
          setReviewComments((prev) =>
            prev.map((c) => ({ ...c, resolved: true }))
          );
          setReviewFindings([]);
        } else {
          // Approved — clear all review state
          setReviewComments([]);
          setReviewFindings([]);
        }
      } catch (err) {
        setPendingReviewRequestId(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to submit review: ${err}`);
        }
      }
    },
    [pendingReviewRequestId, setError]
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
