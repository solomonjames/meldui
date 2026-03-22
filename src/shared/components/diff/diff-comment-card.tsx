import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import type { ReviewComment } from "@/shared/types";

interface DiffCommentCardProps {
  comment: ReviewComment;
  onDelete?: (commentId: string) => void;
}

export function DiffCommentCard({ comment, onDelete }: DiffCommentCardProps) {
  const [expanded, setExpanded] = useState(!comment.resolved);

  if (comment.resolved) {
    return (
      <div className="ml-[5.25rem] mr-4 my-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="line-through">Resolved comment</span>
        </button>
        {expanded && (
          <div className="mt-1 pl-4 border-l-2 border-zinc-300 dark:border-zinc-700 text-xs text-muted-foreground opacity-60">
            {comment.content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ml-[5.25rem] mr-4 my-1.5 border-l-2 border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20 rounded-r-md p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
          {comment.content}
        </p>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {comment.suggestion && (
        <div className="mt-1.5 rounded bg-zinc-100 dark:bg-zinc-800 p-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
          <span className="text-emerald-600 dark:text-emerald-400 font-sans text-[10px] uppercase tracking-wider">
            suggestion
          </span>
          <pre className="mt-0.5 whitespace-pre-wrap">{comment.suggestion}</pre>
        </div>
      )}
    </div>
  );
}
