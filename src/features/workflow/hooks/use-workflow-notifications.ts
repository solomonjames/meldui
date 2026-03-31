import { useCallback } from "react";
import { events } from "@/bindings";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
    const store = notificationsStoreFactory.getStore(payload.ticket_id);
    store.getState().setLastUpdatedSectionId(payload.section_id ?? payload.section);
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      onRefreshTicketRef.current?.();
    }
  });

  const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
    // Notifications are global (not per-ticket), but we store on active ticket if available.
    // For backward compat, we keep a flat list approach.
    if (activeTicketId) {
      notificationsStoreFactory.getStore(activeTicketId).getState().addNotification(payload);
    }
  });

  const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
    const store = notificationsStoreFactory.getStore(payload.ticket_id);
    store.getState().setStatusText(payload.status_text);
  });

  const notificationsReady = sectionReady && notificationReady && statusReady;

  const notifications = activeTicketId
    ? notificationsStoreFactory.getStore(activeTicketId).getState().notifications
    : [];

  const statusText = activeTicketId
    ? notificationsStoreFactory.getStore(activeTicketId).getState().statusText
    : null;

  const lastUpdatedSectionId = activeTicketId
    ? notificationsStoreFactory.getStore(activeTicketId).getState().lastUpdatedSectionId
    : null;

  const clearNotification = useCallback(
    (index: number) => {
      if (activeTicketId) {
        notificationsStoreFactory.getStore(activeTicketId).getState().clearNotification(index);
      }
    },
    [activeTicketId],
  );

  return { notifications, clearNotification, lastUpdatedSectionId, statusText, notificationsReady };
}
