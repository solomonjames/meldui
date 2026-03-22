import { ChevronDown, ChevronUp, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DebugEntry } from "@/shared/hooks/use-debug-log";
import type { StepStatus } from "@/shared/types";
import { Button } from "@/shared/ui/button";

interface DebugPanelProps {
  entries: DebugEntry[];
  stateSnapshot: {
    step_status: StepStatus;
    loading: boolean;
    error: string | null;
    listenersReady: boolean;
    currentStepId: string | null;
  };
  onClear: () => void;
  onRefresh: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  lifecycle: "text-blue-400",
  event: "text-green-400",
  ndjson: "text-yellow-400",
  error: "text-red-400",
};

export function DebugPanel({ entries, stateSnapshot, onClear, onRefresh }: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  // Toggle with Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!import.meta.env.DEV) return null;
  if (!open) return null;

  const statusStr =
    typeof stateSnapshot.step_status === "object"
      ? `failed: ${(stateSnapshot.step_status as { failed: string }).failed}`
      : stateSnapshot.step_status;

  return (
    <div className="border-t bg-zinc-900 text-zinc-200 text-xs font-mono max-h-[300px] flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 bg-zinc-800">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200"
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          Debug Panel
        </button>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">
            step: <span className="text-zinc-300">{stateSnapshot.currentStepId ?? "none"}</span>
            {" | "}status: <span className="text-zinc-300">{statusStr}</span>
            {" | "}loading:{" "}
            <span className={stateSnapshot.loading ? "text-yellow-400" : "text-zinc-300"}>
              {String(stateSnapshot.loading)}
            </span>
            {" | "}listeners:{" "}
            <span className={stateSnapshot.listenersReady ? "text-green-400" : "text-red-400"}>
              {String(stateSnapshot.listenersReady)}
            </span>
          </span>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClear}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {entries.length === 0 ? (
          <p className="text-zinc-500">No debug events yet</p>
        ) : (
          entries.map((entry, i) => {
            const time = new Date(entry.timestamp).toISOString().slice(11, 23);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: log entries lack stable IDs
                key={i}
                className="flex gap-2"
              >
                <span className="text-zinc-600 shrink-0">{time}</span>
                <span
                  className={`shrink-0 w-16 ${CATEGORY_COLORS[entry.category] ?? "text-zinc-400"}`}
                >
                  [{entry.category}]
                </span>
                <span className="text-zinc-300 break-all">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
