import { describe, it, expect, beforeEach } from "vitest";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";

describe("streamingStore", () => {
  beforeEach(() => {
    streamingStoreFactory.disposeStore("ticket-1");
    streamingStoreFactory.disposeStore("ticket-2");
  });

  it("initializes with empty stepOutputs", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    expect(store.getState().stepOutputs).toEqual({});
  });

  it("handleChunk accumulates text content", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "Hello ",
    });
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "World",
    });
    const output = store.getState().stepOutputs["ticket-1:step-1"];
    expect(output?.textContent).toBe("Hello World");
  });

  it("handleChunk captures error chunks in stderrLines", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "error",
      content: "Something went wrong",
    });
    const output = store.getState().stepOutputs["ticket-1:step-1"];
    expect(output?.stderrLines).toContainEqual("[error] Something went wrong");
  });

  it("handleChunk sets resultContent", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "result",
      content: "Final result",
    });
    const output = store.getState().stepOutputs["ticket-1:step-1"];
    expect(output?.resultContent).toBe("Final result");
  });

  it("handleChunk processes tool_start and builds contentBlocks", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "tool_start",
      content: JSON.stringify({ tool_name: "Read", tool_id: "tool-1" }),
    });
    const output = store.getState().stepOutputs["ticket-1:step-1"];
    expect(output?.toolActivities).toHaveLength(1);
    expect(output?.toolActivities[0].tool_name).toBe("Read");
    expect(output?.activeToolName).toBe("Read");
    expect(output?.contentBlocks).toHaveLength(1);
    expect(output?.contentBlocks[0].type).toBe("tool_group");
  });

  it("clearStepOutputs removes all outputs for a ticket", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "hello",
    });
    store.getState().handleChunk("step-2", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "world",
    });
    expect(Object.keys(store.getState().stepOutputs)).toHaveLength(2);

    store.getState().clearStepOutputs();
    expect(Object.keys(store.getState().stepOutputs)).toHaveLength(0);
  });

  it("stores are isolated between tickets", () => {
    const store1 = streamingStoreFactory.getStore("ticket-1");
    const store2 = streamingStoreFactory.getStore("ticket-2");
    store1.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "ticket 1 text",
    });
    expect(Object.keys(store2.getState().stepOutputs)).toHaveLength(0);
  });

  it("getStepOutput returns output for a specific step", () => {
    const store = streamingStoreFactory.getStore("ticket-1");
    store.getState().handleChunk("step-1", {
      issue_id: "ticket-1",
      chunk_type: "text",
      content: "hello",
    });
    expect(store.getState().getStepOutput("ticket-1", "step-1")?.textContent).toBe("hello");
    expect(store.getState().getStepOutput("ticket-1", "nonexistent")).toBeUndefined();
  });
});
