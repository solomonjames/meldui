import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockInvoke, clearTauriMocks } from "@/shared/test/mocks/tauri";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import { useSettings } from "@/features/settings/hooks/use-settings";

describe("useSettings", () => {
  let wrapper: ReturnType<typeof createQueryWrapper>;

  beforeEach(() => {
    clearTauriMocks();
    wrapper = createQueryWrapper();
  });

  it("auto-fetches settings on mount", async () => {
    const settings = { sync: { enabled: false, provider: "", auto_push: false, config: {} } };
    mockInvoke.mockResolvedValueOnce(settings);

    const { result } = renderHook(() => useSettings("/project"), { wrapper });

    await waitFor(() => {
      expect(result.current.settings).toEqual(settings);
    });

    expect(mockInvoke).toHaveBeenCalledWith("settings_get", { projectDir: "/project" });
  });

  it("updateSettings calls invoke and invalidates", async () => {
    const original = { sync: { enabled: false, provider: "", auto_push: false, config: {} } };
    const updated = { sync: { enabled: true, provider: "linear", auto_push: true, config: {} } };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "settings_get") return Promise.resolve(original);
      if (cmd === "settings_update") return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useSettings("/project"), { wrapper });
    await waitFor(() => expect(result.current.settings).toEqual(original));

    await act(async () => {
      await result.current.updateSettings(updated);
    });

    expect(mockInvoke).toHaveBeenCalledWith("settings_update", {
      projectDir: "/project",
      settings: updated,
    });
  });

  it("loadSettings returns cached data", async () => {
    const settings = { worktree: { setup_command: "bun install" } };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "settings_get") return Promise.resolve(settings);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useSettings("/project"), { wrapper });
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    let loaded: unknown;
    await act(async () => {
      loaded = await result.current.loadSettings();
    });

    expect(loaded).toEqual(settings);
  });
});
