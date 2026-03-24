import type {
  ConversationEventRecord,
  ConversationStepRecord,
} from "@/shared/lib/conversations/types";
import type { ContentBlock, FileChange, SubagentActivity, ToolActivity } from "@/shared/types";

export interface StepDivider {
  type: "step_divider";
  stepId: string;
  label: string;
}

export type ConversationBlock = ContentBlock | StepDivider;

export interface SnapshotBlocksResult {
  blocks: ConversationBlock[];
  filesChanged: FileChange[];
}

export function snapshotToBlocks(
  events: ConversationEventRecord[],
  steps: ConversationStepRecord[],
): SnapshotBlocksResult {
  const blocks: ConversationBlock[] = [];
  let currentStepId: string | null = null;
  const toolMap = new Map<string, ToolActivity>();
  let pendingToolGroup: ToolActivity[] = [];
  const filesChanged: FileChange[] = [];
  const filesSet = new Set<string>();

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
          const last = blocks[blocks.length - 1];
          if (last && last.type === "text") {
            last.content += text;
          } else {
            blocks.push({ type: "text", content: text });
          }
        }
        break;
      }
      case "thinking": {
        flushToolGroup();
        const text = extractContent(event.content);
        if (text) {
          const last = blocks[blocks.length - 1];
          if (last && last.type === "thinking") {
            last.content += text;
          } else {
            blocks.push({ type: "thinking", content: text });
          }
        }
        break;
      }
      case "user_message": {
        flushToolGroup();
        const text = extractContent(event.content);
        if (text) {
          blocks.push({ type: "user_message", content: text });
        }
        break;
      }
      case "tool_start": {
        const parsed = safeParse(event.content);
        const tool: ToolActivity = {
          tool_id: (parsed?.tool_id ?? "") as string,
          tool_name: (parsed?.tool_name ?? "unknown") as string,
          input: "",
          status: "running",
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
        const parsed = safeParse(event.content);
        const toolId = (parsed?.tool_id ?? "") as string;
        const existing = toolMap.get(toolId);
        if (existing) {
          existing.status = "complete";
        }
        break;
      }
      case "tool_result": {
        const parsed = safeParse(event.content);
        const toolId = (parsed?.tool_id ?? "") as string;
        const existing = toolMap.get(toolId);
        if (existing) {
          existing.result = (parsed?.content ?? parsed?.result ?? event.content) as string;
          existing.is_error = (parsed?.is_error ?? false) as boolean;
          existing.status = "complete";
        }
        break;
      }
      case "tool_use_summary": {
        const parsed = safeParse(event.content);
        const summary = parsed?.summary as string | undefined;
        const toolIds = (parsed?.tool_ids ?? []) as string[];
        if (summary && toolIds.length > 0) {
          for (let j = blocks.length - 1; j >= 0; j--) {
            const b = blocks[j];
            if (b.type === "tool_group" && b.activities.some((a) => toolIds.includes(a.tool_id))) {
              (b as { summaryText?: string }).summaryText = summary;
              break;
            }
          }
          if (pendingToolGroup.some((a) => toolIds.includes(a.tool_id))) {
            flushToolGroup();
            const last = blocks[blocks.length - 1];
            if (last && last.type === "tool_group") {
              (last as { summaryText?: string }).summaryText = summary;
            }
          }
        }
        break;
      }
      case "subagent_start":
      case "subagent_progress":
      case "subagent_complete": {
        flushToolGroup();
        const parsed = safeParse(event.content);
        const taskId = (parsed?.task_id ?? "") as string;
        const status =
          event.event_type === "subagent_complete"
            ? ((parsed?.status ?? "completed") as SubagentActivity["status"])
            : "running";
        const existingBlock = blocks.find(
          (b) => b.type === "subagent" && b.activity.task_id === taskId,
        );
        if (existingBlock && existingBlock.type === "subagent") {
          existingBlock.activity.status = status;
          if (parsed?.summary) existingBlock.activity.summary = parsed.summary as string;
          if (parsed?.description)
            existingBlock.activity.description = parsed.description as string;
          if (parsed?.last_tool_name)
            existingBlock.activity.last_tool_name = parsed.last_tool_name as string;
          if (parsed?.usage)
            existingBlock.activity.usage = parsed.usage as SubagentActivity["usage"];
        } else {
          blocks.push({
            type: "subagent",
            activity: {
              task_id: taskId,
              tool_use_id: (parsed?.tool_use_id ?? undefined) as string | undefined,
              description: (parsed?.description ?? "") as string,
              status,
              summary: parsed?.summary as string | undefined,
              last_tool_name: parsed?.last_tool_name as string | undefined,
              usage: parsed?.usage as SubagentActivity["usage"],
            },
          });
        }
        break;
      }
      case "files_changed": {
        const parsed = safeParse(event.content);
        const files = (parsed?.files ?? []) as Array<{ filename: string }>;
        for (const f of files) {
          if (!filesSet.has(f.filename)) {
            filesSet.add(f.filename);
            filesChanged.push({ filename: f.filename });
          }
        }
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
  return { blocks, filesChanged };
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
  return raw || null;
}
