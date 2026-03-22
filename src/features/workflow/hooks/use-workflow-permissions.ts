import { useState, useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/bindings";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { PermissionRequest } from "@/shared/types";

export function useWorkflowPermissions(
  activeTicketId: string | null,
  setError: (msg: string) => void
) {
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const permissionUnlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mark not-ready before re-subscribing to Tauri events
    setPermissionsReady(false);

    const setup = async () => {
      if (permissionUnlistenRef.current) {
        permissionUnlistenRef.current();
        permissionUnlistenRef.current = null;
      }

      const unlisten = await events.agentPermissionRequest.listen((event) => {
        if (!cancelled) {
          const { request_id, tool_name, input } = event.payload;
          setPendingPermission({
            request_id,
            tool_name,
            input: input as Record<string, unknown>,
          });
        }
      });

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
