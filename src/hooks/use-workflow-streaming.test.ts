import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { clearTauriMocks, emitTauriEvent } from "@/test/mocks/tauri";
import { useWorkflowStreaming } from "./use-workflow-streaming";
import type { StreamChunk } from "@/types";

describe("useWorkflowStreaming", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("streamingReady becomes true after mount", async () => {
    const executingStepRef = { current: null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => {
      expect(result.current.streamingReady).toBe(true);
    });
  });

  it("accumulates text chunks in stepOutputs for the executing step", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello ",
      } as StreamChunk);
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "text",
        content: "World",
      } as StreamChunk);
    });

    await waitFor(() => {
      expect(result.current.stepOutputs["step-1"]?.textContent).toBe("Hello World");
    });
  });

  it("ignores events for a different issue_id", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-OTHER",
        chunk_type: "text",
        content: "Should be ignored",
      } as StreamChunk);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.stepOutputs["step-1"]).toBeUndefined();
  });

  it("ignores events when executingStepRef is null", async () => {
    const executingStepRef = { current: null as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Should be dropped",
      } as StreamChunk);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(result.current.stepOutputs)).toHaveLength(0);
  });

  it("captures error chunks in stderrLines", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "error",
        content: "Something went wrong",
      } as StreamChunk);
    });

    await waitFor(() => {
      const output = result.current.stepOutputs["step-1"];
      expect(output?.stderrLines).toContainEqual("[error] Something went wrong");
    });
  });

  it("sets resultContent on result chunk", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "result",
        content: "Final result",
      } as StreamChunk);
    });

    await waitFor(() => {
      expect(result.current.stepOutputs["step-1"]?.resultContent).toBe("Final result");
    });
  });

  it("getStepOutput returns the step's output", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello",
      } as StreamChunk);
    });

    await waitFor(() => {
      expect(result.current.getStepOutput("step-1")?.textContent).toBe("Hello");
    });
    expect(result.current.getStepOutput("nonexistent")).toBeUndefined();
  });

  it("re-creates listener when activeTicketId changes", async () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result, rerender } = renderHook(
      ({ ticketId }) => useWorkflowStreaming(ticketId, executingStepRef),
      { initialProps: { ticketId: "issue-1" as string | null } }
    );

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    // Change ticket ID — should briefly become not-ready then re-ready
    rerender({ ticketId: "issue-2" });

    await waitFor(() => expect(result.current.streamingReady).toBe(true));

    // Events for issue-1 should now be ignored
    act(() => {
      emitTauriEvent("workflow-step-output", {
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Old ticket event",
      } as StreamChunk);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.stepOutputs["step-1"]).toBeUndefined();
  });
});
