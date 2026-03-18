import { useState, useEffect, useCallback } from "react";
import {
  Hash,
  ArrowLeft,
  Trash2,
  Check,
  Send,
  Bot,
  ChevronDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "./sections/collapsible-section";
import { getSectionRenderer } from "./sections/section-registry";
import "./sections"; // Register built-in section renderers
import { TicketMetadataSidebar } from "./ticket-metadata-sidebar";
import { SubtaskProgress } from "./subtask-progress";
import type { Ticket, TicketComment } from "@/types";

interface TicketDetailDialogProps {
  ticket: Ticket | null;
  allTickets: Ticket[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => Promise<void>;
  onSave?: (
    id: string,
    updates: {
      description?: string;
      notes?: string;
      design?: string;
      acceptance_criteria?: string;
    }
  ) => Promise<void>;
  onShowTicket?: (id: string) => Promise<Ticket | null>;
  onAddComment?: (id: string, text: string) => Promise<void>;
  workflowSelector?: React.ReactNode;
  onStartWorkflow?: (ticket: Ticket) => void;
  hasWorkflowAssigned?: boolean;
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

// Group consecutive agent comments for collapse
function groupComments(comments: TicketComment[]) {
  const groups: Array<
    | { type: "human"; comment: TicketComment }
    | { type: "agent_group"; comments: TicketComment[] }
  > = [];

  let agentBuffer: TicketComment[] = [];

  const flushAgentBuffer = () => {
    if (agentBuffer.length === 0) return;
    if (agentBuffer.length >= 3) {
      groups.push({ type: "agent_group", comments: [...agentBuffer] });
    } else {
      for (const c of agentBuffer) {
        groups.push({ type: "agent_group", comments: [c] });
      }
    }
    agentBuffer = [];
  };

  for (const c of comments) {
    if (c.author === "agent") {
      agentBuffer.push(c);
    } else {
      flushAgentBuffer();
      groups.push({ type: "human", comment: c });
    }
  }
  flushAgentBuffer();

  return groups;
}

export function TicketDetailDialog({
  ticket,
  allTickets,
  open,
  onOpenChange,
  onDelete,
  onSave,
  onShowTicket,
  onAddComment,
  workflowSelector,
  onStartWorkflow,
  hasWorkflowAssigned,
}: TicketDetailDialogProps) {
  const [ticketStack, setTicketStack] = useState<Ticket[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const setField = (field: string, value: string) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  // Reset stack when the root ticket changes or dialog closes
  useEffect(() => {
    if (ticket && open) {
      setTicketStack([ticket]);
      setEdits({});
    } else {
      setTicketStack([]);
      setComments([]);
      setEdits({});
    }
  }, [ticket, open]);

  const currentTicket = ticketStack[ticketStack.length - 1];

  // Fetch full ticket with comments when current ticket changes
  const fetchComments = useCallback(async () => {
    if (!currentTicket || !onShowTicket) return;
    setCommentsLoading(true);
    try {
      const full = await onShowTicket(currentTicket.id);
      setComments(full?.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [currentTicket?.id, onShowTicket]);

  useEffect(() => {
    if (currentTicket && open) {
      fetchComments();
    }
  }, [currentTicket?.id, open, fetchComments]);

  const hasChanges =
    currentTicket != null &&
    Object.entries(edits).some(
      ([field, value]) =>
        value !== ((currentTicket as unknown as Record<string, unknown>)[field] ?? "")
    );

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
  }, [open, currentTicket, edits]);

  if (!currentTicket) return null;

  const subTickets = allTickets.filter((t) => t.parent_id === currentTicket.id);
  const canGoBack = ticketStack.length > 1;

  const handleBack = () => {
    setTicketStack((stack) => stack.slice(0, -1));
    setEdits({});
  };

  const handleSubTicketClick = (subTicket: Ticket) => {
    setTicketStack((stack) => [...stack, subTicket]);
    setEdits({});
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    await onDelete(currentTicket.id);
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!onSave || !hasChanges) return;
    setIsSaving(true);
    try {
      const updates: Record<string, string> = {};
      for (const [field, value] of Object.entries(edits)) {
        if (value !== ((currentTicket as unknown as Record<string, unknown>)[field] ?? "")) {
          updates[field] = value;
        }
      }
      await onSave(currentTicket.id, updates);
      setEdits({});
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!onAddComment || !commentText.trim()) return;
    await onAddComment(currentTicket.id, commentText.trim());
    setCommentText("");
    await fetchComments();
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddComment();
    }
  };

  const commentGroups = groupComments(
    [...comments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col p-0">
        {/* Sticky header — only back, ID, title */}
        <div className="border-b px-6 pt-6 pb-4 space-y-2 bg-zinc-50/50 dark:bg-zinc-900/50">
          <DialogHeader>
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
                {currentTicket.id}
              </span>
            </div>
            <DialogTitle className="text-lg font-semibold leading-snug pr-8">
              {currentTicket.title}
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Two-panel body: content + sidebar */}
        <div className="flex-1 overflow-y-auto">
          <div className="@container">
            <div className="flex flex-col @[640px]:flex-row">
              {/* Left panel — content */}
              <div className="flex-1 min-w-0 px-6 py-4 space-y-4">
                {/* Content sections — typed or legacy */}
                <div className="space-y-4">
                  {currentTicket.sections && currentTicket.sections.length > 0 ? (
                    // Typed sections rendering
                    currentTicket.sections.map((section) => {
                      const Renderer = getSectionRenderer(section.type);
                      return (
                        <CollapsibleSection
                          key={section.id}
                          label={section.label}
                          value=""
                          onChange={() => {}}
                          defaultOpen={!section.collapsed}
                          isAgentGenerated={section.source === "agent"}
                        >
                          {Renderer ? (
                            <Renderer
                              section={section}
                              onChange={(content) => {
                                // TODO: persist section content updates via Tauri command
                              }}
                            />
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              Unknown section type: {section.type}
                            </div>
                          )}
                        </CollapsibleSection>
                      );
                    })
                  ) : (
                    // Legacy string field rendering
                    <>
                      <CollapsibleSection
                        label="Description"
                        value={edits.description ?? currentTicket.description ?? ""}
                        onChange={(v) => setField("description", v)}
                        defaultOpen={true}
                      />

                      {(currentTicket.design || edits.design !== undefined) && (
                        <CollapsibleSection
                          label="Design"
                          value={edits.design ?? currentTicket.design ?? ""}
                          onChange={(v) => setField("design", v)}
                          defaultOpen={false}
                        />
                      )}
                      {(currentTicket.notes || edits.notes !== undefined) && (
                        <CollapsibleSection
                          label="Notes"
                          value={edits.notes ?? currentTicket.notes ?? ""}
                          onChange={(v) => setField("notes", v)}
                          defaultOpen={false}
                        />
                      )}
                      {(currentTicket.acceptance_criteria || edits.acceptance_criteria !== undefined) && (
                        <CollapsibleSection
                          label="Acceptance Criteria"
                          value={edits.acceptance_criteria ?? currentTicket.acceptance_criteria ?? ""}
                          onChange={(v) => setField("acceptance_criteria", v)}
                          defaultOpen={false}
                        />
                      )}
                    </>
                  )}
                </div>

                {/* Sub-tickets with progress */}
                {subTickets.length > 0 && (
                  <SubtaskProgress
                    subTickets={subTickets}
                    onSubTicketClick={handleSubTicketClick}
                  />
                )}

                {/* Activity / Comments section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Activity
                    {comments.length > 0 && (
                      <span className="ml-1.5 text-muted-foreground">
                        ({comments.length})
                      </span>
                    )}
                  </h3>

                  {commentsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading comments...</p>
                  ) : commentGroups.length > 0 ? (
                    <div className="space-y-3">
                      {commentGroups.map((group, gi) => {
                        if (group.type === "human") {
                          const c = group.comment;
                          return (
                            <div key={c.id} className="flex gap-3">
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
                          );
                        }
                        // Agent group
                        return (
                          <AgentCommentGroup
                            key={`ag-${gi}`}
                            comments={group.comments}
                          />
                        );
                      })}
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
              </div>

              {/* Right panel — metadata sidebar */}
              <div className="w-full @[640px]:w-[220px] shrink-0 border-t @[640px]:border-t-0 @[640px]:border-l px-6 @[640px]:px-4 py-4">
                <TicketMetadataSidebar
                  ticket={currentTicket}
                  workflowSelector={workflowSelector}
                  onStartWorkflow={onStartWorkflow}
                  hasWorkflowAssigned={hasWorkflowAssigned}
                />
              </div>
            </div>
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

// Agent comment group — collapses 3+ consecutive agent comments
function AgentCommentGroup({ comments }: { comments: TicketComment[] }) {
  const [expanded, setExpanded] = useState(comments.length < 3);

  if (comments.length >= 3 && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <Bot className="w-3.5 h-3.5" />
        <span>Agent performed {comments.length} actions</span>
        <ChevronDown className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {comments.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate flex-1">{c.text}</span>
          <span className="shrink-0">{formatRelativeTime(c.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
