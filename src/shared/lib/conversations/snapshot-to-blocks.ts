import type { ContentBlock, ToolActivity } from "@/shared/types";
import type { ConversationEventRecord, ConversationStepRecord } from "./types";

export interface StepDivider {
  type: "step_divider";
  stepId: string;
  label: string;
}

export type ConversationBlock = ContentBlock | StepDivider;

export function snapshotToBlocks(
  events: ConversationEventRecord[],
  steps: ConversationStepRecord[],
): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  let currentStepId: string | null = null;
  const toolMap = new Map<string, ToolActivity>();
  let pendingToolGroup: ToolActivity[] = [];

  function flushToolGroup() {
    if (pendingToolGroup.length > 0) {
      blocks.push({ type: "tool_group", activities: [...pendingToolGroup] });
      pendingToolGroup = [];
    }
  }

  for (const event of events) {
    if (event.step_id !== currentStepId) {
      flushToolGroup();
      currentStepId = event.step_id;
      const step = steps.find((s) => s.step_id === event.step_id);
      blocks.push({
        type: "step_divider",
        stepId: event.step_id,
        label: step?.label ?? event.step_id,
      });
    }

    switch (event.event_type) {
      case "text": {
        flushToolGroup();
        const text = extractContent(event.content);
        if (text) {
          // Merge consecutive text chunks into a single block
          const last = blocks[blocks.length - 1];
          if (last && last.type === "text") {
            last.content += text;
          } else {
            blocks.push({ type: "text", content: text });
          }
        }
        break;
      }
      case "tool_start": {
        const parsed = safeParse(event.content);
        const tool: ToolActivity = {
          tool_id: (parsed?.tool_id ?? "") as string,
          tool_name: (parsed?.tool_name ?? "unknown") as string,
          input: "",
          status: "complete",
        };
        toolMap.set(tool.tool_id, tool);
        pendingToolGroup.push(tool);
        break;
      }
      case "tool_input": {
        const parsed = safeParse(event.content);
        const toolId = (parsed?.tool_id ?? "") as string;
        const existing = toolMap.get(toolId);
        if (existing) {
          existing.input += (parsed?.content ?? parsed?.input ?? event.content) as string;
        }
        break;
      }
      case "tool_end": {
        break;
      }
      case "tool_result": {
        const parsed = safeParse(event.content);
        const toolId = (parsed?.tool_id ?? "") as string;
        const existing = toolMap.get(toolId);
        if (existing) {
          existing.result = (parsed?.content ?? parsed?.result ?? event.content) as string;
          existing.is_error = (parsed?.is_error ?? false) as boolean;
        }
        break;
      }
      case "subagent_start":
      case "subagent_progress":
      case "subagent_complete": {
        flushToolGroup();
        const parsed = safeParse(event.content);
        blocks.push({
          type: "subagent",
          activity: {
            task_id: (parsed?.task_id ?? "") as string,
            description: (parsed?.description ?? "") as string,
            status: event.event_type === "subagent_complete" ? "completed" : "running",
            summary: parsed?.summary as string | undefined,
          },
        });
        break;
      }
      case "thinking": {
        // Thinking content is informational; skip rendering in history
        break;
      }
      case "result": {
        flushToolGroup();
        const resultText = extractContent(event.content);
        if (resultText) blocks.push({ type: "text", content: resultText });
        break;
      }
      case "error": {
        flushToolGroup();
        const errorText = extractContent(event.content) ?? event.content;
        blocks.push({ type: "text", content: `**Error:** ${errorText}` });
        break;
      }
      default:
        break;
    }
  }

  flushToolGroup();
  return blocks;
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Extract the inner `content` field from a JSON-serialized event payload.
 *  The NDJSON stores the full params object (e.g. `{"content":"...","type":"text"}`),
 *  so we need to unwrap it. Falls back to the raw string if it's not JSON. */
function extractContent(raw: string): string | null {
  const parsed = safeParse(raw);
  if (parsed && typeof parsed.content === "string") {
    return parsed.content || null;
  }
  // Not JSON — use the raw string directly
  return raw || null;
}
