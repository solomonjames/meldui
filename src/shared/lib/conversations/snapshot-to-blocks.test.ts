import { describe, it, expect } from "vitest";
import { snapshotToBlocks } from "@/shared/lib/conversations/snapshot-to-blocks";
import type {
  ConversationEventRecord,
  ConversationStepRecord,
} from "@/shared/lib/conversations/types";

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
  it("returns empty result for empty events", () => {
    const result = snapshotToBlocks([], []);
    expect(result.blocks).toEqual([]);
    expect(result.filesChanged).toEqual([]);
  });

  it("converts text events to text blocks with step divider", () => {
    const events = [makeEvent({ event_type: "text", content: jsonContent("Hello", "text") })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toEqual({
      type: "step_divider",
      stepId: "step-1",
      label: "Understand",
    });
    expect(result.blocks[1]).toEqual({ type: "text", content: "Hello" });
  });

  it("merges consecutive text chunks into a single block", () => {
    const events = [
      makeEvent({ event_type: "text", content: jsonContent("Hello "), sequence: 1 }),
      makeEvent({ event_type: "text", content: jsonContent("world"), sequence: 2 }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toEqual({ type: "text", content: "Hello world" });
  });

  it("restores thinking events as thinking blocks", () => {
    const events = [makeEvent({ event_type: "thinking", content: jsonContent("Let me think...") })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toEqual({ type: "thinking", content: "Let me think..." });
  });

  it("merges consecutive thinking chunks into a single block", () => {
    const events = [
      makeEvent({ event_type: "thinking", content: jsonContent("Let me "), sequence: 1 }),
      makeEvent({ event_type: "thinking", content: jsonContent("think about this"), sequence: 2 }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toEqual({ type: "thinking", content: "Let me think about this" });
  });

  it("converts user_message events to user_message blocks", () => {
    const events = [
      makeEvent({
        event_type: "user_message",
        content: JSON.stringify({ content: "Fix the login bug" }),
        sequence: 1,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toEqual({ type: "user_message", content: "Fix the login bug" });
  });

  it("converts result events to text blocks", () => {
    const events = [makeEvent({ event_type: "result", content: jsonContent("Done!") })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks[1]).toEqual({ type: "text", content: "Done!" });
  });

  it("converts error events to text blocks with prefix", () => {
    const events = [makeEvent({ event_type: "error", content: jsonContent("Something broke") })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks[1]).toEqual({ type: "text", content: "**Error:** Something broke" });
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
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    const toolGroup = result.blocks[1];
    expect(toolGroup.type).toBe("tool_group");
    if (toolGroup.type === "tool_group") {
      expect(toolGroup.activities).toHaveLength(1);
      expect(toolGroup.activities[0].tool_name).toBe("Read");
      expect(toolGroup.activities[0].input).toBe("/path");
      expect(toolGroup.activities[0].result).toBe("file contents");
      expect(toolGroup.activities[0].status).toBe("complete");
    }
  });

  it("sets tool status to running until tool_end or tool_result", () => {
    const events = [
      makeEvent({
        event_type: "tool_start",
        content: JSON.stringify({ tool_id: "t1", tool_name: "Bash" }),
        sequence: 1,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    const toolGroup = result.blocks[1];
    if (toolGroup.type === "tool_group") {
      expect(toolGroup.activities[0].status).toBe("running");
    }
  });

  it("tool_end sets status to complete", () => {
    const events = [
      makeEvent({
        event_type: "tool_start",
        content: JSON.stringify({ tool_id: "t1", tool_name: "Bash" }),
        sequence: 1,
      }),
      makeEvent({
        event_type: "tool_end",
        content: JSON.stringify({ tool_id: "t1" }),
        sequence: 2,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    const toolGroup = result.blocks[1];
    if (toolGroup.type === "tool_group") {
      expect(toolGroup.activities[0].status).toBe("complete");
    }
  });

  it("restores tool_use_summary on matching tool_group", () => {
    const events = [
      makeEvent({
        event_type: "tool_start",
        content: JSON.stringify({ tool_id: "t1", tool_name: "Read" }),
        sequence: 1,
      }),
      makeEvent({
        event_type: "tool_result",
        content: JSON.stringify({ tool_id: "t1", content: "ok", is_error: false }),
        sequence: 2,
      }),
      makeEvent({
        event_type: "tool_use_summary",
        content: JSON.stringify({ summary: "Read 1 file", tool_ids: ["t1"] }),
        sequence: 3,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    const toolGroup = result.blocks[1];
    expect(toolGroup.type).toBe("tool_group");
    if (toolGroup.type === "tool_group") {
      expect(toolGroup.summaryText).toBe("Read 1 file");
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
    const result = snapshotToBlocks(events, steps);
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0]).toEqual({
      type: "step_divider",
      stepId: "step-1",
      label: "Understand",
    });
    expect(result.blocks[2]).toEqual({
      type: "step_divider",
      stepId: "step-2",
      label: "Implement",
    });
  });

  it("handles malformed JSON in tool events gracefully", () => {
    const events = [makeEvent({ event_type: "tool_start", content: "not json" })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    const toolGroup = result.blocks[1];
    expect(toolGroup.type).toBe("tool_group");
  });

  it("handles plain string content (not JSON-wrapped)", () => {
    const events = [makeEvent({ event_type: "text", content: "plain text" })];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks[1]).toEqual({ type: "text", content: "plain text" });
  });

  it("deduplicates subagent events by task_id and restores all fields", () => {
    const events = [
      makeEvent({
        event_type: "subagent_start",
        content: JSON.stringify({
          task_id: "sub-1",
          tool_use_id: "tu-1",
          description: "Analyze code",
        }),
        sequence: 1,
      }),
      makeEvent({
        event_type: "subagent_progress",
        content: JSON.stringify({
          task_id: "sub-1",
          summary: "Reading files...",
          last_tool_name: "Read",
          usage: { total_tokens: 1000, tool_uses: 3, duration_ms: 5000 },
        }),
        sequence: 2,
      }),
      makeEvent({
        event_type: "subagent_complete",
        content: JSON.stringify({
          task_id: "sub-1",
          status: "completed",
          summary: "Done analyzing",
          usage: { total_tokens: 2000, tool_uses: 5, duration_ms: 10000 },
        }),
        sequence: 3,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.blocks).toHaveLength(2);
    const subagent = result.blocks[1];
    expect(subagent.type).toBe("subagent");
    if (subagent.type === "subagent") {
      expect(subagent.activity.task_id).toBe("sub-1");
      expect(subagent.activity.tool_use_id).toBe("tu-1");
      expect(subagent.activity.status).toBe("completed");
      expect(subagent.activity.summary).toBe("Done analyzing");
      expect(subagent.activity.last_tool_name).toBe("Read");
      expect(subagent.activity.usage).toEqual({
        total_tokens: 2000,
        tool_uses: 5,
        duration_ms: 10000,
      });
    }
  });

  it("collects files_changed events into filesChanged array", () => {
    const events = [
      makeEvent({
        event_type: "files_changed",
        content: JSON.stringify({
          files: [{ filename: "src/main.ts" }, { filename: "src/lib.ts" }],
        }),
        sequence: 1,
      }),
      makeEvent({
        event_type: "files_changed",
        content: JSON.stringify({
          files: [{ filename: "src/main.ts" }, { filename: "src/new.ts" }],
        }),
        sequence: 2,
      }),
    ];
    const result = snapshotToBlocks(events, [defaultStep]);
    expect(result.filesChanged).toHaveLength(3);
    expect(result.filesChanged.map((f) => f.filename)).toEqual([
      "src/main.ts",
      "src/lib.ts",
      "src/new.ts",
    ]);
  });
});
