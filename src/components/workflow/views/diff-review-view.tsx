import { useState, useEffect } from "react";
import { FileCode, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BeadsIssue, DiffFile } from "@/types";

interface DiffReviewViewProps {
  issue: BeadsIssue;
  isAwaitingGate: boolean;
  onApprove: () => void;
  onGetDiff: () => Promise<DiffFile[]>;
}

export function DiffReviewView({
  issue,
  isAwaitingGate,
  onApprove,
  onGetDiff,
}: DiffReviewViewProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDiff = async () => {
      setLoading(true);
      const diff = await onGetDiff();
      setFiles(diff);
      if (diff.length > 0) {
        setSelectedFile(diff[0].path);
      }
      setLoading(false);
    };
    loadDiff();
  }, [onGetDiff]);

  const currentFile = files.find((f) => f.path === selectedFile);

  return (
    <div className="flex h-full">
      {/* Left: File tree */}
      <div className="w-64 border-r bg-white dark:bg-zinc-900 flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Changed Files ({files.length})
          </h3>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <p className="p-4 text-xs text-muted-foreground">Loading diff...</p>
          ) : files.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">No changes found</p>
          ) : (
            <div className="p-2 space-y-0.5">
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                    selectedFile === file.path
                      ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{file.path}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Diff content */}
      <div className="flex-1 flex flex-col">
        <div className="px-6 py-3 border-b bg-white dark:bg-zinc-900 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">
              {selectedFile ?? "Diff Review"}
            </h3>
            <p className="text-xs text-muted-foreground">{issue.title}</p>
          </div>
          {isAwaitingGate && (
            <Button
              size="sm"
              onClick={onApprove}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Approve Changes & Continue
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1">
          {currentFile ? (
            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto">
              {currentFile.content.split("\n").map((line, idx) => {
                let lineClass = "";
                if (line.startsWith("+") && !line.startsWith("+++")) {
                  lineClass =
                    "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400";
                } else if (line.startsWith("-") && !line.startsWith("---")) {
                  lineClass =
                    "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400";
                } else if (line.startsWith("@@")) {
                  lineClass =
                    "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400";
                }
                return (
                  <div key={idx} className={`px-2 ${lineClass}`}>
                    {line}
                  </div>
                );
              })}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                Select a file to view changes
              </p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
