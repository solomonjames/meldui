import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import { clearTauriMocks } from "@/shared/test/mocks/tauri";
import type { StreamChunk } from "@/shared/types";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";

describe("useWorkflowStreaming", () => {
  beforeEach(() => {
    clearTauriMocks();
    streamingStoreFactory.disposeStore("issue-1");
    streamingStoreFactory.disposeStore("issue-2");
    streamingStoreFactory.disposeStore("issue-OTHER");
  });

  it("streamingReady is always true", () => {
    const executingStepsRef = { current: {} as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    expect(result.current.streamingReady).toBe(true);
  });

  it("createStreamChannel processes text chunks", () => {
    const executingStepsRef = { current: { "issue-1": "step-1" } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

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

    // Read from store directly since hook no longer re-renders on store changes
    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.textContent).toBe("Hello World");
  });

  it("ignores chunks for a different issue_id (no entry in executingStepsRef)", () => {
    const executingStepsRef = { current: { "issue-1": "step-1" } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-OTHER",
        chunk_type: "text",
        content: "Should be ignored",
      } as StreamChunk);
    });

    const store = streamingStoreFactory.getStore("issue-1");
    expect(store.getState().stepOutputs["issue-1:step-1"]).toBeUndefined();
  });

  it("ignores chunks when executingStepsRef has null for the issue", () => {
    const executingStepsRef = { current: { "issue-1": null } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Should be dropped",
      } as StreamChunk);
    });

    const store = streamingStoreFactory.getStore("issue-1");
    expect(Object.keys(store.getState().stepOutputs)).toHaveLength(0);
  });

  it("captures error chunks in stderrLines", () => {
    const executingStepsRef = { current: { "issue-1": "step-1" } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "error",
        content: "Something went wrong",
      } as StreamChunk);
    });

    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.stderrLines).toContainEqual("[error] Something went wrong");
  });

  it("sets resultContent on result chunk", () => {
    const executingStepsRef = { current: { "issue-1": "step-1" } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "result",
        content: "Final result",
      } as StreamChunk);
    });

    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.resultContent).toBe("Final result");
  });

  it("getStepOutput returns the step's output", () => {
    const executingStepsRef = { current: { "issue-1": "step-1" } as Record<string, string | null> };
    const { result } = renderHook(() => useWorkflowStreaming("issue-1", executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello",
      } as StreamChunk);
    });

    expect(result.current.getStepOutput("issue-1", "step-1")?.textContent).toBe("Hello");
    expect(result.current.getStepOutput("issue-1", "nonexistent")).toBeUndefined();
  });

  it("routes chunks for multiple issues concurrently to their respective stores", () => {
    const executingStepsRef = {
      current: {
        "issue-1": "step-1",
        "issue-2": "step-2",
      } as Record<string, string | null>,
    };
    const { result } = renderHook(() => useWorkflowStreaming(null, executingStepsRef));

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "From issue 1",
      } as StreamChunk);
      channel.onmessage!({
        issue_id: "issue-2",
        chunk_type: "text",
        content: "From issue 2",
      } as StreamChunk);
    });

    expect(
      streamingStoreFactory.getStore("issue-1").getState().stepOutputs["issue-1:step-1"]
        ?.textContent,
    ).toBe("From issue 1");
    expect(
      streamingStoreFactory.getStore("issue-2").getState().stepOutputs["issue-2:step-2"]
        ?.textContent,
    ).toBe("From issue 2");
  });
});
