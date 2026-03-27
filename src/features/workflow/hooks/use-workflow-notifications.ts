import { useCallback, useState } from "react";
import { events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { NotificationEvent } from "@/shared/types";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
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

  const notificationsReady = sectionReady && notificationReady;

  const clearNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { notifications, clearNotification, lastUpdatedSectionId, notificationsReady };
}
