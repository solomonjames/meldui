import { FileCode } from "lucide-react";
import type { DiffFile } from "@/shared/types";
import { ScrollArea } from "@/shared/ui/scroll-area";

interface DiffFileTreeProps {
  files: DiffFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export function DiffFileTree({ files, selectedFile, onSelectFile }: DiffFileTreeProps) {
  return (
    <div className="w-64 border-r bg-white dark:bg-zinc-900 flex flex-col">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Changed Files ({files.length})
        </h3>
      </div>
      <ScrollArea className="flex-1">
        {files.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No changes found</p>
        ) : (
          <div className="p-2 space-y-0.5">
            {files.map((file) => (
              <button
                type="button"
                key={file.path}
                onClick={() => onSelectFile(file.path)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                  selectedFile === file.path
                    ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                <FileCode className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1">{file.path}</span>
                <span className="flex gap-1.5 text-[10px] shrink-0">
                  {file.additions > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.additions}
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
