import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import { ticketKeys } from "@/shared/lib/query-keys";

/**
 * Centralized Tauri event → TanStack Query invalidation.
 * Install once in App.tsx.
 *
 * Uses `useTauriEvent` for safe async listener lifecycle (no race condition
 * on cleanup) and debounces subtask events so rapid-fire creates/updates
 * collapse into a single cache invalidation.
 */
export function useTauriEventInvalidation(projectDir: string) {
  const queryClient = useQueryClient();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const debouncedInvalidateAll = useCallback(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    }, 100);
  }, [queryClient, projectDir]);

  // Subtask events -> debounced full ticket list refetch
  useTauriEvent(events.subtaskCreated, debouncedInvalidateAll);
  useTauriEvent(events.subtaskUpdated, debouncedInvalidateAll);
  useTauriEvent(events.subtaskClosed, debouncedInvalidateAll);

  // Section update -> targeted ticket detail refetch
  useTauriEvent(events.sectionUpdateEvent, (payload) => {
    if (payload.ticket_id) {
      queryClient.invalidateQueries({
        queryKey: ticketKeys.detail(projectDir, payload.ticket_id),
      });
    }
  });

  // Step complete -> targeted workflow state refetch
  useTauriEvent(events.stepCompleteEvent, (payload) => {
    if (payload.ticket_id) {
      queryClient.invalidateQueries({
        queryKey: ["workflows", "state", projectDir, payload.ticket_id],
      });
    }
  });
}
