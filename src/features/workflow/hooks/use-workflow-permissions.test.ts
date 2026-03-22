import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockInvoke, clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useWorkflowPermissions } from "@/features/workflow/hooks/use-workflow-permissions";

describe("useWorkflowPermissions", () => {
  const setError = vi.fn();

  beforeEach(() => {
    clearTauriMocks();
    setError.mockReset();
  });

  it("permissionsReady becomes true after mount", async () => {
    const { result } = renderHook(() => useWorkflowPermissions("issue-1", setError));

    await waitFor(() => {
      expect(result.current.permissionsReady).toBe(true);
    });
  });

  it("sets pendingPermission when event fires", async () => {
    const { result } = renderHook(() => useWorkflowPermissions("issue-1", setError));

    await waitFor(() => expect(result.current.permissionsReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-permission-request", {
        request_id: "perm-1",
        tool_name: "Bash",
        input: { command: "rm -rf" },
      });
    });

    await waitFor(() => {
      expect(result.current.pendingPermission).not.toBeNull();
      expect(result.current.pendingPermission?.request_id).toBe("perm-1");
    });
  });

  it("respondToPermission clears pendingPermission on success", async () => {
    const { result } = renderHook(() => useWorkflowPermissions("issue-1", setError));

    await waitFor(() => expect(result.current.permissionsReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-permission-request", {
        request_id: "perm-1",
        tool_name: "Bash",
        input: {},
      });
    });

    await waitFor(() => expect(result.current.pendingPermission).not.toBeNull());

    mockInvoke.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.respondToPermission("perm-1", true);
    });

    expect(result.current.pendingPermission).toBeNull();
  });

  it("respondToPermission handles broken pipe error", async () => {
    const { result } = renderHook(() => useWorkflowPermissions("issue-1", setError));

    await waitFor(() => expect(result.current.permissionsReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-permission-request", {
        request_id: "perm-1",
        tool_name: "Bash",
        input: {},
      });
    });

    await waitFor(() => expect(result.current.pendingPermission).not.toBeNull());

    mockInvoke.mockRejectedValueOnce(
      new Error("Failed to write to sidecar stdin: Broken pipe (os error 32)"),
    );

    await act(async () => {
      await result.current.respondToPermission("perm-1", true);
    });

    expect(result.current.pendingPermission).toBeNull();
    expect(setError).toHaveBeenCalledWith(
      "Agent session expired. Click Resume to continue where you left off.",
    );
  });

  it("clearPending sets pendingPermission to null", async () => {
    const { result } = renderHook(() => useWorkflowPermissions("issue-1", setError));

    await waitFor(() => expect(result.current.permissionsReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-permission-request", {
        request_id: "perm-1",
        tool_name: "Bash",
        input: {},
      });
    });

    await waitFor(() => expect(result.current.pendingPermission).not.toBeNull());

    act(() => {
      result.current.clearPending();
    });

    expect(result.current.pendingPermission).toBeNull();
  });
});
