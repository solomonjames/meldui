import { useState } from "react";
import { DiffFileTree } from "./diff-file-tree";
import { DiffContent } from "./diff-content";
import { FindingsPanel } from "./findings-panel";
import { ReviewActionBar } from "./review-action-bar";
import type { DiffFile, ReviewComment, ReviewFinding, FindingAction } from "@/types";

interface DiffViewerProps {
  files: DiffFile[];
  comments: ReviewComment[];
  findings: ReviewFinding[];
  findingActions: FindingAction[];
  loading?: boolean;
  reviewDisabled?: boolean;
  onAddComment: (filePath: string, lineNumber: number, content: string, suggestion?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onFindingAction: (findingId: string, action: FindingAction["action"]) => void;
  onApprove: (summary: string) => void;
  onRequestChanges: (summary: string) => void;
}

export function DiffViewer({
  files,
  comments,
  findings,
  findingActions,
  loading,
  reviewDisabled,
  onAddComment,
  onDeleteComment,
  onFindingAction,
  onApprove,
  onRequestChanges,
}: DiffViewerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(
    files.length > 0 ? files[0].path : null
  );
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);

  const currentFile = files.find((f) => f.path === selectedFile);

  const handleClickLine = (lineNumber: number) => {
    setActiveCommentLine(activeCommentLine === lineNumber ? null : lineNumber);
  };

  const handleAddComment = (lineNumber: number, content: string, suggestion?: string) => {
    if (selectedFile) {
      onAddComment(selectedFile, lineNumber, content, suggestion);
      setActiveCommentLine(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Loading diff...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        {/* Left: File tree */}
        <DiffFileTree
          files={files}
          selectedFile={selectedFile}
          onSelectFile={(path) => {
            setSelectedFile(path);
            setActiveCommentLine(null);
          }}
        />

        {/* Center: Diff content */}
        {currentFile ? (
          <DiffContent
            file={currentFile}
            comments={comments}
            activeCommentLine={activeCommentLine}
            onClickLine={handleClickLine}
            onAddComment={handleAddComment}
            onDeleteComment={onDeleteComment}
            onCancelComment={() => setActiveCommentLine(null)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {files.length === 0 ? "No changes found" : "Select a file to view changes"}
            </p>
          </div>
        )}

        {/* Right: Findings panel */}
        {findings.length > 0 && (
          <FindingsPanel
            findings={findings}
            findingActions={findingActions}
            onFindingAction={onFindingAction}
          />
        )}
      </div>

      {/* Bottom: Review action bar */}
      <ReviewActionBar
        commentCount={comments.filter((c) => !c.resolved).length}
        findingCount={findings.length}
        onApprove={onApprove}
        onRequestChanges={onRequestChanges}
        disabled={reviewDisabled}
      />
    </div>
  );
}
