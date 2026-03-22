import { useEffect, useState } from "react";
import { DiffViewer } from "@/shared/components/diff";
import type {
  DiffFile,
  FindingAction,
  ReviewComment,
  ReviewFinding,
  ReviewSubmission,
  Ticket,
} from "@/shared/types";

interface DiffReviewViewProps {
  ticket: Ticket;
  onGetDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  reviewFindings: ReviewFinding[];
  reviewComments: ReviewComment[];
  onAddComment: (
    filePath: string,
    lineNumber: number,
    content: string,
    suggestion?: string,
  ) => void;
  onDeleteComment: (commentId: string) => void;
  onSubmitReview: (submission: ReviewSubmission) => void;
  reviewDisabled?: boolean;
  reviewRoundKey?: number;
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
  reviewRoundKey: _reviewRoundKey,
}: DiffReviewViewProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [findingActions, setFindingActions] = useState<FindingAction[]>([]);

  const worktreePath = ticket.metadata?.worktree_path as string | undefined;
  const worktreeBaseCommit = ticket.metadata?.worktree_base_commit as string | undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFindingActions([]);
    onGetDiff(worktreePath, worktreeBaseCommit).then((diff) => {
      if (!cancelled) {
        setFiles(diff);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath, worktreeBaseCommit, onGetDiff]);

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
