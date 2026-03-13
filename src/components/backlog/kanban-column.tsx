import { useMemo } from "react";
import { Circle, Loader2, CheckCircle2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KanbanCard } from "./kanban-card";
import type { BeadsIssue } from "@/types";

type ColumnVariant = "open" | "in_progress" | "closed";

interface KanbanColumnProps {
  title: string;
  variant: ColumnVariant;
  count: number;
  issues: BeadsIssue[];
  onUpdate: (
    id: string,
    updates: { status?: string; priority?: string }
  ) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onCardClick?: (issue: BeadsIssue) => void;
}

const COLUMN_CONFIG: Record<
  ColumnVariant,
  { icon: typeof Circle; iconColor: string; badgeBg: string }
> = {
  open: {
    icon: Circle,
    iconColor: "text-zinc-400",
    badgeBg: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  in_progress: {
    icon: Loader2,
    iconColor: "text-blue-500",
    badgeBg: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
  },
  closed: {
    icon: CheckCircle2,
    iconColor: "text-emerald-500",
    badgeBg:
      "bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-400",
  },
};

export function KanbanColumn({
  title,
  variant,
  count,
  issues,
  onUpdate,
  onClose,
  onCardClick,
}: KanbanColumnProps) {
  const config = COLUMN_CONFIG[variant];
  const Icon = config.icon;

  const { setNodeRef, isOver } = useDroppable({ id: variant });
  const itemIds = useMemo(() => issues.map((i) => i.id), [issues]);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-0 min-h-0 h-full rounded-lg transition-colors ${
        isOver ? "bg-zinc-200/60 dark:bg-zinc-800/60 ring-2 ring-inset ring-zinc-300 dark:ring-zinc-600" : ""
      }`}
    >
      <div className="flex items-center gap-2 pb-3">
        <Icon className={`w-4 h-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{title}</span>
        <Badge
          variant="secondary"
          className={`text-[11px] px-1.5 py-0 ${config.badgeBg}`}
        >
          {count}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2 pr-2">
            {issues.map((issue) => (
              <KanbanCard
                key={issue.id}
                issue={issue}
                variant={variant}
                onUpdate={onUpdate}
                onClose={onClose}
                onClick={onCardClick}
              />
            ))}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}
