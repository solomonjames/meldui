import { LayoutGrid, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { KanbanColumn } from "@/features/tickets/components/kanban-column";
import { TYPE_CONFIG } from "@/features/tickets/constants";
import type { Ticket, TicketPhase, WorkflowDefinition } from "@/shared/types";
import { getTicketPhase } from "@/shared/types";
import { Button } from "@/shared/ui/button";

interface BacklogPageProps {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  workflows: WorkflowDefinition[];
  onRefresh: () => Promise<void>;
  onCardClick: (ticket: Ticket) => void;
  onCreateTicket?: () => void;
}

type SortMode = "priority" | "date";
type TypeFilter = string | null;

const TICKET_TYPES = ["feature", "task", "bug", "chore", "epic"] as const;

const COLUMNS: { key: TicketPhase; title: string }[] = [
  { key: "backlog", title: "Backlog" },
  { key: "research", title: "Research" },
  { key: "plan", title: "Plan" },
  { key: "implementation", title: "Implementation" },
  { key: "review", title: "Review" },
  { key: "done", title: "Done" },
];

export function BacklogPage({
  tickets,
  loading,
  error,
  workflows,
  onRefresh,
  onCardClick,
  onCreateTicket,
}: BacklogPageProps) {
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);

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

  const ticketsByPhase = useMemo(() => {
    const buckets: Record<TicketPhase, Ticket[]> = {
      backlog: [],
      research: [],
      plan: [],
      implementation: [],
      review: [],
      done: [],
    };
    for (const ticket of filteredTickets) {
      const phase = getTicketPhase(ticket, workflows);
      buckets[phase].push(ticket);
    }
    return buckets;
  }, [filteredTickets, workflows]);

  const activeCount = tickets.filter((t) => t.status !== "closed").length;

  return (
    <div className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutGrid className="w-6 h-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
            {error && <span className="text-xs text-destructive">{error}</span>}
            <span className="text-sm text-muted-foreground">{activeCount} items</span>
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
              type="button"
              aria-pressed={sortMode === "priority"}
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
              type="button"
              aria-pressed={sortMode === "date"}
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
            type="button"
            aria-pressed={typeFilter === null}
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
              type="button"
              key={type}
              aria-pressed={typeFilter === type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`px-2.5 py-1 text-xs rounded-full capitalize transition-colors border ${
                typeFilter === type
                  ? (TYPE_CONFIG[type]?.filterActive ??
                    "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 font-medium")
                  : "border-transparent bg-white dark:bg-zinc-800 text-muted-foreground hover:text-foreground"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-hidden px-8 py-5">
        {filteredTickets.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            {typeFilter ? (
              <>
                <p className="text-sm font-medium text-muted-foreground">No {typeFilter} tickets</p>
                <p className="text-xs text-muted-foreground">
                  Try a different filter or create a new ticket
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-muted-foreground">No tickets yet</p>
                <p className="text-xs text-muted-foreground">
                  Create your first ticket to get started
                </p>
                {onCreateTicket && (
                  <Button
                    onClick={onCreateTicket}
                    className="bg-emerald hover:bg-emerald/90 text-white mt-2"
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Create Ticket
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-5 h-full overflow-x-auto">
            {COLUMNS.map((col) => {
              const columnTickets = ticketsByPhase[col.key];
              return (
                <div key={col.key} className="min-w-[220px] flex-1 h-full">
                  <KanbanColumn
                    title={col.title}
                    variant={col.key}
                    count={columnTickets.length}
                    tickets={columnTickets}
                    onCardClick={onCardClick}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
