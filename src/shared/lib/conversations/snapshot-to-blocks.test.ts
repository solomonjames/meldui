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
    const events = [makeEvent({ event_type: "text", content: "Hello" })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "step_divider", stepId: "step-1", label: "Understand" });
    expect(blocks[1]).toEqual({ type: "text", content: "Hello" });
  });

  it("converts thinking events to text blocks", () => {
    const events = [makeEvent({ event_type: "thinking", content: "Let me think..." })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks[1]).toEqual({ type: "text", content: "Let me think..." });
  });

  it("converts result events to text blocks", () => {
    const events = [makeEvent({ event_type: "result", content: "Done!" })];
    const blocks = snapshotToBlocks(events, [defaultStep]);
    expect(blocks[1]).toEqual({ type: "text", content: "Done!" });
  });

  it("converts error events to text blocks with prefix", () => {
    const events = [makeEvent({ event_type: "error", content: "Something broke" })];
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
        content: JSON.stringify({ tool_id: "t1", input: "/path" }),
        sequence: 2,
      }),
      makeEvent({
        event_type: "tool_result",
        content: JSON.stringify({ tool_id: "t1", result: "file contents" }),
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
      expect(toolGroup.activities[0].result).toBe("file contents");
    }
  });

  it("inserts step divider when step changes", () => {
    const events = [
      makeEvent({ event_type: "text", content: "Step 1", step_id: "step-1", sequence: 1 }),
      makeEvent({ event_type: "text", content: "Step 2", step_id: "step-2", sequence: 2 }),
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
});
