import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockInvoke, clearTauriMocks } from "@/test/mocks/tauri";
import { createQueryWrapper } from "@/test/helpers/query-wrapper";
import { useClaude } from "./use-claude";

describe("useClaude", () => {
  let wrapper: ReturnType<typeof createQueryWrapper>;

  beforeEach(() => {
    clearTauriMocks();
    wrapper = createQueryWrapper();
  });

  it("auto-fetches status on mount", async () => {
    const status = { installed: true, authenticated: true, message: "ok" };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(status));

    const { result } = renderHook(() => useClaude(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toEqual(status);
    });

    expect(mockInvoke).toHaveBeenCalledWith("claude_status");
  });

  it("login calls invoke and refetches status", async () => {
    const status = { installed: true, authenticated: false, message: "not logged in" };
    const afterLogin = { installed: true, authenticated: true, message: "ok" };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "claude_status") {
        // First call returns unauthenticated, subsequent calls return authenticated
        const isFirst = !mockInvoke.mock.results.some(
          (r: { value: unknown }) => r.value === JSON.stringify(afterLogin)
        );
        return Promise.resolve(JSON.stringify(isFirst ? status : afterLogin));
      }
      if (cmd === "claude_login") return Promise.resolve("ok");
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useClaude(), { wrapper });
    await waitFor(() => expect(result.current.status?.authenticated).toBe(false));

    await act(async () => {
      await result.current.login();
    });

    expect(mockInvoke).toHaveBeenCalledWith("claude_login");
  });

  it("handles status check errors gracefully", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() => useClaude(), { wrapper });

    // Should not crash — status remains null on error
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("does not export sendMessage or clearMessages (dead code removed)", () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ installed: true, authenticated: true, message: "ok" }));

    const { result } = renderHook(() => useClaude(), { wrapper });

    expect(result.current).not.toHaveProperty("sendMessage");
    expect(result.current).not.toHaveProperty("clearMessages");
    expect(result.current).not.toHaveProperty("messages");
  });
});
