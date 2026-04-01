import { useRef } from "react";
import { events } from "@/bindings";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { ReviewFinding } from "@/shared/types";

/**
 * Sets up all Tauri event listeners and routes payloads to per-ticket stores.
 * No reactive subscriptions — components read from stores directly.
 */
export function useWorkflowEventRouting(
  activeTicketId: string | null,
  onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
  // Track last active ticket so notifications aren't dropped during navigation transitions
  const lastActiveTicketRef = useRef(activeTicketId);
  if (activeTicketId) {
    lastActiveTicketRef.current = activeTicketId;
  }

  // ── Permission events ──
  const permissionsReady = useTauriEvent(events.agentPermissionRequest, (payload) => {
    const { issue_id, request_id, tool_name, input } = payload;
    permissionsStoreFactory
      .getStore(issue_id)
      .getState()
      .setPendingPermission({
        request_id,
        tool_name,
        input: input as Record<string, unknown>,
      });
  });

  // ── Notification events ──
  const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
    notificationsStoreFactory
      .getStore(payload.ticket_id)
      .getState()
      .setLastUpdatedSectionId(payload.section_id ?? payload.section);
    if (activeTicketId && payload.ticket_id === activeTicketId) {
      onRefreshTicketRef.current?.();
    }
  });

  const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
    const targetTicket = activeTicketId ?? lastActiveTicketRef.current;
    if (targetTicket) {
      notificationsStoreFactory.getStore(targetTicket).getState().addNotification(payload);
    }
  });

  const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
    notificationsStoreFactory
      .getStore(payload.ticket_id)
      .getState()
      .setStatusText(payload.status_text);
  });

  // ── Review events ──
  const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
    reviewStoreFactory
      .getStore(payload.ticket_id)
      .getState()
      .setFindings(payload.findings as ReviewFinding[], payload.request_id);
  });

  return {
    allListenersReady:
      permissionsReady && sectionReady && notificationReady && statusReady && reviewReady,
  };
}
