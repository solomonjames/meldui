import { describe, it, expect } from "vitest";
import { snapshotToBlocks } from "./snapshot-to-blocks";
import type { ConversationEventRecord, ConversationStepRecord } from "./types";

function makeEvent(
  overrides: Partial<ConversationEventRecord> & { event_type: string; content: string },
): ConversationEventRecord {
  return {
    timestamp: "2026-03-22T00:00:00Z",
    sequence: 1,
    step_id: "step-1",
    ...overrides,
  };
}

/** Helper: wrap content as the sidecar params JSON (how events are actually stored) */
function jsonContent(content: string, type?: string): string {
  return JSON.stringify({ content, ...(type ? { type } : {}) });
}

const defaultStep: ConversationStepRecord = {
  step_id: "step-1",
  label: "Understand",
  started_at: "2026-03-22T00:00:00Z",
  completed_at: "2026-03-22T01:00:00Z",
  status: "completed",
  first_sequence: 1,
};

describe("snapshotToBlocks", () => {
  it("returns empty array for empty events", () => {
    expect(snapshotToBlocks([], [])).toEqual([]);
  });

  it("converts text events to text blocks with step divider", () => {
    const events = [makeEvent({ event_type: "text", content: jsonContent("Hello", "text") })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "step_divider", stepId: "step-1", label: "Understand" });
    expect(blocks[1]).toEqual({ type: "text", content: "Hello" });
  });

  it("merges consecutive text chunks into a single block", () => {
    const events = [
      makeEvent({ event_type: "text", content: jsonContent("Hello "), sequence: 1 }),
      makeEvent({ event_type: "text", content: jsonContent("world"), sequence: 2 }),
    ];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks).toHaveLength(2); // divider + 1 merged text
    expect(blocks[1]).toEqual({ type: "text", content: "Hello world" });
  });

  it("skips thinking events in restored history", () => {
    const events = [makeEvent({ event_type: "thinking", content: jsonContent("Let me think...") })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    // Only the step divider, no text block for thinking
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("step_divider");
  });

  it("converts result events to text blocks", () => {
    const events = [makeEvent({ event_type: "result", content: jsonContent("Done!") })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks[1]).toEqual({ type: "text", content: "Done!" });
  });

  it("converts error events to text blocks with prefix", () => {
    const events = [makeEvent({ event_type: "error", content: jsonContent("Something broke") })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks[1]).toEqual({ type: "text", content: "**Error:** Something broke" });
  });

  it("groups tool_start/tool_input/tool_result into tool_group", () => {
    const events = [
      makeEvent({
        event_type: "tool_start",
        content: JSON.stringify({ tool_id: "t1", tool_name: "Read" }),
        sequence: 1,
      }),
      makeEvent({
        event_type: "tool_input",
        content: JSON.stringify({ tool_id: "t1", content: "/path" }),
        sequence: 2,
      }),
      makeEvent({
        event_type: "tool_result",
        content: JSON.stringify({ tool_id: "t1", content: "file contents", is_error: false }),
        sequence: 3,
      }),
    ];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks).toHaveLength(2);
    const toolGroup = blocks[1];
    expect(toolGroup.type).toBe("tool_group");
    if (toolGroup.type === "tool_group") {
      expect(toolGroup.activities).toHaveLength(1);
      expect(toolGroup.activities[0].tool_name).toBe("Read");
      expect(toolGroup.activities[0].input).toBe("/path");
      expect(toolGroup.activities[0].result).toBe("file contents");
    }
  });

  it("inserts step divider when step changes", () => {
    const events = [
      makeEvent({
        event_type: "text",
        content: jsonContent("Step 1"),
        step_id: "step-1",
        sequence: 1,
      }),
      makeEvent({
        event_type: "text",
        content: jsonContent("Step 2"),
        step_id: "step-2",
        sequence: 2,
      }),
    ];
    const steps: ConversationStepRecord[] = [
      { ...defaultStep, step_id: "step-1", label: "Understand" },
      { ...defaultStep, step_id: "step-2", label: "Implement" },
    ];
    const blocks = snapshotToBlocks(events, steps);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ type: "step_divider", stepId: "step-1", label: "Understand" });
    expect(blocks[2]).toEqual({ type: "step_divider", stepId: "step-2", label: "Implement" });
  });

  it("handles malformed JSON in tool events gracefully", () => {
    const events = [makeEvent({ event_type: "tool_start", content: "not json" })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks).toHaveLength(2);
    const toolGroup = blocks[1];
    expect(toolGroup.type).toBe("tool_group");
  });

  it("handles plain string content (not JSON-wrapped)", () => {
    const events = [makeEvent({ event_type: "text", content: "plain text" })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks[1]).toEqual({ type: "text", content: "plain text" });
  });
});
