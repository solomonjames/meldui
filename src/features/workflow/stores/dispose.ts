import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";

/**
 * Dispose all per-ticket stores for a given ticket.
 * Call when a ticket is unloaded or workflow completes.
 */
export function disposeTicketStores(ticketId: string) {
  streamingStoreFactory.disposeStore(ticketId);
  orchestrationStoreFactory.disposeStore(ticketId);
  permissionsStoreFactory.disposeStore(ticketId);
  notificationsStoreFactory.disposeStore(ticketId);
  reviewStoreFactory.disposeStore(ticketId);
}
