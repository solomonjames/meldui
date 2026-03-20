import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PermissionRequest } from "@/types";

export function useWorkflowPermissions(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const permissionUnlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPermissionsReady(false);

    const setup = async () => {
      if (permissionUnlistenRef.current) {
        permissionUnlistenRef.current();
        permissionUnlistenRef.current = null;
      }

      const unlisten = await listen<PermissionRequest>(
        "agent-permission-request",
        (event) => {
          if (!cancelled) {
            setPendingPermission(event.payload);
          }
        }
      );

      if (!cancelled) {
        permissionUnlistenRef.current = unlisten;
        setPermissionsReady(true);
      } else {
        unlisten();
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (permissionUnlistenRef.current) {
        permissionUnlistenRef.current();
        permissionUnlistenRef.current = null;
      }
    };
  }, [activeTicketId]);

  const respondToPermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      try {
        await invoke("agent_permission_respond", { requestId, allowed });
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
