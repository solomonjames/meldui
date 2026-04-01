import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type { NotificationEvent } from "@/shared/types";

export interface NotificationsState {
  notifications: NotificationEvent[];
  statusText: string | null;
  lastUpdatedSectionId: string | null;
  addNotification: (notification: NotificationEvent) => void;
  clearNotification: (index: number) => void;
  setStatusText: (text: string) => void;
  setLastUpdatedSectionId: (sectionId: string) => void;
}

export const notificationsStoreFactory = createTicketStoreFactory<NotificationsState>(
  "notifications",
  (set) => ({
    notifications: [],
    statusText: null,
    lastUpdatedSectionId: null,
    addNotification: (notification) =>
      set((s) => ({ notifications: [...s.notifications, notification] })),
    clearNotification: (index) =>
      set((s) => ({ notifications: s.notifications.filter((_, i) => i !== index) })),
    setStatusText: (text) => set({ statusText: text }),
    setLastUpdatedSectionId: (sectionId) => set({ lastUpdatedSectionId: sectionId }),
  }),
);
