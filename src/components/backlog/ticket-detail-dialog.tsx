import { useState, useEffect } from "react";
import { Hash, ArrowUp, ArrowLeft, Calendar, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_CONFIG, PRIORITY_CONFIG } from "./kanban-card";
import type { BeadsIssue } from "@/types";

interface TicketDetailDialogProps {
  issue: BeadsIssue | null;
  allIssues: BeadsIssue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  open: { dot: "bg-zinc-400", label: "Open" },
  in_progress: { dot: "bg-blue-500", label: "In Progress" },
  blocked: { dot: "bg-red-500", label: "Blocked" },
  closed: { dot: "bg-emerald-500", label: "Closed" },
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </h3>
      <div className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

function formatDate(dateStr?: string) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function TicketDetailDialog({ issue, allIssues, open, onOpenChange }: TicketDetailDialogProps) {
  const [issueStack, setIssueStack] = useState<BeadsIssue[]>([]);

  // Reset stack when the root issue changes or dialog closes
  useEffect(() => {
    if (issue && open) {
      setIssueStack([issue]);
    } else {
      setIssueStack([]);
    }
  }, [issue, open]);

  const currentIssue = issueStack[issueStack.length - 1];
  if (!currentIssue) return null;

  const typeInfo = TYPE_CONFIG[currentIssue.issue_type] ?? TYPE_CONFIG.task;
  const priorityInfo = PRIORITY_CONFIG[currentIssue.priority] ?? PRIORITY_CONFIG[2];
  const statusInfo = STATUS_CONFIG[currentIssue.status] ?? STATUS_CONFIG.open;
  const TypeIcon = typeInfo.icon;

  const subTickets = allIssues.filter((i) => i.parent_id === currentIssue.id);
  const canGoBack = issueStack.length > 1;

  const handleBack = () => {
    setIssueStack((stack) => stack.slice(0, -1));
  };

  const handleSubTicketClick = (subTicket: BeadsIssue) => {
    setIssueStack((stack) => [...stack, subTicket]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          {/* Back button + ID badge */}
          <div className="flex items-center gap-2">
            {canGoBack && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleBack}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-muted-foreground">
              <Hash className="w-3 h-3" />
              {currentIssue.id}
            </span>
          </div>
          {/* Title */}
          <DialogTitle className="text-lg font-semibold leading-snug pr-8">
            {currentIssue.title}
          </DialogTitle>
        </DialogHeader>

        {/* Metadata badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status */}
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
            {statusInfo.label}
          </span>
          {/* Priority */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${priorityInfo.bg} ${priorityInfo.color}`}
          >
            <ArrowUp className="w-3 h-3" />
            {priorityInfo.label}
          </span>
          {/* Type */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${typeInfo.bg} ${typeInfo.color}`}
          >
            <TypeIcon className="w-3 h-3" />
            {currentIssue.issue_type}
          </span>
        </div>

        {/* Content sections */}
        <div className="space-y-4">
          {currentIssue.description && (
            <Section label="Description">{currentIssue.description}</Section>
          )}
          {currentIssue.design && (
            <Section label="Design">{currentIssue.design}</Section>
          )}
          {currentIssue.notes && (
            <Section label="Notes">{currentIssue.notes}</Section>
          )}
          {currentIssue.acceptance && (
            <Section label="Acceptance Criteria">{currentIssue.acceptance}</Section>
          )}
        </div>

        {/* Sub-tickets */}
        {subTickets.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Sub-tickets ({subTickets.length})
            </h3>
            <div className="space-y-1">
              {subTickets.map((sub) => {
                const subStatus = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.open;
                const subType = TYPE_CONFIG[sub.issue_type] ?? TYPE_CONFIG.task;
                const subPriority = PRIORITY_CONFIG[sub.priority] ?? PRIORITY_CONFIG[2];
                const SubTypeIcon = subType.icon;
                return (
                  <button
                    key={sub.id}
                    onClick={() => handleSubTicketClick(sub)}
                    className="w-full flex items-center gap-2.5 rounded-lg border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${subStatus.dot}`} />
                    <span className="text-sm font-medium truncate flex-1">
                      {sub.title}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${subPriority.bg} ${subPriority.color}`}
                    >
                      {subPriority.label}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${subType.bg} ${subType.color}`}
                    >
                      <SubTypeIcon className="w-3 h-3" />
                      {sub.issue_type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Labels */}
        {currentIssue.labels && currentIssue.labels.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {currentIssue.labels.map((label) => (
              <Badge key={label} variant="secondary" className="text-xs">
                {label}
              </Badge>
            ))}
          </div>
        )}

        {/* Footer metadata */}
        <div className="border-t pt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {currentIssue.created_by && (
            <span className="inline-flex items-center gap-1">
              <User className="w-3 h-3" />
              {currentIssue.created_by}
            </span>
          )}
          {currentIssue.created_at && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Created {formatDate(currentIssue.created_at)}
            </span>
          )}
          {currentIssue.updated_at && (
            <span>Updated {formatDate(currentIssue.updated_at)}</span>
          )}
          {(currentIssue.owner || currentIssue.assignee) && (
            <span>
              Assigned to {currentIssue.assignee ?? currentIssue.owner}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
