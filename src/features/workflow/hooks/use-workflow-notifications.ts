import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  NotificationEvent,
  SectionUpdateEvent,
  StepCompleteEvent,
  StatusUpdateEvent,
} from "@/shared/types";

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

      const sectionUnlisten = await listen<SectionUpdateEvent>(
        "meldui-section-update",
        (event) => {
          if (cancelled) return;
          // Trigger ticket refresh so the ticket context panel updates live
          if (activeTicketId && event.payload.ticket_id === activeTicketId) {
            setLastUpdatedSectionId(event.payload.section_id ?? event.payload.section);
            onRefreshTicketRef.current?.();
          }
        }
      );
      unlistens.push(sectionUnlisten);

      const notifyUnlisten = await listen<NotificationEvent>(
        "meldui-notification",
        (event) => {
          if (!cancelled) {
            setNotifications((prev) => [...prev, event.payload]);
          }
        }
      );
      unlistens.push(notifyUnlisten);

      const stepCompleteUnlisten = await listen<StepCompleteEvent>(
        "meldui-step-complete",
        (event) => {
          if (cancelled) return;
          if (activeTicketId && event.payload.ticket_id === activeTicketId) {
            // Refresh workflow state — this triggers re-render and gate/advance logic
            getWorkflowStateRef.current?.(activeTicketId);
          }
        }
      );
      unlistens.push(stepCompleteUnlisten);

      const statusUnlisten = await listen<StatusUpdateEvent>(
        "meldui-status-update",
        (event) => {
          if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
            setStatusText(event.payload.status_text);
          }
        }
      );
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
