import { useCallback } from "react";
import { commands, events } from "@/bindings";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

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

  const pendingPermission = activeTicketId
    ? permissionsStoreFactory.getStore(activeTicketId).getState().pendingPermission
    : null;

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
    pendingPermission,
    pendingPermissions: {} as Record<string, never>, // Deprecated — kept for backward compat
    respondToPermission,
    permissionsReady,
    clearPending,
  };
}
