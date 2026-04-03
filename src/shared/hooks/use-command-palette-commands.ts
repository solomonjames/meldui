import { LayoutGrid, Plus, RefreshCw, Settings } from "lucide-react";
import type { Command } from "@/shared/components/command-palette";

export function useCommandPaletteCommands({
  onCreateTicket,
  onNavigate,
  onRefresh,
}: {
  onCreateTicket: () => void;
  onNavigate: (page: string) => void;
  onRefresh: () => void;
}): Command[] {
  return [
    { id: "create", label: "Create Ticket", icon: Plus, shortcut: "C", action: onCreateTicket },
    {
      id: "dashboard",
      label: "Go to Dashboard",
      icon: LayoutGrid,
      shortcut: "G D",
      action: () => onNavigate("backlog"),
    },
    {
      id: "settings",
      label: "Go to Settings",
      icon: Settings,
      shortcut: "G S",
      action: () => onNavigate("settings"),
    },
    { id: "refresh", label: "Refresh Tickets", icon: RefreshCw, action: onRefresh },
  ];
}
