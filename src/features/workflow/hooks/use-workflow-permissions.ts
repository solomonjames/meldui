import { useCallback, useState } from "react";
import { commands, events } from "@/bindings";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";
import type { PermissionRequest } from "@/shared/types";

export function useWorkflowPermissions(
  activeTicketId: string | null,
  setError: (issueId: string, msg: string) => void,
) {
  const [pendingPermissions, setPendingPermissions] = useState<
    Record<string, PermissionRequest & { issueId: string }>
  >({});

  const permissionsReady = useTauriEvent(events.agentPermissionRequest, (payload) => {
    const { issue_id, request_id, tool_name, input } = payload;
    setPendingPermissions((prev) => ({
      ...prev,
      [issue_id]: {
        issueId: issue_id,
        request_id,
        tool_name,
        input: input as Record<string, unknown>,
      },
    }));
  });

  // Convenience: the viewed ticket's pending permission
  const pendingPermission = activeTicketId ? (pendingPermissions[activeTicketId] ?? null) : null;

  const respondToPermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      // Find which issue this request belongs to
      const entry = Object.values(pendingPermissions).find((p) => p.request_id === requestId);
      if (!entry) return;
      try {
        await commands.agentPermissionRespond(entry.issueId, requestId, allowed);
        setPendingPermissions((prev) => {
          const next = { ...prev };
          delete next[entry.issueId];
          return next;
        });
      } catch (err) {
        setPendingPermissions((prev) => {
          const next = { ...prev };
          delete next[entry.issueId];
          return next;
        });
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError(
            entry.issueId,
            "Agent session expired. Click Resume to continue where you left off.",
          );
        } else {
          setError(entry.issueId, `Failed to respond to permission: ${err}`);
        }
      }
    },
    [pendingPermissions, setError],
  );

  const clearPending = useCallback((issueId: string) => {
    setPendingPermissions((prev) => {
      const next = { ...prev };
      delete next[issueId];
      return next;
    });
  }, []);

  return {
    pendingPermission,
    pendingPermissions,
    respondToPermission,
    permissionsReady,
    clearPending,
  };
}
