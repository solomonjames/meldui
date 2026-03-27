import { useCallback, useState } from "react";
import { commands, events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { ReviewComment, ReviewFinding, ReviewSubmission } from "@/shared/types";

export function useWorkflowReview(
  activeTicketId: string | null,
  setError: (issueId: string, msg: string) => void,
) {
  const [reviewFindingsMap, setReviewFindingsMap] = useState<Record<string, ReviewFinding[]>>({});
  const [reviewCommentsMap, setReviewCommentsMap] = useState<Record<string, ReviewComment[]>>({});
  const [pendingReviewMap, setPendingReviewMap] = useState<Record<string, string>>({});
  const [reviewRoundKey, setReviewRoundKey] = useState(0);

  const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
    // No activeTicketId filter — store for all tickets
    setReviewFindingsMap((prev) => ({
      ...prev,
      [payload.ticket_id]: payload.findings as ReviewFinding[],
    }));
    setPendingReviewMap((prev) => ({
      ...prev,
      [payload.ticket_id]: payload.request_id,
    }));
    setReviewRoundKey((prev) => prev + 1);
  });

  // Convenience: viewed ticket's state
  const reviewFindings = activeTicketId ? (reviewFindingsMap[activeTicketId] ?? []) : [];
  const reviewComments = activeTicketId ? (reviewCommentsMap[activeTicketId] ?? []) : [];
  const pendingReviewRequestId = activeTicketId ? (pendingReviewMap[activeTicketId] ?? null) : null;

  const addReviewComment = useCallback(
    (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
      if (!activeTicketId) return;
      const comment: ReviewComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file_path: filePath,
        line_number: lineNumber,
        content,
        suggestion,
        resolved: false,
      };
      setReviewCommentsMap((prev) => ({
        ...prev,
        [activeTicketId]: [...(prev[activeTicketId] ?? []), comment],
      }));
    },
    [activeTicketId],
  );

  const deleteReviewComment = useCallback(
    (commentId: string) => {
      if (!activeTicketId) return;
      setReviewCommentsMap((prev) => ({
        ...prev,
        [activeTicketId]: (prev[activeTicketId] ?? []).filter((c) => c.id !== commentId),
      }));
    },
    [activeTicketId],
  );

  const submitReview = useCallback(
    async (submission: ReviewSubmission) => {
      if (!activeTicketId || !pendingReviewMap[activeTicketId]) return;
      const requestId = pendingReviewMap[activeTicketId];
      try {
        await commands.agentReviewRespond(
          activeTicketId,
          requestId,
          submission as import("@/bindings").JsonValue,
        );
        setPendingReviewMap((prev) => {
          const next = { ...prev };
          delete next[activeTicketId];
          return next;
        });

        if (submission.action === "request_changes") {
          setReviewCommentsMap((prev) => ({
            ...prev,
            [activeTicketId]: (prev[activeTicketId] ?? []).map((c) => ({ ...c, resolved: true })),
          }));
          setReviewFindingsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
        } else {
          setReviewCommentsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
          setReviewFindingsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
        }
      } catch (err) {
        setPendingReviewMap((prev) => {
          const next = { ...prev };
          delete next[activeTicketId];
          return next;
        });
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
    [activeTicketId, pendingReviewMap, setError],
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
