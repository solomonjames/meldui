import { useState, useCallback } from "react";
import { commands, events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { PermissionRequest } from "@/shared/types";

export function useWorkflowPermissions(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);

  const permissionsReady = useTauriEvent(events.agentPermissionRequest, (payload) => {
    const { request_id, tool_name, input } = payload;
    setPendingPermission({
      request_id,
      tool_name,
      input: input as Record<string, unknown>,
    });
  });

  const respondToPermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      try {
        await commands.agentPermissionRespond(requestId, allowed);
        setPendingPermission(null);
      } catch (err) {
        setPendingPermission(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to respond to permission: ${err}`);
        }
      }
    },
    [setError]
  );

  const clearPending = useCallback(() => {
    setPendingPermission(null);
  }, []);

  return { pendingPermission, respondToPermission, permissionsReady, clearPending };
}
