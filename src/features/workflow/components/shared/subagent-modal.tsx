import type { SubagentActivity } from "@/shared/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

interface SubagentModalProps {
  activity: SubagentActivity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubagentModal({ activity, open, onOpenChange }: SubagentModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {activity.description || "Subagent"}
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                activity.status === "running"
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : activity.status === "completed"
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
              }`}
            >
              {activity.status}
            </span>
          </DialogTitle>
          <DialogDescription>Task ID: {activity.task_id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {activity.summary && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">Summary</h4>
              <p className="text-sm">{activity.summary}</p>
            </div>
          )}

          {activity.usage && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Usage</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2.5 text-center">
                  <p className="text-lg font-semibold">
                    {activity.usage.total_tokens.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">tokens</p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2.5 text-center">
                  <p className="text-lg font-semibold">{activity.usage.tool_uses}</p>
                  <p className="text-[10px] text-muted-foreground">tool uses</p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2.5 text-center">
                  <p className="text-lg font-semibold">
                    {(activity.usage.duration_ms / 1000).toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-muted-foreground">duration</p>
                </div>
              </div>
            </div>
          )}

          {activity.status === "running" && activity.last_tool_name && (
            <p className="text-xs text-muted-foreground">
              Currently using: {activity.last_tool_name}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
