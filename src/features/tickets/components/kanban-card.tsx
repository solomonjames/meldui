import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PRIORITY_CONFIG, TYPE_CONFIG } from "@/features/tickets/constants";
import type { Ticket } from "@/shared/types";
import { Button } from "@/shared/ui/button";

const NEXT_STATUS: Record<string, string | null> = {
  open: "in_progress",
  in_progress: null,
  blocked: "in_progress",
  closed: null,
};

interface KanbanCardProps {
  ticket: Ticket;
  variant: string;
  onUpdate: (id: string, updates: { status?: string; priority?: string }) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onClick?: (ticket: Ticket) => void;
  isOverlay?: boolean;
}

export function KanbanCard({
  ticket,
  variant,
  onUpdate,
  onClose,
  onClick,
  isOverlay,
}: KanbanCardProps) {
  const typeInfo = TYPE_CONFIG[ticket.ticket_type] ?? TYPE_CONFIG.task;
  const priorityInfo = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG[2];
  const TypeIcon = typeInfo.icon;

  const isClosed = variant === "closed";
  const isInProgress = variant === "in_progress";

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: isOverlay,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: dnd-kit requires div for drag-and-drop
    <div
      role="button"
      tabIndex={0}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging && onClick) onClick(ticket);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isDragging && onClick) onClick(ticket);
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
      <h4 className={`text-sm font-medium leading-snug ${isClosed ? "text-muted-foreground" : ""}`}>
        {ticket.title}
      </h4>
      {ticket.description && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${typeInfo.bg} ${typeInfo.color}`}
        >
          <TypeIcon className="w-3 h-3" />
          {ticket.ticket_type}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityInfo.bg} ${priorityInfo.color}`}
        >
          {priorityInfo.label}
        </span>
        {!isClosed && (
          <div className="ml-auto flex gap-1">
            {NEXT_STATUS[ticket.status] && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(ticket.id, { status: NEXT_STATUS[ticket.status]! });
                }}
              >
                {NEXT_STATUS[ticket.status]?.replace("_", " ")} →
              </Button>
            )}
            {ticket.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(ticket.id);
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
