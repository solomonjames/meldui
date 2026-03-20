import { useState } from "react";
import type { FileChange, ToolActivity } from "@/shared/types";

interface FilesChangedProps {
  filesChanged: FileChange[];
  toolActivities: ToolActivity[];
}

const EXT_ICONS: Record<string, string> = {
  ts: "TS", tsx: "TX", js: "JS", jsx: "JX",
  rs: "RS", py: "PY", go: "GO", md: "MD",
  css: "CS", html: "HT", json: "JS", toml: "TM",
};

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICONS[ext] ?? "··";
}

export function FilesChanged({ filesChanged, toolActivities }: FilesChangedProps) {
  const [expanded, setExpanded] = useState(false);

  // Derive file list: use filesChanged if available, otherwise scan Write/Edit tools
  let files = filesChanged;
  if (files.length === 0) {
    const seen = new Set<string>();
    for (const a of toolActivities) {
      if (a.tool_name !== "Write" && a.tool_name !== "Edit") continue;
      try {
        const parsed = JSON.parse(a.input);
        const fp = parsed.file_path as string | undefined;
        if (fp && !seen.has(fp)) {
          seen.add(fp);
          files = [...files, { filename: fp }];
        }
      } catch {
        // ignore
      }
    }
  }

  if (files.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 my-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm"
      >
        <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-medium text-muted-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <svg
          className={`w-3 h-3 ml-auto text-muted-foreground transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t space-y-1 pt-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-5 h-5 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[9px] font-mono font-bold text-muted-foreground shrink-0">
                {getFileIcon(f.filename)}
              </span>
              <span className="font-mono text-zinc-600 dark:text-zinc-400 truncate">{f.filename}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
