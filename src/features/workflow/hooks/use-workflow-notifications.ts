import { useCallback, useState } from "react";
import { events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { NotificationEvent } from "@/shared/types";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [statusTextMap, setStatusTextMap] = useState<Record<string, string>>({});
  const [lastUpdatedSectionMap, setLastUpdatedSectionMap] = useState<Record<string, string>>({});

  const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
    // Store for all tickets, not just active
    setLastUpdatedSectionMap((prev) => ({
      ...prev,
      [payload.ticket_id]: payload.section_id ?? payload.section,
    }));
    // Trigger refresh if this is the viewed ticket
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      onRefreshTicketRef.current?.();
    }
  });

  const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
    setNotifications((prev) => [...prev, payload]);
  });

  const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
    // Store for all tickets
    setStatusTextMap((prev) => ({
      ...prev,
      [payload.ticket_id]: payload.status_text,
    }));
  });

  const notificationsReady = sectionReady && notificationReady && statusReady;

  // Convenience: viewed ticket's state
  const statusText = activeTicketId ? (statusTextMap[activeTicketId] ?? null) : null;
  const lastUpdatedSectionId = activeTicketId
    ? (lastUpdatedSectionMap[activeTicketId] ?? null)
    : null;

  const clearNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { notifications, clearNotification, lastUpdatedSectionId, statusText, notificationsReady };
}
