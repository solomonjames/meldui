import { describe, it, expect, beforeEach } from "vitest";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";

describe("permissionsStore", () => {
  beforeEach(() => {
    permissionsStoreFactory.disposeStore("ticket-1");
  });

  it("initializes with no pending permission", () => {
    const store = permissionsStoreFactory.getStore("ticket-1");
    expect(store.getState().pendingPermission).toBeNull();
  });

  it("setPendingPermission sets the permission", () => {
    const store = permissionsStoreFactory.getStore("ticket-1");
    store.getState().setPendingPermission({
      request_id: "perm-1",
      tool_name: "Bash",
      input: { command: "rm -rf" },
    });
    expect(store.getState().pendingPermission).toEqual({
      request_id: "perm-1",
      tool_name: "Bash",
      input: { command: "rm -rf" },
    });
  });

  it("clearPendingPermission clears the permission", () => {
    const store = permissionsStoreFactory.getStore("ticket-1");
    store.getState().setPendingPermission({
      request_id: "perm-1",
      tool_name: "Bash",
      input: {},
    });
    store.getState().clearPendingPermission();
    expect(store.getState().pendingPermission).toBeNull();
  });
});
