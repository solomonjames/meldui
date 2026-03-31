import { useCallback } from "react";
import { commands, events } from "@/bindings";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

// Stable ID used when no ticket is active — ensures hooks are called unconditionally
const EMPTY_TICKET = "__none__";

export function useWorkflowPermissions(
  activeTicketId: string | null,
  setError: (issueId: string, msg: string) => void,
) {
  const permissionsReady = useTauriEvent(events.agentPermissionRequest, (payload) => {
    const { issue_id, request_id, tool_name, input } = payload;
    const store = permissionsStoreFactory.getStore(issue_id);
    store.getState().setPendingPermission({
      request_id,
      tool_name,
      input: input as Record<string, unknown>,
    });
  });

  // Reactive store subscription (always called — rules of hooks)
  const storeId = activeTicketId ?? EMPTY_TICKET;
  const pendingPermission = permissionsStoreFactory.useTicketStore(
    storeId,
    (s) => s.pendingPermission,
  );

  const respondToPermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      if (!activeTicketId) return;
      const store = permissionsStoreFactory.getStore(activeTicketId);
      const pending = store.getState().pendingPermission;
      if (!pending || pending.request_id !== requestId) return;

      try {
        await commands.agentPermissionRespond(activeTicketId, requestId, allowed);
        store.getState().clearPendingPermission();
      } catch (err) {
        store.getState().clearPendingPermission();
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError(
            activeTicketId,
            "Agent session expired. Click Resume to continue where you left off.",
          );
        } else {
          setError(activeTicketId, `Failed to respond to permission: ${err}`);
        }
      }
    },
    [activeTicketId, setError],
  );

  const clearPending = useCallback((issueId: string) => {
    permissionsStoreFactory.getStore(issueId).getState().clearPendingPermission();
  }, []);

  return {
    pendingPermission: activeTicketId ? pendingPermission : null,
    respondToPermission,
    permissionsReady,
    clearPending,
  };
}
