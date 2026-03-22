import { MessageSquarePlus } from "lucide-react";
import type { DiffLine as DiffLineType } from "@/shared/types";

interface DiffLineProps {
  line: DiffLineType;
  onClickLine?: (lineNumber: number) => void;
}

export function DiffLine({ line, onClickLine }: DiffLineProps) {
  const lineNumber = line.new_line_no ?? line.old_line_no;

  let bgClass = "";
  let textClass = "";
  let prefix = " ";

  switch (line.line_type) {
    case "added":
      bgClass = "bg-emerald-50 dark:bg-emerald-900/20";
      textClass = "text-emerald-700 dark:text-emerald-400";
      prefix = "+";
      break;
    case "removed":
      bgClass = "bg-red-50 dark:bg-red-900/20";
      textClass = "text-red-700 dark:text-red-400";
      prefix = "-";
      break;
    case "context":
      textClass = "text-zinc-600 dark:text-zinc-400";
      break;
  }

  return (
    <div
      className={`group flex items-stretch text-xs font-mono ${bgClass} hover:brightness-95 dark:hover:brightness-110`}
    >
      {/* Line numbers */}
      <div className="w-10 shrink-0 text-right pr-2 select-none text-zinc-400 dark:text-zinc-600 border-r border-zinc-200 dark:border-zinc-800 py-0.5">
        {line.old_line_no ?? ""}
      </div>
      <div className="w-10 shrink-0 text-right pr-2 select-none text-zinc-400 dark:text-zinc-600 border-r border-zinc-200 dark:border-zinc-800 py-0.5">
        {line.new_line_no ?? ""}
      </div>

      {/* Prefix */}
      <div className={`w-5 shrink-0 text-center select-none py-0.5 ${textClass}`}>{prefix}</div>

      {/* Content */}
      <div className={`flex-1 py-0.5 pr-4 whitespace-pre-wrap break-all ${textClass}`}>
        {line.content.replace(/\n$/, "")}
      </div>

      {/* Comment button */}
      {onClickLine && lineNumber && (
        <button
          type="button"
          onClick={() => onClickLine(lineNumber)}
          className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-blue-500 hover:text-blue-700 transition-opacity shrink-0"
          title="Add comment"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
