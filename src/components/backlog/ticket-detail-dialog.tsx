import { useState, useEffect, useCallback } from "react";
import {
  Hash,
  ArrowUp,
  ArrowLeft,
  Calendar,
  User,
  Trash2,
  Check,
  Send,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_CONFIG, PRIORITY_CONFIG } from "./kanban-card";
import type { BeadsIssue, BeadsComment } from "@/types";

interface TicketDetailDialogProps {
  issue: BeadsIssue | null;
  allIssues: BeadsIssue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => Promise<void>;
  onSave?: (
    id: string,
    updates: { description?: string }
  ) => Promise<void>;
  onShowIssue?: (id: string) => Promise<BeadsIssue | null>;
  onAddComment?: (id: string, text: string) => Promise<void>;
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

function formatRelativeTime(dateStr: string) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return formatDate(dateStr) ?? dateStr;
  } catch {
    return dateStr;
  }
}

function getInitials(name: string) {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TicketDetailDialog({
  issue,
  allIssues,
  open,
  onOpenChange,
  onDelete,
  onSave,
  onShowIssue,
  onAddComment,
}: TicketDetailDialogProps) {
  const [issueStack, setIssueStack] = useState<BeadsIssue[]>([]);
  const [comments, setComments] = useState<BeadsComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editedDescription, setEditedDescription] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset stack when the root issue changes or dialog closes
  useEffect(() => {
    if (issue && open) {
      setIssueStack([issue]);
      setEditedDescription(null);
    } else {
      setIssueStack([]);
      setComments([]);
      setEditedDescription(null);
    }
  }, [issue, open]);

  const currentIssue = issueStack[issueStack.length - 1];

  // Fetch full issue with comments when current issue changes
  const fetchComments = useCallback(async () => {
    if (!currentIssue || !onShowIssue) return;
    setCommentsLoading(true);
    try {
      const full = await onShowIssue(currentIssue.id);
      setComments(full?.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [currentIssue?.id, onShowIssue]);

  useEffect(() => {
    if (currentIssue && open) {
      fetchComments();
    }
  }, [currentIssue?.id, open, fetchComments]);

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, currentIssue, editedDescription]);

  if (!currentIssue) return null;

  const typeInfo = TYPE_CONFIG[currentIssue.issue_type] ?? TYPE_CONFIG.task;
  const priorityInfo = PRIORITY_CONFIG[currentIssue.priority] ?? PRIORITY_CONFIG[2];
  const statusInfo = STATUS_CONFIG[currentIssue.status] ?? STATUS_CONFIG.open;
  const TypeIcon = typeInfo.icon;

  const subTickets = allIssues.filter((i) => i.parent_id === currentIssue.id);
  const canGoBack = issueStack.length > 1;

  const hasChanges = editedDescription !== null && editedDescription !== (currentIssue.description ?? "");

  const handleBack = () => {
    setIssueStack((stack) => stack.slice(0, -1));
    setEditedDescription(null);
  };

  const handleSubTicketClick = (subTicket: BeadsIssue) => {
    setIssueStack((stack) => [...stack, subTicket]);
    setEditedDescription(null);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    await onDelete(currentIssue.id);
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!onSave || !hasChanges) return;
    setIsSaving(true);
    try {
      await onSave(currentIssue.id, {
        description: editedDescription ?? undefined,
      });
      setEditedDescription(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!onAddComment || !commentText.trim()) return;
    await onAddComment(currentIssue.id, commentText.trim());
    setCommentText("");
    await fetchComments();
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddComment();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0">
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
            {/* Editable description */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Description
              </h3>
              <textarea
                className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                value={editedDescription ?? currentIssue.description ?? ""}
                onChange={(e) => setEditedDescription(e.target.value)}
                placeholder="No description"
              />
            </div>

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

          {/* Activity / Comments section */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Activity
              {currentIssue.comment_count != null && currentIssue.comment_count > 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  ({currentIssue.comment_count})
                </span>
              )}
            </h3>

            {commentsLoading ? (
              <p className="text-xs text-muted-foreground">Loading comments...</p>
            ) : comments.length > 0 ? (
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                      {getInitials(c.author || "?")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{c.author || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">commented</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatRelativeTime(c.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/90 mt-0.5 whitespace-pre-wrap">
                        {c.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No comments yet</p>
            )}

            {/* Comment input */}
            {onAddComment && (
              <div className="flex gap-2 items-end">
                <textarea
                  className="flex-1 rounded-lg border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm resize-none min-h-[36px] max-h-[120px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={handleCommentKeyDown}
                  rows={1}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 shrink-0"
                  disabled={!commentText.trim()}
                  onClick={handleAddComment}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

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
        </div>

        {/* Action footer */}
        <div className="border-t px-6 py-3 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-900/50">
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              onClick={handleDelete}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-muted-foreground mr-2">
            Press <kbd className="px-1 py-0.5 rounded border bg-white dark:bg-zinc-800 text-[10px] font-mono">⌘ S</kbd> to save
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {onSave && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!hasChanges || isSaving}
              onClick={handleSave}
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
