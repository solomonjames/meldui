import { useState, useEffect, useCallback } from "react";
import { DiffViewer } from "@/components/diff";
import type {
  Ticket,
  DiffFile,
  ReviewComment,
  ReviewFinding,
  FindingAction,
  ReviewSubmission,
} from "@/types";

interface DiffReviewViewProps {
  ticket: Ticket;
  onGetDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  reviewFindings: ReviewFinding[];
  reviewComments: ReviewComment[];
  onAddComment: (filePath: string, lineNumber: number, content: string, suggestion?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onSubmitReview: (submission: ReviewSubmission) => void;
  reviewDisabled?: boolean;
}

export function DiffReviewView({
  ticket,
  onGetDiff,
  reviewFindings,
  reviewComments,
  onAddComment,
  onDeleteComment,
  onSubmitReview,
  reviewDisabled,
}: DiffReviewViewProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [findingActions, setFindingActions] = useState<FindingAction[]>([]);

  const worktreePath = ticket.metadata?.worktree_path as string | undefined;
  const worktreeBaseCommit = ticket.metadata?.worktree_base_commit as string | undefined;

  const loadDiff = useCallback(async () => {
    setLoading(true);
    const diff = await onGetDiff(worktreePath, worktreeBaseCommit);
    setFiles(diff);
    setLoading(false);
  }, [onGetDiff, worktreePath, worktreeBaseCommit]);

  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  const handleFindingAction = (findingId: string, action: FindingAction["action"]) => {
    setFindingActions((prev) => {
      const existing = prev.findIndex((a) => a.finding_id === findingId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { finding_id: findingId, action };
        return updated;
      }
      return [...prev, { finding_id: findingId, action }];
    });
  };

  const handleApprove = (summary: string) => {
    onSubmitReview({
      action: "approve",
      summary,
      comments: reviewComments.filter((c) => !c.resolved),
      finding_actions: findingActions,
    });
  };

  const handleRequestChanges = (summary: string) => {
    onSubmitReview({
      action: "request_changes",
      summary,
      comments: reviewComments.filter((c) => !c.resolved),
      finding_actions: findingActions,
    });
  };

  return (
    <DiffViewer
      files={files}
      comments={reviewComments}
      findings={reviewFindings}
      findingActions={findingActions}
      loading={loading}
      reviewDisabled={reviewDisabled}
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
      onFindingAction={handleFindingAction}
      onApprove={handleApprove}
      onRequestChanges={handleRequestChanges}
    />
  );
}
