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
        blocks.push({ type: "text", content: event.content });
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
          existing.input += (parsed?.input ?? event.content) as string;
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
          existing.result = (parsed?.result ?? event.content) as string;
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
        flushToolGroup();
        blocks.push({ type: "text", content: event.content });
        break;
      }
      case "result": {
        flushToolGroup();
        blocks.push({ type: "text", content: event.content });
        break;
      }
      case "error": {
        flushToolGroup();
        blocks.push({ type: "text", content: `**Error:** ${event.content}` });
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
