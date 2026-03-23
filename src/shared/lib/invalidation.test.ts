import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { createTestQueryClient, createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import { useTauriEventInvalidation } from "@/shared/lib/invalidation";
import type { QueryClient } from "@tanstack/react-query";

describe("useTauriEventInvalidation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    clearTauriMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderInvalidationHook(projectDir = "/test/project") {
    const wrapper = createQueryWrapper(queryClient);
    return renderHook(() => useTauriEventInvalidation(projectDir), {
      wrapper,
    });
  }

  async function waitForListeners() {
    // Let the mock listen promises resolve
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }

  it("debounces rapid subtask events into a single invalidation", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderInvalidationHook();
    await waitForListeners();

    // Fire 3 subtask events rapidly
    act(() => {
      emitTauriEvent("subtask-created", {});
      emitTauriEvent("subtask-updated", {});
      emitTauriEvent("subtask-closed", {});
    });

    // No invalidation yet (debounce pending)
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Advance past the 100ms debounce window
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Should have exactly 1 invalidation call for tickets.all
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["tickets", "all", "/test/project"],
    });
  });

  it("section update triggers targeted ticket detail invalidation", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderInvalidationHook();
    await waitForListeners();

    act(() => {
      emitTauriEvent("section-update-event", {
        ticket_id: "TICKET-42",
        section: "description",
        content: "updated",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["tickets", "detail", "/test/project", "TICKET-42"],
    });
  });

  it("step complete triggers workflow state invalidation", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderInvalidationHook();
    await waitForListeners();

    act(() => {
      emitTauriEvent("step-complete-event", {
        ticket_id: "TICKET-99",
        summary: "Step done",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["workflows", "state", "/test/project", "TICKET-99"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["conversations", "/test/project", "TICKET-99"],
    });
  });
});
