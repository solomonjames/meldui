import { DiffCommentCard } from "@/shared/components/diff/diff-comment-card";
import { DiffCommentInput } from "@/shared/components/diff/diff-comment-input";
import { DiffLine } from "@/shared/components/diff/diff-line";
import type { DiffFile, ReviewComment } from "@/shared/types";
import { ScrollArea } from "@/shared/ui/scroll-area";

interface DiffContentProps {
  file: DiffFile;
  comments: ReviewComment[];
  activeCommentLine: number | null;
  onClickLine: (lineNumber: number) => void;
  onAddComment: (lineNumber: number, content: string, suggestion?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onCancelComment: () => void;
}

export function DiffContent({
  file,
  comments,
  activeCommentLine,
  onClickLine,
  onAddComment,
  onDeleteComment,
  onCancelComment,
}: DiffContentProps) {
  const fileComments = comments.filter((c) => c.file_path === file.path);

  return (
    <div className="flex-1 flex flex-col">
      {/* File header */}
      <div className="px-6 py-2 border-b bg-white dark:bg-zinc-900 flex items-center justify-between">
        <h3 className="text-sm font-medium font-mono">{file.path}</h3>
        <span className="flex gap-2 text-xs">
          {file.additions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">-{file.deletions}</span>
          )}
        </span>
      </div>

      {/* Diff lines */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {file.hunks.map((hunk, hunkIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hunks lack stable IDs
            <div key={hunkIdx}>
              {/* Hunk header */}
              <div className="flex items-stretch text-xs font-mono bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                <div className="w-10 shrink-0 border-r border-zinc-200 dark:border-zinc-800" />
                <div className="w-10 shrink-0 border-r border-zinc-200 dark:border-zinc-800" />
                <div className="w-5 shrink-0" />
                <div className="flex-1 py-0.5 pr-4">
                  @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@{" "}
                  {hunk.header}
                </div>
              </div>

              {/* Lines + inline comments */}
              {hunk.lines.map((line, lineIdx) => {
                const lineNumber = line.new_line_no ?? line.old_line_no;
                const lineComments = fileComments.filter((c) => c.line_number === lineNumber);
                const isCommentInput = activeCommentLine === lineNumber;

                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines lack stable IDs
                  <div key={`${hunkIdx}-${lineIdx}`}>
                    <DiffLine line={line} onClickLine={onClickLine} />
                    {/* Existing comments for this line */}
                    {lineComments.map((comment) => (
                      <DiffCommentCard
                        key={comment.id}
                        comment={comment}
                        onDelete={onDeleteComment}
                      />
                    ))}
                    {/* Comment input */}
                    {isCommentInput && lineNumber && (
                      <DiffCommentInput
                        filePath={file.path}
                        lineNumber={lineNumber}
                        onSubmit={(content, suggestion) =>
                          onAddComment(lineNumber, content, suggestion)
                        }
                        onCancel={onCancelComment}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
