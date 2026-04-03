import { FolderOpen, LayoutGrid, Settings } from "lucide-react";
import { memo, useMemo } from "react";
import { MeldLogo } from "@/shared/components/meld-logo";
import type { Ticket, TicketPhase, WorkflowDefinition } from "@/shared/types";
import { getTicketPhase, PHASE_CONFIG } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";

interface AppSidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  tickets: Ticket[];
  workflows: WorkflowDefinition[];
  onCreateTicket: () => void;
  folderName: string | null;
  onOpenFolder: () => void;
  onTicketClick?: (ticket: Ticket) => void;
  activeTicketId?: string | null;
  runningTicketIds?: Set<string>;
}

const NAV_ITEMS = [
  { id: "backlog", label: "Dashboard", icon: LayoutGrid },
  { id: "settings", label: "Settings", icon: Settings },
];

const ACTIVE_PHASES = new Set<TicketPhase>(["research", "plan", "implementation", "review"]);

export function AppSidebar({
  activePage,
  onNavigate,
  tickets,
  workflows,
  onCreateTicket,
  folderName,
  onOpenFolder,
  onTicketClick,
  activeTicketId,
  runningTicketIds,
}: AppSidebarProps) {
  const activeTickets = useMemo(() => {
    const result: { ticket: Ticket; phase: TicketPhase }[] = [];
    for (const ticket of tickets) {
      if (ticket.parent_id) continue;
      const phase = getTicketPhase(ticket, workflows);
      if (ACTIVE_PHASES.has(phase)) {
        result.push({ ticket, phase });
      }
    }
    return result;
  }, [tickets, workflows]);

  return (
    <div className="w-52 shrink-0 bg-zinc-50 dark:bg-zinc-900 border-r flex flex-col">
      {/* Logo */}
      <div className="p-6 pb-0">
        <div className="flex items-center gap-2">
          <MeldLogo className="w-5 h-5" />
          <span className="font-semibold text-base">Meld</span>
        </div>
      </div>

      {/* Project indicator */}
      <div className="px-6 pt-4">
        <button
          type="button"
          onClick={onOpenFolder}
          className="w-full flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <FolderOpen className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate">
            {folderName ?? "Open project..."}
          </span>
        </button>
      </div>

      {/* Create button */}
      <div className="px-6 pt-4">
        <Button
          onClick={onCreateTicket}
          className="w-full bg-emerald hover:bg-emerald/90 text-white"
        >
          Create Ticket
          <kbd className="ml-auto text-[10px] bg-white/20 rounded px-1.5 py-0.5 font-mono">C</kbd>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="px-3 pt-6">
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-white dark:bg-zinc-800 text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-6 pt-6">
        <Separator />
      </div>

      {/* Active Tickets */}
      <div className="flex-1 flex flex-col overflow-hidden pt-4">
        <div className="px-6 pb-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Active Tickets
          </span>
        </div>
        <ScrollArea className="flex-1 px-3">
          {activeTickets.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">No active tickets</p>
          ) : (
            activeTickets.map(({ ticket, phase }) => (
              <SidebarTicketItem
                key={ticket.id}
                ticket={ticket}
                phase={phase}
                isSelected={activeTicketId === ticket.id}
                isRunning={runningTicketIds?.has(ticket.id) ?? false}
                onTicketClick={onTicketClick}
              />
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

interface SidebarTicketItemProps {
  ticket: Ticket;
  phase: TicketPhase;
  isSelected: boolean;
  isRunning: boolean;
  onTicketClick?: (ticket: Ticket) => void;
}

const SidebarTicketItem = memo(function SidebarTicketItem({
  ticket,
  phase,
  isSelected,
  isRunning,
  onTicketClick,
}: SidebarTicketItemProps) {
  const phaseConfig = PHASE_CONFIG[phase];
  return (
    <button
      type="button"
      onClick={() => onTicketClick?.(ticket)}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
        isSelected
          ? "bg-zinc-100 dark:bg-zinc-800 border-l-2 border-emerald"
          : "hover:bg-white/50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-mono shrink-0 ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}
        >
          {ticket.id.slice(0, 12)}
        </span>
        {isRunning ? (
          <span className="inline-flex rounded-full h-2 w-2 shrink-0 bg-emerald animate-pulse" />
        ) : (
          <span
            className={`inline-flex items-center rounded-full text-[10px] px-1.5 py-0.5 font-medium ${phaseConfig.badgeBg}`}
          >
            {phaseConfig.label}
          </span>
        )}
      </div>
      <p className={`text-xs mt-0.5 truncate ${isSelected ? "text-foreground" : ""}`}>
        {ticket.title}
      </p>
    </button>
  );
});
