import { useState, useCallback, useEffect, useRef } from "react";
import { events } from "@/bindings";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { NotificationEvent } from "@/shared/types";

export function useWorkflowNotifications(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
  getWorkflowStateRef: React.MutableRefObject<((issueId: string) => Promise<unknown>) | null>
) {
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastUpdatedSectionId, setLastUpdatedSectionId] = useState<string | null>(null);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mark not-ready before re-subscribing to Tauri events
    setNotificationsReady(false);

    const setup = async () => {
      // Clean up previous listeners
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      const unlistens: UnlistenFn[] = [];

      const sectionUnlisten = await events.sectionUpdateEvent.listen((event) => {
        if (cancelled) return;
        // Trigger ticket refresh so the ticket context panel updates live
        if (activeTicketId && event.payload.ticket_id === activeTicketId) {
          setLastUpdatedSectionId(event.payload.section_id ?? event.payload.section);
          onRefreshTicketRef.current?.();
        }
      });
      unlistens.push(sectionUnlisten);

      const notifyUnlisten = await events.notificationEvent.listen((event) => {
        if (!cancelled) {
          setNotifications((prev) => [...prev, event.payload]);
        }
      });
      unlistens.push(notifyUnlisten);

      const stepCompleteUnlisten = await events.stepCompleteEvent.listen((event) => {
        if (cancelled) return;
        if (activeTicketId && event.payload.ticket_id === activeTicketId) {
          // Refresh workflow state — this triggers re-render and gate/advance logic
          getWorkflowStateRef.current?.(activeTicketId);
        }
      });
      unlistens.push(stepCompleteUnlisten);

      const statusUnlisten = await events.statusUpdateEvent.listen((event) => {
        if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
          setStatusText(event.payload.status_text);
        }
      });
      unlistens.push(statusUnlisten);

      if (!cancelled) {
        unlistenRefs.current = unlistens;
        setNotificationsReady(true);
      } else {
        unlistens.forEach((fn) => fn());
      }
    };

    setup();

    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];
    };
  }, [activeTicketId]);

  const clearNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { notifications, clearNotification, statusText, lastUpdatedSectionId, notificationsReady };
}
