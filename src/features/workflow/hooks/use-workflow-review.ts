import { useState, useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/bindings";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ReviewFinding, ReviewComment, ReviewSubmission } from "@/shared/types";

export function useWorkflowReview(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [pendingReviewRequestId, setPendingReviewRequestId] = useState<string | null>(null);
  const [reviewRoundKey, setReviewRoundKey] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mark not-ready before re-subscribing to Tauri events
    setReviewReady(false);

    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const unlisten = await events.agentReviewFindingsRequest.listen((event) => {
        if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
          setReviewFindings(event.payload.findings as ReviewFinding[]);
          setPendingReviewRequestId(event.payload.request_id);
          setReviewRoundKey(prev => prev + 1);
        }
      });

      if (!cancelled) {
        unlistenRef.current = unlisten;
        setReviewReady(true);
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
