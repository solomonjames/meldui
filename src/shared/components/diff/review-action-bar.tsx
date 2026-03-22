import { Check, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

interface ReviewActionBarProps {
  commentCount: number;
  findingCount: number;
  onApprove: (summary: string) => void;
  onRequestChanges: (summary: string) => void;
  disabled?: boolean;
}

export function ReviewActionBar({
  commentCount,
  findingCount,
  onApprove,
  onRequestChanges,
  disabled,
}: ReviewActionBarProps) {
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState("");
  const [action, setAction] = useState<"approve" | "request_changes" | null>(null);

  const handleSubmit = () => {
    if (!action) return;
    if (action === "approve") {
      onApprove(summary);
    } else {
      onRequestChanges(summary);
    }
    setSummary("");
    setShowSummary(false);
    setAction(null);
  };

  const startAction = (a: "approve" | "request_changes") => {
    setAction(a);
    setShowSummary(true);
  };

  return (
    <div className="border-t bg-white dark:bg-zinc-900 px-4 py-3">
      {showSummary ? (
        <div className="space-y-2">
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={
              action === "approve"
                ? "Optional approval summary..."
                : "Describe what needs to change..."
            }
            className="min-h-[60px] text-xs resize-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape") {
                setShowSummary(false);
                setAction(null);
              }
            }}
          />
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowSummary(false);
                setAction(null);
              }}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={action === "request_changes" && !summary.trim()}
              className={`h-7 text-xs ${action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
            >
              {action === "approve" ? "Submit Approval" : "Submit Review"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {commentCount} comment{commentCount !== 1 ? "s" : ""}
              </span>
            )}
            {findingCount > 0 && (
              <span>
                {findingCount} finding{findingCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => startAction("request_changes")}
              disabled={disabled}
              className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
            >
              Request Changes
            </Button>
            <Button
              size="sm"
              onClick={() => startAction("approve")}
              disabled={disabled}
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1"
            >
              <Check className="w-3 h-3" /> Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
