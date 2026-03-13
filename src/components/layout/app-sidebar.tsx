import { FolderOpen, Layers, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BeadsIssue } from "@/types";

interface AppSidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  issues: BeadsIssue[];
  onCreateTicket: () => void;
  folderName: string | null;
  onOpenFolder: () => void;
  onTicketClick?: (issue: BeadsIssue) => void;
}

const NAV_ITEMS = [
  { id: "backlog", label: "Backlog", icon: LayoutGrid },
];

export function AppSidebar({
  activePage,
  onNavigate,
  issues,
  onCreateTicket,
  folderName,
  onOpenFolder,
  onTicketClick,
}: AppSidebarProps) {
  const activeTickets = issues.filter((i) => i.status === "in_progress");

  return (
    <div className="w-60 shrink-0 bg-zinc-50 dark:bg-zinc-900 border-r flex flex-col">
      {/* Logo */}
      <div className="p-6 pb-0">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald" />
          <span className="font-semibold text-base">Meld</span>
        </div>
      </div>

      {/* Project indicator */}
      <div className="px-6 pt-4">
        <button
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
          <kbd className="ml-auto text-[10px] bg-white/20 rounded px-1.5 py-0.5 font-mono">
            C
          </kbd>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="px-3 pt-6">
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
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
            <p className="px-3 text-xs text-muted-foreground">
              No active tickets
            </p>
          ) : (
            activeTickets.map((issue) => (
              <button
                key={issue.id}
                onClick={() => onTicketClick?.(issue)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {issue.id.slice(0, 12)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-emerald-muted text-emerald text-[10px] px-1.5 py-0.5 font-medium">
                    in progress
                  </span>
                </div>
                <p className="text-xs mt-0.5 truncate">{issue.title}</p>
              </button>
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
