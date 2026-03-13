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
import { Button } from "@/components/ui/button";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { TicketDetailDialog } from "./ticket-detail-dialog";
import type { BeadsIssue, BeadsStatus } from "@/types";

interface BacklogPageProps {
  issues: BeadsIssue[];
  beadsStatus: BeadsStatus | null;
  loading: boolean;
  error: string | null;
  onUpdateIssue: (
    id: string,
    updates: { status?: string; priority?: string; description?: string }
  ) => Promise<void>;
  onCloseIssue: (id: string, reason?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onInitBeads: () => Promise<void>;
}

type SortMode = "priority" | "date";
type TypeFilter = string | null;

const ISSUE_TYPES = ["feature", "task", "bug", "chore", "epic"] as const;

const COLUMNS = [
  { key: "open", title: "Open", variant: "open" as const },
  { key: "in_progress", title: "In Progress", variant: "in_progress" as const },
  { key: "closed", title: "Closed", variant: "closed" as const },
];

const COLUMN_VARIANTS = new Set(COLUMNS.map((c) => c.variant));

function getColumnForStatus(status: string): "open" | "in_progress" | "closed" {
  if (status === "open" || status === "blocked") return "open";
  if (status === "in_progress") return "in_progress";
  return "closed";
}

export function BacklogPage({
  issues,
  beadsStatus,
  loading,
  error,
  onUpdateIssue,
  onCloseIssue,
  onRefresh,
  onInitBeads,
}: BacklogPageProps) {
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<BeadsIssue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const filteredIssues = useMemo(() => {
    let filtered = issues.filter((i) => !i.parent_id);
    if (typeFilter) {
      filtered = filtered.filter((i) => i.issue_type === typeFilter);
    }
    return filtered.sort((a, b) => {
      if (sortMode === "priority") return a.priority - b.priority;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [issues, sortMode, typeFilter]);

  const activeIssue = activeId ? issues.find((i) => i.id === activeId) ?? null : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = String(active.id);
      const targetColumn = String(over.id);

      if (!COLUMN_VARIANTS.has(targetColumn as "open" | "in_progress" | "closed")) return;

      const issue = issues.find((i) => i.id === issueId);
      if (!issue) return;

      const currentColumn = getColumnForStatus(issue.status);
      if (currentColumn === targetColumn) return;

      if (targetColumn === "closed") {
        onCloseIssue(issueId);
      } else {
        onUpdateIssue(issueId, { status: targetColumn });
      }
    },
    [issues, onUpdateIssue, onCloseIssue]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  if (!beadsStatus?.installed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-zinc-100 dark:bg-zinc-950">
        <h3 className="text-lg font-medium">Beads Not Found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          MeldUI uses Beads for issue tracking. Install it from{" "}
          <span className="font-mono text-emerald">
            github.com/steveyegge/beads
          </span>
        </p>
      </div>
    );
  }

  if (!beadsStatus?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-zinc-100 dark:bg-zinc-950">
        <h3 className="text-lg font-medium">Beads Not Initialized</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Initialize beads in this project to start tracking issues.
        </p>
        <Button onClick={onInitBeads} className="bg-emerald hover:bg-emerald/90 text-white">
          Initialize Beads
        </Button>
      </div>
    );
  }

  const activeCount = issues.filter((i) => i.status !== "closed").length;

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
          {ISSUE_TYPES.map((type) => (
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
          <div className="grid grid-cols-3 gap-5 h-full">
            {COLUMNS.map((col) => {
              const columnIssues = filteredIssues.filter(
                (i) => getColumnForStatus(i.status) === col.variant
              );
              return (
                <KanbanColumn
                  key={col.key}
                  title={col.title}
                  variant={col.variant}
                  count={columnIssues.length}
                  issues={columnIssues}
                  onUpdate={onUpdateIssue}
                  onClose={onCloseIssue}
                  onCardClick={setSelectedIssue}
                />
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeIssue ? (
              <KanbanCard
                issue={activeIssue}
                variant={getColumnForStatus(activeIssue.status)}
                onUpdate={onUpdateIssue}
                onClose={onCloseIssue}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      <TicketDetailDialog
        issue={selectedIssue}
        allIssues={issues}
        open={!!selectedIssue}
        onOpenChange={(open) => {
          if (!open) setSelectedIssue(null);
        }}
      />
    </div>
  );
}
