import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type { PermissionRequest } from "@/shared/types";

export interface PermissionsState {
  pendingPermission: PermissionRequest | null;
  setPendingPermission: (permission: PermissionRequest) => void;
  clearPendingPermission: () => void;
}

export const permissionsStoreFactory = createTicketStoreFactory<PermissionsState>(
  "permissions",
  (set) => ({
    pendingPermission: null,
    setPendingPermission: (permission) => set({ pendingPermission: permission }),
    clearPendingPermission: () => set({ pendingPermission: null }),
  }),
);
