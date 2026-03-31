import { useCallback, useRef } from "react";
import { events } from "@/bindings";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

// Stable ID used when no ticket is active — ensures hooks are called unconditionally
const EMPTY_TICKET = "__none__";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  // Track last active ticket so notifications aren't dropped during navigation transitions
  const lastActiveTicketRef = useRef(activeTicketId);
  if (activeTicketId) {
    lastActiveTicketRef.current = activeTicketId;
  }

  const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
    const store = notificationsStoreFactory.getStore(payload.ticket_id);
    store.getState().setLastUpdatedSectionId(payload.section_id ?? payload.section);
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      onRefreshTicketRef.current?.();
    }
  });

  const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
    // Notifications don't carry a ticket_id, so route to active or last-active ticket.
    const targetTicket = activeTicketId ?? lastActiveTicketRef.current;
    if (targetTicket) {
      notificationsStoreFactory.getStore(targetTicket).getState().addNotification(payload);
    }
  });

  const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
    const store = notificationsStoreFactory.getStore(payload.ticket_id);
    store.getState().setStatusText(payload.status_text);
  });

  const notificationsReady = sectionReady && notificationReady && statusReady;

  // Reactive store subscriptions (always called — rules of hooks)
  const storeId = activeTicketId ?? EMPTY_TICKET;
  const notifications = notificationsStoreFactory.useTicketStore(storeId, (s) => s.notifications);
  const statusText = notificationsStoreFactory.useTicketStore(storeId, (s) => s.statusText);
  const lastUpdatedSectionId = notificationsStoreFactory.useTicketStore(
    storeId,
    (s) => s.lastUpdatedSectionId,
  );

  const clearNotification = useCallback(
    (index: number) => {
      if (activeTicketId) {
        notificationsStoreFactory.getStore(activeTicketId).getState().clearNotification(index);
      }
    },
    [activeTicketId],
  );

  return {
    notifications: activeTicketId ? notifications : [],
    clearNotification,
    lastUpdatedSectionId: activeTicketId ? lastUpdatedSectionId : null,
    statusText: activeTicketId ? statusText : null,
    notificationsReady,
  };
}
