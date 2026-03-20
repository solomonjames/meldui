import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  mockInvoke,
  clearTauriMocks,
  emitTauriEvent,
} from "@/test/mocks/tauri";
import { useWorkflowFeedback } from "./use-workflow-feedback";

describe("useWorkflowFeedback", () => {
  const setError = vi.fn();

  beforeEach(() => {
    clearTauriMocks();
    setError.mockReset();
  });

  it("feedbackReady becomes true after mount", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => {
      expect(result.current.feedbackReady).toBe(true);
    });
  });

  it("sets pendingFeedback when event fires with matching ticket_id", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-1",
        summary: "Review this",
      });
    });

    await waitFor(() => {
      expect(result.current.pendingFeedback).not.toBeNull();
      expect(result.current.pendingFeedback?.request_id).toBe("fb-1");
    });
  });

  it("ignores feedback events for different ticket_id", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-OTHER",
        summary: "Wrong ticket",
      });
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.pendingFeedback).toBeNull();
  });

  it("respondToFeedback clears pendingFeedback on success", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-1",
        summary: "Review",
      });
    });

    await waitFor(() => expect(result.current.pendingFeedback).not.toBeNull());

    mockInvoke.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.respondToFeedback("fb-1", true);
    });

    expect(result.current.pendingFeedback).toBeNull();
  });

  it("respondToFeedback handles broken pipe error", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-1",
        summary: "Review",
      });
    });

    await waitFor(() => expect(result.current.pendingFeedback).not.toBeNull());

    mockInvoke.mockRejectedValueOnce(
      new Error("Failed to write to sidecar stdin: Broken pipe (os error 32)")
    );

    await act(async () => {
      await result.current.respondToFeedback("fb-1", true);
    });

    expect(result.current.pendingFeedback).toBeNull();
    expect(setError).toHaveBeenCalledWith(
      "Agent session expired. Click Resume to continue where you left off."
    );
  });

  it("respondToFeedback shows generic error for non-broken-pipe failures", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-1",
        summary: "Review",
      });
    });

    await waitFor(() => expect(result.current.pendingFeedback).not.toBeNull());

    mockInvoke.mockRejectedValueOnce(new Error("Some other error"));

    await act(async () => {
      await result.current.respondToFeedback("fb-1", true);
    });

    expect(result.current.pendingFeedback).toBeNull();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("Failed to respond to feedback"));
  });

  it("clearPending sets pendingFeedback to null", async () => {
    const { result } = renderHook(() =>
      useWorkflowFeedback("issue-1", setError)
    );

    await waitFor(() => expect(result.current.feedbackReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-feedback-request", {
        request_id: "fb-1",
        ticket_id: "issue-1",
        summary: "Review",
      });
    });

    await waitFor(() => expect(result.current.pendingFeedback).not.toBeNull());

    act(() => {
      result.current.clearPending();
    });

    expect(result.current.pendingFeedback).toBeNull();
  });
});
