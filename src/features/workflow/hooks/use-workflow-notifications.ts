import { useCallback, useState } from "react";
import { events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { NotificationEvent } from "@/shared/types";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastUpdatedSectionId, setLastUpdatedSectionId] = useState<string | null>(null);

  const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
    // Trigger ticket refresh so the ticket context panel updates live
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      setLastUpdatedSectionId(payload.section_id ?? payload.section);
      onRefreshTicketRef.current?.();
    }
  });

  const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
    setNotifications((prev) => [...prev, payload]);
  });

  const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      setStatusText(payload.status_text);
    }
  });

  const notificationsReady = sectionReady && notificationReady && statusReady;

  const clearNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { notifications, clearNotification, statusText, lastUpdatedSectionId, notificationsReady };
}
