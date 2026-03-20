import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Pencil, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSectionRenderer } from "@/shared/components/sections";
import type { Ticket, TicketSection, WorkflowSectionDef } from "@/shared/types";
import type { SectionType } from "@/shared/types";

interface TicketContextPanelProps {
  ticket: Ticket;
  sectionDefs?: WorkflowSectionDef[];
  lastUpdatedSectionId?: string | null;
  projectDir: string;
  onTicketRefresh: () => Promise<void>;
  isExecuting?: boolean;
}

/** Maps top-level ticket fields to section-like entries for fallback rendering. */
function synthesizeFallbackSections(ticket: Ticket): { id: string; label: string; content: string }[] {
  const sections: { id: string; label: string; content: string }[] = [];
  if (ticket.design) sections.push({ id: "design", label: "Design", content: ticket.design });
  if (ticket.notes) sections.push({ id: "notes", label: "Notes", content: ticket.notes });
  if (ticket.acceptance_criteria) sections.push({ id: "acceptance_criteria", label: "Acceptance Criteria", content: ticket.acceptance_criteria });
  return sections;
}

/** Resolve section content: typed section by ID > top-level field > empty */
function resolveSectionContent(ticket: Ticket, sectionId: string): TicketSection | null {
  return ticket.sections?.find((s) => s.id === sectionId) ?? null;
}

function resolveTopLevelFallback(ticket: Ticket, sectionId: string): string | null {
  const map: Record<string, string | undefined> = {
    design: ticket.design ?? undefined,
    notes: ticket.notes ?? undefined,
    acceptance_criteria: ticket.acceptance_criteria ?? undefined,
  };
  return map[sectionId] ?? null;
}

export function TicketContextPanel({
  ticket,
  sectionDefs,
  lastUpdatedSectionId,
  projectDir,
  onTicketRefresh,
  isExecuting,
}: TicketContextPanelProps) {
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [flashingSectionId, setFlashingSectionId] = useState<string | null>(null);
  const [prevSectionId, setPrevSectionId] = useState<string | null>(null);

  // Derive persistent highlight directly from the prop
  const persistentHighlightId = lastUpdatedSectionId ?? null;

  // Official React pattern: derive state from props by comparing previous
  // value in state (not refs) during render. React re-renders before commit.
  if (lastUpdatedSectionId && lastUpdatedSectionId !== prevSectionId) {
    setPrevSectionId(lastUpdatedSectionId);
    setFlashingSectionId(lastUpdatedSectionId);
    if (!expandedSections.includes(lastUpdatedSectionId)) {
      setExpandedSections((prev) => [...prev, lastUpdatedSectionId]);
    }
  }

  // Clear flash after 1.5s and auto-scroll
  useEffect(() => {
    if (!flashingSectionId) return;
    const flashTimer = setTimeout(() => setFlashingSectionId(null), 1500);
    return () => clearTimeout(flashTimer);
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

  const handleSectionEdit = useCallback(
    async (sectionId: string) => {
      try {
        // For typed sections, use the update_section command
        const section = ticket.sections?.find((s) => s.id === sectionId);
        if (section) {
          // Determine content shape based on section type
          let content: unknown;
          if (section.type === "markdown") {
            content = { text: editValue };
          } else {
            // For other types, pass through raw value
            content = editValue;
          }

          await invoke("ticket_update_section", {
            projectDir,
            ticketId: ticket.id,
            sectionId,
            content,
          });
        }
        setEditingSectionId(null);
        await onTicketRefresh();
      } catch (err) {
        console.error("Failed to update section:", err);
      }
    },
    [editValue, projectDir, ticket.id, ticket.sections, onTicketRefresh]
  );

  const startEditing = (sectionId: string, currentContent: string) => {
    setEditingSectionId(sectionId);
    setEditValue(currentContent);
  };

  const hasSectionDefs = sectionDefs && sectionDefs.length > 0;

  // Render typed section content using the section renderer registry
  const renderSectionContent = (section: TicketSection) => {
    const Renderer = getSectionRenderer(section.type as SectionType);
    if (Renderer) {
      return (
        <Renderer
          section={section}
          onChange={(content) => {
            // Direct onChange from renderers — persist immediately
            invoke("ticket_update_section", {
              projectDir,
              ticketId: ticket.id,
              sectionId: section.id,
              content,
            }).then(() => onTicketRefresh());
          }}
        />
      );
    }

    // Fallback: render as markdown if content has a text field
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

  const isSectionEmpty = (section: TicketSection): boolean => {
    if (section.type === "markdown") {
      const text = (section.content as Record<string, unknown>)?.text;
      return !text || String(text).trim() === "";
    }
    if (section.type === "acceptance_criteria" || section.type === "checklist") {
      const items = (section.content as Record<string, unknown>)?.items;
      return !Array.isArray(items) || items.length === 0;
    }
    if (section.type === "key_value") {
      const entries = (section.content as Record<string, unknown>)?.entries;
      return !Array.isArray(entries) || entries.length === 0;
    }
    return false;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-white dark:bg-zinc-900 flex items-center gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Ticket Context
        </h3>
        {isExecuting && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 animate-pulse">
            live
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description block */}
        {ticket.description && (
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex items-center gap-1.5 group"
              onClick={() => setDescriptionOpen(!descriptionOpen)}
            >
              <ChevronRight
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${descriptionOpen ? "rotate-90" : ""}`}
              />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
                Description
              </h3>
            </button>
            {descriptionOpen && (
              <div className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {ticket.description}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workflow sections (accordion) */}
        {hasSectionDefs ? (
          <Accordion
            multiple
            value={expandedSections}
            onValueChange={(value) => setExpandedSections(value)}
          >
            {sectionDefs.map((def) => {
              const typedSection = resolveSectionContent(ticket, def.id);
              const topLevelFallback = resolveTopLevelFallback(ticket, def.id);
              const hasContent = typedSection
                ? !isSectionEmpty(typedSection)
                : !!topLevelFallback;
              const isHighlighted = flashingSectionId === def.id;
              const isPersistentHighlight = persistentHighlightId === def.id;
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
                  <div className="flex items-center">
                    <AccordionTrigger className="flex-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                      {def.label}
                      {!hasContent && (
                        <span className="ml-2 text-[10px] normal-case tracking-normal font-normal italic">
                          No content yet
                        </span>
                      )}
                    </AccordionTrigger>
                    {typedSection && typedSection.type === "markdown" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground mr-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isEditing) {
                            handleSectionEdit(def.id);
                          } else {
                            startEditing(def.id, getSectionText(typedSection));
                          }
                        }}
                      >
                        {isEditing ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Pencil className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                  <AccordionContent>
                    {isEditing ? (
                      <textarea
                        ref={editTextareaRef}
                        className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingSectionId(null);
                        }}
                      />
                    ) : typedSection ? (
                      renderSectionContent(typedSection)
                    ) : topLevelFallback ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {topLevelFallback}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No content yet
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          /* Task 8: Fallback — no workflow section defs, render top-level fields */
          (() => {
            const fallback = synthesizeFallbackSections(ticket);
            if (fallback.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No spec content available
                </p>
              );
            }
            return (
              <Accordion
                multiple
                defaultValue={fallback.map((s) => s.id)}
              >
                {fallback.map((section) => (
                  <AccordionItem key={section.id} value={section.id}>
                    <AccordionTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                      {section.label}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {section.content}
                        </ReactMarkdown>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            );
          })()
        )}
      </div>
    </div>
  );
}
