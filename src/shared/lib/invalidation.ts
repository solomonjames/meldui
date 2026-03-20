import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { ticketKeys } from "@/shared/lib/query-keys";
import type { SectionUpdateEvent, StepCompleteEvent } from "@/shared/types";

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
    const subtaskEvents = [
      "meldui-subtask-created",
      "meldui-subtask-updated",
      "meldui-subtask-closed",
    ];

    for (const event of subtaskEvents) {
      listen(event, () => {
        queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
      }).then((unlisten) => unlisteners.push(unlisten));
    }

    // Section update → invalidate specific ticket detail
    listen<SectionUpdateEvent>("meldui-section-update", (event) => {
      const ticketId = event.payload.ticket_id;
      if (ticketId) {
        queryClient.invalidateQueries({
          queryKey: ticketKeys.detail(projectDir, ticketId),
        });
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    // Step complete → invalidate workflow state
    listen<StepCompleteEvent>("meldui-step-complete", (event) => {
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
