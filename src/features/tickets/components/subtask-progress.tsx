import { X } from "lucide-react";
import { STATUS_CONFIG } from "@/features/tickets/constants";
import type { Ticket } from "@/shared/types";

interface SubtaskProgressProps {
  subTickets: Ticket[];
  onSubTicketClick?: (ticket: Ticket) => void;
  onRemoveSubTicket?: (id: string) => void;
}

export function SubtaskProgress({
  subTickets,
  onSubTicketClick,
  onRemoveSubTicket,
}: SubtaskProgressProps) {
  const total = subTickets.length;
  const closed = subTickets.filter((t) => t.status === "closed").length;
  const pct = total > 0 ? (closed / total) * 100 : 0;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Sub-tickets ({closed}/{total})
      </h3>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div
          className={`h-full w-full rounded-full transition-transform duration-300 origin-left ${
            closed === total && total > 0
              ? "bg-emerald-500"
              : closed > 0
                ? "bg-emerald-500"
                : "bg-zinc-200 dark:bg-zinc-800"
          }`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>

      {/* Sub-ticket list */}
      <div className="space-y-1">
        {subTickets.map((sub) => {
          const subStatus = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.open;
          return (
            <div
              key={sub.id}
              className="group w-full flex items-center gap-2.5 rounded-lg border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <button
                type="button"
                onClick={() => onSubTicketClick?.(sub)}
                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${subStatus.dot}`} />
                <span className="text-sm font-medium truncate flex-1">{sub.title}</span>
              </button>
              {onRemoveSubTicket && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSubTicket(sub.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-muted-foreground hover:text-red-500 transition-[opacity,color]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
