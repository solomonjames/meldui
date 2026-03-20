import { useState, useMemo, useCallback } from "react";
import { LayoutList } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/shared/ui/button";
import { KanbanColumn } from "@/features/tickets/components/kanban-column";
import { KanbanCard } from "@/features/tickets/components/kanban-card";
import type { Ticket } from "@/shared/types";

interface BacklogPageProps {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  onUpdateTicket: (
    id: string,
    updates: { status?: string; priority?: string; description?: string }
  ) => Promise<void>;
  onCloseTicket: (id: string, reason?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onAutoStart?: (ticket: Ticket) => Promise<void>;
  onCardClick: (ticket: Ticket) => void;
}

type SortMode = "priority" | "date";
type TypeFilter = string | null;

const TICKET_TYPES = ["feature", "task", "bug", "chore", "epic"] as const;

const COLUMNS = [
  { key: "open", title: "Open" },
  { key: "in_progress", title: "In Progress" },
  { key: "blocked", title: "Blocked" },
  { key: "deferred", title: "Deferred" },
  { key: "closed", title: "Closed" },
];

const COLUMN_KEYS = new Set(COLUMNS.map((c) => c.key));

export function BacklogPage({
  tickets,
  loading,
  error,
  onUpdateTicket,
  onCloseTicket,
  onAutoStart,
  onRefresh,
  onCardClick,
}: BacklogPageProps) {
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const filteredTickets = useMemo(() => {
    let filtered = tickets.filter((t) => !t.parent_id);
    if (typeFilter) {
      filtered = filtered.filter((t) => t.ticket_type === typeFilter);
    }
    return filtered.sort((a, b) => {
      if (sortMode === "priority") return a.priority - b.priority;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [tickets, sortMode, typeFilter]);

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) ?? null : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const ticketId = String(active.id);
      const targetColumn = String(over.id);

      if (!COLUMN_KEYS.has(targetColumn)) return;

      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      if (ticket.status === targetColumn) return;

      if (targetColumn === "closed") {
        await onCloseTicket(ticketId);
      } else {
        await onUpdateTicket(ticketId, { status: targetColumn });

        // Auto-start workflow when dragging to In Progress
        if (targetColumn === "in_progress" && onAutoStart) {
          await onAutoStart(ticket);
        }
      }
    },
    [tickets, onUpdateTicket, onCloseTicket, onAutoStart]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const activeCount = tickets.filter((t) => t.status !== "closed").length;

  return (
    <div className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutList className="w-6 h-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Backlog</h1>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-xs text-muted-foreground">Loading...</span>
            )}
            {error && (
              <span className="text-xs text-destructive">{error}</span>
            )}
            <span className="text-sm text-muted-foreground">
              {activeCount} items
            </span>
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sort */}
          <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 rounded-lg p-0.5 shadow-sm border">
            <button
              onClick={() => setSortMode("priority")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sortMode === "priority"
                  ? "bg-zinc-100 dark:bg-zinc-700 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Priority
            </button>
            <button
              onClick={() => setSortMode("date")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sortMode === "date"
                  ? "bg-zinc-100 dark:bg-zinc-700 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Date
            </button>
          </div>

          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

          {/* Type filters */}
          <button
            onClick={() => setTypeFilter(null)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              typeFilter === null
                ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 font-medium"
                : "bg-white dark:bg-zinc-800 text-muted-foreground hover:text-foreground border"
            }`}
          >
            All
          </button>
          {TICKET_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`px-2.5 py-1 text-xs rounded-full capitalize transition-colors ${
                typeFilter === type
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 font-medium"
                  : "bg-white dark:bg-zinc-800 text-muted-foreground hover:text-foreground border"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-hidden px-8 py-5">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex gap-5 h-full overflow-x-auto">
            {COLUMNS.map((col) => {
              const columnTickets = filteredTickets.filter(
                (t) => t.status === col.key
              );
              return (
                <div key={col.key} className="min-w-[280px] w-[280px] shrink-0 h-full">
                  <KanbanColumn
                    title={col.title}
                    variant={col.key}
                    count={columnTickets.length}
                    tickets={columnTickets}
                    onUpdate={onUpdateTicket}
                    onClose={onCloseTicket}
                    onCardClick={onCardClick}
                  />
                </div>
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeTicket ? (
              <KanbanCard
                ticket={activeTicket}
                variant={activeTicket.status}
                onUpdate={onUpdateTicket}
                onClose={onCloseTicket}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
