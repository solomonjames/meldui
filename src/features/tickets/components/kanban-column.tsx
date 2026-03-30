import { KanbanCard } from "@/features/tickets/components/kanban-card";
import type { Ticket, TicketPhase } from "@/shared/types";
import { PHASE_CONFIG } from "@/shared/types";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";

interface KanbanColumnProps {
  title: string;
  variant: TicketPhase;
  count: number;
  tickets: Ticket[];
  onCardClick?: (ticket: Ticket) => void;
}

export function KanbanColumn({ title, variant, count, tickets, onCardClick }: KanbanColumnProps) {
  const config = PHASE_CONFIG[variant] ?? PHASE_CONFIG.backlog;
  const Icon = config.icon;

  return (
    <div className="flex flex-col min-w-0 min-h-0 h-full rounded-lg">
      <div className="flex items-center gap-2 pb-3">
        <Icon className={`w-4 h-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className={`text-[11px] px-1.5 py-0 ${config.badgeBg}`}>
          {count}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 pr-2">
          {tickets.map((ticket) => (
            <KanbanCard key={ticket.id} ticket={ticket} variant={variant} onClick={onCardClick} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
