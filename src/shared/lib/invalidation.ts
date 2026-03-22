import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "@/bindings";
import { ticketKeys } from "@/shared/lib/query-keys";

/**
 * Centralized Tauri event → TanStack Query invalidation.
 * Install once in App.tsx.
 */
export function useTauriEventInvalidation(projectDir: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectDir) return;

    const unlisteners: Array<() => void> = [];

    // Subtask events → invalidate ticket list
    events.subtaskCreated.listen(() => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    }).then((unlisten) => unlisteners.push(unlisten));

    events.subtaskUpdated.listen(() => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    }).then((unlisten) => unlisteners.push(unlisten));

    events.subtaskClosed.listen(() => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    }).then((unlisten) => unlisteners.push(unlisten));

    // Section update → invalidate specific ticket detail
    events.sectionUpdateEvent.listen((event) => {
      const ticketId = event.payload.ticket_id;
      if (ticketId) {
        queryClient.invalidateQueries({
          queryKey: ticketKeys.detail(projectDir, ticketId),
        });
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    // Step complete → invalidate workflow state
    events.stepCompleteEvent.listen((event) => {
      const ticketId = event.payload.ticket_id;
      if (ticketId) {
        queryClient.invalidateQueries({
          queryKey: ["workflows", "state", projectDir, ticketId],
        });
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      for (const unlisten of unlisteners) unlisten();
    };
  }, [projectDir, queryClient]);
}
