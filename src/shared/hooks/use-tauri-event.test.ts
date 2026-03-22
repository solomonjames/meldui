import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

// Simulate a tauri-specta event object
function makeMockEvent<T>(eventName: string) {
  return {
    listen: (cb: (e: { payload: T }) => void) =>
      import("@tauri-apps/api/event").then((mod) =>
        mod.listen(eventName, cb as (e: { payload: unknown }) => void)
      ),
  };
}

describe("useTauriEvent", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("returns isReady=true after listener is attached", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<string>("test-event");
    const { result } = renderHook(() => useTauriEvent(event, handler));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("calls handler when event is emitted", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<{ value: string }>("test-event");
    const { result } = renderHook(() => useTauriEvent(event, handler));

    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      emitTauriEvent("test-event", { value: "hello" });
    });

    expect(handler).toHaveBeenCalledWith({ value: "hello" });
  });

  it("always calls the latest handler (no stale closure)", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const event = makeMockEvent<string>("test-event");

    const { result, rerender } = renderHook(
      ({ handler }) => useTauriEvent(event, handler),
      { initialProps: { handler: handler1 } }
    );

    await waitFor(() => expect(result.current).toBe(true));

    // Swap handler
    rerender({ handler: handler2 });

    act(() => {
      emitTauriEvent("test-event", "payload");
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith("payload");
  });

  it("cleans up listener on unmount", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<string>("test-event");
    const { result, unmount } = renderHook(() =>
      useTauriEvent(event, handler)
    );

    await waitFor(() => expect(result.current).toBe(true));

    unmount();

    act(() => {
      emitTauriEvent("test-event", "after-unmount");
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
