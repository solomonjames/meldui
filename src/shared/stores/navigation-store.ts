import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type ActivePage = "backlog" | "ticket" | "settings";

export interface NavigationState {
  activePage: ActivePage;
  activeTicketId: string | null;
  createDialogOpen: boolean;
  navigateToTicket: (ticketId: string) => void;
  navigateToBacklog: () => void;
  navigateToSettings: () => void;
  setCreateDialogOpen: (open: boolean) => void;
}

export const navigationStore = createStore<NavigationState>()((set) => ({
  activePage: "backlog",
  activeTicketId: null,
  createDialogOpen: false,
  navigateToTicket: (ticketId: string) => set({ activePage: "ticket", activeTicketId: ticketId }),
  navigateToBacklog: () => set({ activePage: "backlog", activeTicketId: null }),
  navigateToSettings: () => set({ activePage: "settings" }),
  setCreateDialogOpen: (open: boolean) => set({ createDialogOpen: open }),
}));

export function useNavigationStore<R>(selector: (s: NavigationState) => R): R {
  return useStore(navigationStore, selector);
}
