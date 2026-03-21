import { useState, useEffect, useRef, useCallback } from "react";
import {
  Hash,
  ArrowUp,
  Calendar,
  User,
  GitPullRequest,
  Send,
  Bot,
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { getSectionRenderer } from "@/shared/components/sections/section-registry";
import "@/shared/components/sections";
import { SubtaskProgress } from "@/features/tickets/components/subtask-progress";
import { STATUS_CONFIG, TYPE_CONFIG, PRIORITY_CONFIG } from "@/features/tickets/constants";
import type { Ticket, TicketComment, TicketSection, WorkflowSectionDef } from "@/shared/types";
import type { SectionType } from "@/shared/types";

interface TicketDetailsPanelProps {
  ticket: Ticket;
  allTickets: Ticket[];
  onUpdateTicket: (
    id: string,
    updates: {
      status?: string;
      priority?: string;
      description?: string;
      notes?: string;
      design?: string;
      acceptance_criteria?: string;
    }
  ) => Promise<void>;
  onShowTicket: (id: string) => Promise<Ticket | null>;
  onAddComment: (id: string, text: string) => Promise<void>;
  onUpdateSection?: (ticketId: string, sectionId: string, content: unknown) => Promise<void>;
  // Workflow data passed as props (feature isolation)
  sectionDefs?: WorkflowSectionDef[];
  lastUpdatedSectionId?: string | null;
  onDeleteTicket?: (id: string) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
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

export function TicketDetailsPanel({
  ticket,
  allTickets,
  onUpdateTicket,
  onShowTicket,
  onAddComment,
  onUpdateSection,
  sectionDefs,
  lastUpdatedSectionId,
  onDeleteTicket,
  isCollapsed,
  onToggleCollapse,
}: TicketDetailsPanelProps) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [expandedSections, setExpandedSections] = useState<string[]>(["_details", "_description"]);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save debounce refs — one timer per field to prevent cross-field cancellation
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [pendingSave, setPendingSave] = useState<Record<string, string>>({});

  // Clear all pending debounce timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of Object.values(debounceRefs.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Flash animation for section updates
  const [flashingSectionId, setFlashingSectionId] = useState<string | null>(null);
  const [prevSectionId, setPrevSectionId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Track section update flash
  if (lastUpdatedSectionId && lastUpdatedSectionId !== prevSectionId) {
    setPrevSectionId(lastUpdatedSectionId);
    setFlashingSectionId(lastUpdatedSectionId);
    if (!expandedSections.includes(lastUpdatedSectionId)) {
      setExpandedSections((prev) => [...prev, lastUpdatedSectionId]);
    }
  }

  useEffect(() => {
    if (!flashingSectionId) return;
    const timer = setTimeout(() => setFlashingSectionId(null), 1500);
    return () => clearTimeout(timer);
  }, [flashingSectionId]);

  useEffect(() => {
    if (!lastUpdatedSectionId) return;
    const timer = setTimeout(() => {
      sectionRefs.current[lastUpdatedSectionId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
    return () => clearTimeout(timer);
  }, [lastUpdatedSectionId]);

  // Focus textarea when editing
  useEffect(() => {
    if (editingSectionId && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.selectionStart = editTextareaRef.current.value.length;
    }
  }, [editingSectionId]);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const full = await onShowTicket(ticket.id);
      setComments(full?.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [ticket.id, onShowTicket]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Auto-save text fields with 500ms debounce (per-field timers)
  const debouncedSave = useCallback(
    (field: string, value: string) => {
      setPendingSave((prev) => ({ ...prev, [field]: value }));
      if (debounceRefs.current[field]) clearTimeout(debounceRefs.current[field]);
      debounceRefs.current[field] = setTimeout(async () => {
        try {
          await onUpdateTicket(ticket.id, { [field]: value });
          setPendingSave((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
          });
        } catch {
          toast.error(`Failed to save ${field}`, { description: "Your changes have been reverted." });
          setPendingSave((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
          });
        }
      }, 500);
    },
    [ticket.id, onUpdateTicket]
  );

  // Immediate save for dropdown changes
  const handleDropdownChange = useCallback(
    async (field: string, value: string) => {
      try {
        await onUpdateTicket(ticket.id, { [field]: value });
      } catch {
        toast.error(`Failed to update ${field}`);
      }
    },
    [ticket.id, onUpdateTicket]
  );

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    const text = commentText.trim();
    try {
      await onAddComment(ticket.id, text);
      setCommentText("");
      await fetchComments();
    } catch {
      toast.error("Failed to add comment");
    }
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddComment();
    }
  };

  const handleSectionEdit = useCallback(
    async (sectionId: string) => {
      if (!onUpdateSection) return;
      const section = ticket.sections?.find((s) => s.id === sectionId);
      if (section) {
        const content = section.type === "markdown" ? { text: editValue } : editValue;
        try {
          await onUpdateSection(ticket.id, sectionId, content);
          setEditingSectionId(null);
        } catch {
          toast.error("Failed to update section");
        }
        return;
      }
      setEditingSectionId(null);
    },
    [editValue, ticket.id, ticket.sections, onUpdateSection]
  );

  const subTickets = allTickets.filter((t) => t.parent_id === ticket.id);
  const hasSectionDefs = sectionDefs && sectionDefs.length > 0;

  const typeInfo = TYPE_CONFIG[ticket.ticket_type] ?? TYPE_CONFIG.task;
  const TypeIcon = typeInfo.icon;

  const commentGroups = groupComments(
    [...comments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  );

  const renderSectionContent = (section: TicketSection) => {
    const Renderer = getSectionRenderer(section.type as SectionType);
    if (Renderer) {
      return (
        <Renderer
          section={section}
          onChange={(content) => {
            onUpdateSection?.(ticket.id, section.id, content);
          }}
        />
      );
    }
    const text =
      typeof section.content === "object" && section.content !== null && "text" in (section.content as Record<string, unknown>)
        ? String((section.content as Record<string, unknown>).text)
        : JSON.stringify(section.content);
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  };

  const getSectionText = (section: TicketSection): string => {
    if (typeof section.content === "object" && section.content !== null && "text" in (section.content as Record<string, unknown>)) {
      return String((section.content as Record<string, unknown>).text);
    }
    return JSON.stringify(section.content, null, 2);
  };

  // Collapse toggle button (shown when collapsed)
  if (isCollapsed) {
    return (
      <div className="flex items-start pt-3 px-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onToggleCollapse}
        >
          <PanelRightOpen className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-muted-foreground">
            <Hash className="w-3 h-3" />
            {ticket.id}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={onToggleCollapse}
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Unified accordion for all panel sections */}
          <Accordion
            multiple
            value={expandedSections}
            onValueChange={(value) => setExpandedSections(value)}
          >
            {/* Details */}
            <AccordionItem value="_details">
              <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Details
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 text-sm">
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Select
                      value={ticket.status}
                      onValueChange={(v) => handleDropdownChange("status", v)}
                    >
                      <SelectTrigger className="w-[130px] h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Priority</span>
                    <Select
                      value={String(ticket.priority)}
                      onValueChange={(v) => handleDropdownChange("priority", v)}
                    >
                      <SelectTrigger className="w-[130px] h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                          <SelectItem key={key} value={key}>
                            <span className={`flex items-center gap-1 ${cfg.color}`}>
                              <ArrowUp className="w-3 h-3" />
                              {cfg.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Type */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className={`inline-flex items-center gap-1 font-medium ${typeInfo.color}`}>
                      <TypeIcon className="w-3 h-3" />
                      {ticket.ticket_type}
                    </span>
                  </div>

                  {/* Assignee */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Assignee</span>
                    <span className="font-medium">
                      {ticket.assignee || <span className="text-muted-foreground">&mdash;</span>}
                    </span>
                  </div>

                  {/* Labels */}
                  {ticket.labels && ticket.labels.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Labels</span>
                      <span className="flex flex-wrap gap-1 justify-end">
                        {ticket.labels.map((l) => (
                          <span
                            key={l}
                            className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs"
                          >
                            {l}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}

                  {/* PR URL */}
                  {typeof ticket.metadata?.pr_url === "string" && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">PR</span>
                      <a
                        href={ticket.metadata.pr_url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                      >
                        <GitPullRequest className="w-3 h-3" />
                        Pull Request
                      </a>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="border-t pt-3 space-y-2">
                    {ticket.created_at && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Created
                        </span>
                        <span>{formatDate(ticket.created_at)}</span>
                      </div>
                    )}
                    {ticket.updated_at && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Updated</span>
                        <span>{formatDate(ticket.updated_at)}</span>
                      </div>
                    )}
                    {ticket.created_by && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          Created by
                        </span>
                        <span>{ticket.created_by}</span>
                      </div>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Description */}
            <AccordionItem value="_description">
              <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Description
              </AccordionTrigger>
              <AccordionContent>
                {editingSectionId === "_description" ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editTextareaRef}
                      className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-y min-h-[200px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value);
                        debouncedSave("description", e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingSectionId(null);
                      }}
                      placeholder="No description"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setEditingSectionId(null)}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="cursor-pointer rounded-lg p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                    onClick={() => {
                      setEditingSectionId("_description");
                      setEditValue(pendingSave.description ?? ticket.description ?? "");
                    }}
                  >
                    {(pendingSave.description ?? ticket.description) ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {pendingSave.description ?? ticket.description ?? ""}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No description</p>
                    )}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Workflow sections */}
            {hasSectionDefs && sectionDefs.map((def) => {
              const typedSection = ticket.sections?.find((s) => s.id === def.id) ?? null;
              const isHighlighted = flashingSectionId === def.id;
              const isPersistentHighlight = lastUpdatedSectionId === def.id;
              const isEditing = editingSectionId === def.id;

              return (
                <AccordionItem
                  key={def.id}
                  value={def.id}
                  ref={(el) => { sectionRefs.current[def.id] = el; }}
                  className={`transition-all duration-300 ${
                    isHighlighted ? "ring-2 ring-emerald-400 rounded-lg" : ""
                  } ${isPersistentHighlight ? "border-l-2 border-emerald-500" : ""}`}
                >
                  <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    {def.label}
                  </AccordionTrigger>
                  <AccordionContent>
                    {isEditing && typedSection?.type === "markdown" ? (
                      <div className="space-y-2">
                        <textarea
                          ref={editTextareaRef}
                          className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-y min-h-[200px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              handleSectionEdit(def.id);
                            }
                          }}
                        />
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => handleSectionEdit(def.id)}
                          >
                            <Check className="w-3.5 h-3.5" />
                            Done
                          </Button>
                        </div>
                      </div>
                    ) : typedSection ? (
                      typedSection.type === "markdown" ? (
                        <div
                          className="cursor-pointer rounded-lg p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          onClick={() => {
                            setEditingSectionId(def.id);
                            setEditValue(getSectionText(typedSection));
                          }}
                        >
                          {renderSectionContent(typedSection)}
                        </div>
                      ) : (
                        renderSectionContent(typedSection)
                      )
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              );
            })}

            {/* Legacy field sections (when no sectionDefs) */}
            {!hasSectionDefs && ticket.design && (
              <AccordionItem value="_legacy-design">
                <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Design
                </AccordionTrigger>
                <AccordionContent>
                  <textarea
                    className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    value={pendingSave.design ?? ticket.design}
                    onChange={(e) => debouncedSave("design", e.target.value)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {!hasSectionDefs && ticket.notes && (
              <AccordionItem value="_legacy-notes">
                <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Notes
                </AccordionTrigger>
                <AccordionContent>
                  <textarea
                    className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    value={pendingSave.notes ?? ticket.notes}
                    onChange={(e) => debouncedSave("notes", e.target.value)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {!hasSectionDefs && ticket.acceptance_criteria && (
              <AccordionItem value="_legacy-acceptance-criteria">
                <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Acceptance Criteria
                </AccordionTrigger>
                <AccordionContent>
                  <textarea
                    className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    value={pendingSave.acceptance_criteria ?? ticket.acceptance_criteria}
                    onChange={(e) => debouncedSave("acceptance_criteria", e.target.value)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>

          {/* Sub-tickets */}
          {subTickets.length > 0 && (
            <SubtaskProgress
              subTickets={subTickets}
              onRemoveSubTicket={onDeleteTicket ? (id) => onDeleteTicket(id) : undefined}
            />
          )}

          {/* Activity / Comments */}
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
                  return (
                    <AgentCommentGroup key={`ag-${gi}`} comments={group.comments} />
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No comments yet</p>
            )}

            {/* Comment input */}
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
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

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
