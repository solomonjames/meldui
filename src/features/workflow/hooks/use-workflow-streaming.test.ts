import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { clearTauriMocks } from "@/shared/test/mocks/tauri";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";
import type { StreamChunk } from "@/shared/types";

describe("useWorkflowStreaming", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("streamingReady is always true", () => {
    const executingStepRef = { current: null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    expect(result.current.streamingReady).toBe(true);
  });

  it("createStreamChannel processes text chunks", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello ",
      } as StreamChunk);
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "World",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]?.textContent).toBe("Hello World");
  });

  it("ignores chunks for a different issue_id", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-OTHER",
        chunk_type: "text",
        content: "Should be ignored",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]).toBeUndefined();
  });

  it("ignores chunks when executingStepRef is null", () => {
    const executingStepRef = { current: null as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Should be dropped",
      } as StreamChunk);
    });

    expect(Object.keys(result.current.stepOutputs)).toHaveLength(0);
  });

  it("captures error chunks in stderrLines", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "error",
        content: "Something went wrong",
      } as StreamChunk);
    });

    const output = result.current.stepOutputs["step-1"];
    expect(output?.stderrLines).toContainEqual("[error] Something went wrong");
  });

  it("sets resultContent on result chunk", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "result",
        content: "Final result",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]?.resultContent).toBe("Final result");
  });

  it("getStepOutput returns the step's output", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello",
      } as StreamChunk);
    });

    expect(result.current.getStepOutput("step-1")?.textContent).toBe("Hello");
    expect(result.current.getStepOutput("nonexistent")).toBeUndefined();
  });

  it("new channel from re-render with different ticketId filters correctly", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result, rerender } = renderHook(
      ({ ticketId }) => useWorkflowStreaming(ticketId, executingStepRef),
      { initialProps: { ticketId: "issue-1" as string | null } },
    );

    // Change ticket ID
    rerender({ ticketId: "issue-2" });

    // Create a new channel with the updated ticketId
    const channel = result.current.createStreamChannel();

    // Events for issue-1 should now be ignored
    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Old ticket event",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]).toBeUndefined();

    // Events for issue-2 should be captured
    act(() => {
      channel.onmessage!({
        issue_id: "issue-2",
        chunk_type: "text",
        content: "New ticket event",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]?.textContent).toBe("New ticket event");
  });
});
