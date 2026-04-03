import { memo } from "react";
import { PRIORITY_CONFIG, TYPE_CONFIG } from "@/features/tickets/constants";
import type { Ticket, TicketPhase } from "@/shared/types";

interface KanbanCardProps {
  ticket: Ticket;
  variant: TicketPhase;
  onClick?: (ticket: Ticket) => void;
}

export const KanbanCard = memo(
  function KanbanCard({ ticket, variant, onClick }: KanbanCardProps) {
    const typeInfo = TYPE_CONFIG[ticket.ticket_type] ?? TYPE_CONFIG.task;
    const priorityInfo = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG[2];
    const TypeIcon = typeInfo.icon;

    const isDone = variant === "done";

    return (
      // biome-ignore lint/a11y/useSemanticElements: card acts as clickable navigation element
      <div
        role="button"
        tabIndex={0}
        aria-label={ticket.title}
        onClick={() => onClick?.(ticket)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && onClick) onClick(ticket);
        }}
        className={`rounded-lg border p-3.5 shadow-sm transition-colors cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 ${
          isDone ? "bg-zinc-50 dark:bg-zinc-800/50 opacity-85" : "bg-white dark:bg-zinc-800"
        }`}
      >
        <h4
          className={`text-sm font-medium leading-snug line-clamp-2 ${isDone ? "text-muted-foreground" : ""}`}
        >
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
          {ticket.status === "blocked" && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-600">
              blocked
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.ticket.id === next.ticket.id &&
      prev.ticket.title === next.ticket.title &&
      prev.ticket.status === next.ticket.status &&
      prev.ticket.priority === next.ticket.priority &&
      prev.ticket.ticket_type === next.ticket.ticket_type &&
      prev.variant === next.variant
    );
  },
);
