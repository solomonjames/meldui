import {
  Sparkles,
  SquareCheckBig,
  Layers,
  Wrench,
  Bug,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import type { BeadsIssue } from "@/types";

export const TYPE_CONFIG: Record<
  string,
  { icon: typeof Sparkles; color: string; bg: string }
> = {
  feature: {
    icon: Sparkles,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10",
  },
  task: {
    icon: SquareCheckBig,
    color: "text-blue-600",
    bg: "bg-blue-500/10",
  },
  epic: {
    icon: Layers,
    color: "text-purple-600",
    bg: "bg-purple-500/10",
  },
  chore: {
    icon: Wrench,
    color: "text-amber-600",
    bg: "bg-amber-500/10",
  },
  bug: {
    icon: Bug,
    color: "text-red-600",
    bg: "bg-red-500/10",
  },
};

export const PRIORITY_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: "P0", color: "text-red-600", bg: "bg-red-500/10" },
  1: { label: "P1", color: "text-amber-600", bg: "bg-amber-500/10" },
  2: { label: "P2", color: "text-cyan-600", bg: "bg-cyan-500/10" },
  3: { label: "P3", color: "text-blue-600", bg: "bg-blue-500/10" },
  4: { label: "P4", color: "text-zinc-500", bg: "bg-zinc-500/10" },
};

const NEXT_STATUS: Record<string, string | null> = {
  open: "in_progress",
  in_progress: null,
  blocked: "in_progress",
  closed: null,
};

interface KanbanCardProps {
  issue: BeadsIssue;
  variant: string;
  onUpdate: (
    id: string,
    updates: { status?: string; priority?: string }
  ) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onClick?: (issue: BeadsIssue) => void;
  isOverlay?: boolean;
}

export function KanbanCard({ issue, variant, onUpdate, onClose, onClick, isOverlay }: KanbanCardProps) {
  const typeInfo = TYPE_CONFIG[issue.issue_type] ?? TYPE_CONFIG.task;
  const priorityInfo = PRIORITY_CONFIG[issue.priority] ?? PRIORITY_CONFIG[2];
  const TypeIcon = typeInfo.icon;

  const isClosed = variant === "closed";
  const isInProgress = variant === "in_progress";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, disabled: isOverlay });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging && onClick) onClick(issue);
      }}
      className={`rounded-[10px] border p-3.5 shadow-sm transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      } ${isOverlay ? "shadow-lg ring-2 ring-zinc-300 dark:ring-zinc-600 rotate-[2deg]" : ""} ${
        isClosed
          ? "bg-zinc-50 dark:bg-zinc-800/50 opacity-85"
          : isInProgress
            ? "bg-white dark:bg-zinc-800 border-blue-500/20"
            : "bg-white dark:bg-zinc-800"
      }`}
    >
      <h4
        className={`text-sm font-medium leading-snug ${isClosed ? "text-muted-foreground" : ""}`}
      >
        {issue.title}
      </h4>
      {issue.description && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {issue.description}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${typeInfo.bg} ${typeInfo.color}`}
        >
          <TypeIcon className="w-3 h-3" />
          {issue.issue_type}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityInfo.bg} ${priorityInfo.color}`}
        >
          {priorityInfo.label}
        </span>
        {!isClosed && (
          <div className="ml-auto flex gap-1">
            {NEXT_STATUS[issue.status] && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(issue.id, { status: NEXT_STATUS[issue.status]! });
                }}
              >
                {NEXT_STATUS[issue.status]?.replace("_", " ")} →
              </Button>
            )}
            {issue.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(issue.id);
                }}
              >
                close →
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
