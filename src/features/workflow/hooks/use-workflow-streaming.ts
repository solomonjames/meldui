import { Channel } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type {
  ContentBlock,
  StepOutputStream,
  StreamChunk,
  SubagentActivity,
  ToolActivity,
} from "@/shared/types";

/** Update a ToolActivity inside contentBlocks by tool_id */
function updateToolInBlocks(
  blocks: ContentBlock[],
  toolId: string,
  updater: (a: ToolActivity) => ToolActivity,
): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "tool_group") return block;
    const idx = block.activities.findIndex((a) => a.tool_id === toolId);
    if (idx < 0) return block;
    const activities = [...block.activities];
    activities[idx] = updater(activities[idx]);
    return { ...block, activities };
  });
}

function emptyStepOutput(): StepOutputStream {
  return {
    textContent: "",
    toolActivities: [],
    stderrLines: [],
    resultContent: null,
    thinkingContent: "",
    lastChunkType: "",
    contentBlocks: [],
    subagentActivities: [],
    filesChanged: [],
    activeToolName: null,
    activeToolStartTime: null,
    toolUseSummaries: [],
    isCompacting: false,
  };
}

export function useWorkflowStreaming(
  activeTicketId: string | null,
  executingStepRef: React.MutableRefObject<string | null>,
) {
  const [stepOutputs, setStepOutputs] = useState<Record<string, StepOutputStream>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: executingStepRef is read at call time, not memoization time
  const createStreamChannel = useCallback((): Channel<StreamChunk> => {
    const channel = new Channel<StreamChunk>();

    channel.onmessage = (chunk: StreamChunk) => {
      // Only process chunks for the active ticket
      if (activeTicketId && chunk.issue_id !== activeTicketId) return;

      const stepId = executingStepRef.current;
      if (!stepId) return;

      setStepOutputs((prev) => {
        const current = prev[stepId] ?? emptyStepOutput();
        const updated = { ...current };

        switch (chunk.chunk_type) {
          case "text": {
            // Insert paragraph break when text resumes after tool use
            if (current.textContent && current.lastChunkType !== "text") {
              updated.textContent = `${current.textContent}\n\n${chunk.content}`;
            } else {
              updated.textContent = current.textContent + chunk.content;
            }
            // Build contentBlocks: append to last text block or create new one
            const blocks = [...current.contentBlocks];
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === "text") {
              blocks[blocks.length - 1] = {
                ...lastBlock,
                content: lastBlock.content + chunk.content,
              };
            } else {
              blocks.push({ type: "text", content: chunk.content });
            }
            updated.contentBlocks = blocks;
            updated.lastChunkType = "text";
            break;
          }
          case "tool_start": {
            try {
              const { tool_name, tool_id } = JSON.parse(chunk.content);
              const activity: ToolActivity = {
                tool_id,
                tool_name,
                input: "",
                status: "running",
              };
              updated.toolActivities = [...current.toolActivities, activity];
              updated.activeToolName = tool_name;
              updated.activeToolStartTime = Date.now();

              // Build contentBlocks: add to current tool_group or start new one
              const blocks = [...current.contentBlocks];
              const lastBlock = blocks[blocks.length - 1];
              if (lastBlock && lastBlock.type === "tool_group") {
                blocks[blocks.length - 1] = {
                  ...lastBlock,
                  activities: [...lastBlock.activities, activity],
                };
              } else {
                blocks.push({ type: "tool_group", activities: [activity] });
              }
              updated.contentBlocks = blocks;
            } catch {
              // ignore malformed tool_start
            }
            updated.lastChunkType = "tool_start";
            break;
          }
          case "tool_input": {
            // Match by tool_id from sidecar NDJSON
            try {
              const { tool_id, content: inputContent } = JSON.parse(chunk.content);
              if (tool_id) {
                const activities = [...current.toolActivities];
                const idx = activities.findIndex((a) => a.tool_id === tool_id);
                if (idx >= 0) {
                  activities[idx] = {
                    ...activities[idx],
                    input: activities[idx].input + inputContent,
                  };
                  updated.toolActivities = activities;
                  // Update in contentBlocks too
                  updated.contentBlocks = updateToolInBlocks(
                    current.contentBlocks,
                    tool_id,
                    (a) => ({
                      ...a,
                      input: a.input + inputContent,
                    }),
                  );
                }
              }
            } catch {
              // Fallback: append to last activity (legacy behavior)
              if (current.toolActivities.length > 0) {
                const activities = [...current.toolActivities];
                const last = { ...activities[activities.length - 1] };
                last.input = last.input + chunk.content;
                activities[activities.length - 1] = last;
                updated.toolActivities = activities;
              }
            }
            break;
          }
          case "tool_end": {
            let matched = false;
            try {
              const { tool_id } = JSON.parse(chunk.content);
              if (tool_id) {
                const activities = [...current.toolActivities];
                const idx = activities.findIndex((a) => a.tool_id === tool_id);
                if (idx >= 0) {
                  activities[idx] = { ...activities[idx], status: "complete" };
                  updated.toolActivities = activities;
                  updated.contentBlocks = updateToolInBlocks(
                    current.contentBlocks,
                    tool_id,
                    (a) => ({
                      ...a,
                      status: "complete",
                    }),
                  );
                  matched = true;
                }
              }
            } catch {
              // Fallback
            }
            if (!matched && current.toolActivities.length > 0) {
              const activities = [...current.toolActivities];
              const last = { ...activities[activities.length - 1] };
              last.status = "complete";
              activities[activities.length - 1] = last;
              updated.toolActivities = activities;
            }
            updated.activeToolName = null;
            updated.activeToolStartTime = null;
            break;
          }
          case "tool_result": {
            try {
              const { tool_id, content, is_error } = JSON.parse(chunk.content);
              const activities = [...current.toolActivities];
              const idx = activities.findIndex((a) => a.tool_id === tool_id);
              if (idx >= 0) {
                activities[idx] = {
                  ...activities[idx],
                  result: content,
                  is_error,
                  status: "complete",
                };
                updated.toolActivities = activities;
                updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                  ...a,
                  result: content,
                  is_error,
                  status: "complete" as const,
                }));
              }
            } catch {
              // ignore malformed tool_result
            }
            updated.lastChunkType = "tool_result";
            break;
          }
          case "tool_progress": {
            try {
              const { tool_name } = JSON.parse(chunk.content);
              updated.activeToolName = tool_name;
            } catch {
              // ignore
            }
            break;
          }
          case "subagent_start": {
            try {
              const { task_id, tool_use_id, description } = JSON.parse(chunk.content);
              const subagent: SubagentActivity = {
                task_id,
                tool_use_id,
                description,
                status: "running",
              };
              updated.subagentActivities = [...current.subagentActivities, subagent];
              const blocks = [...current.contentBlocks];
              blocks.push({ type: "subagent", activity: subagent });
              updated.contentBlocks = blocks;
            } catch {
              // ignore
            }
            break;
          }
          case "subagent_progress": {
            try {
              const { task_id, summary, last_tool_name, usage } = JSON.parse(chunk.content);
              updated.subagentActivities = current.subagentActivities.map((s) =>
                s.task_id === task_id ? { ...s, summary, last_tool_name, usage } : s,
              );
              updated.contentBlocks = current.contentBlocks.map((b) =>
                b.type === "subagent" && b.activity.task_id === task_id
                  ? { ...b, activity: { ...b.activity, summary, last_tool_name, usage } }
                  : b,
              );
            } catch {
              // ignore
            }
            break;
          }
          case "subagent_complete": {
            try {
              const { task_id, status, summary, usage } = JSON.parse(chunk.content);
              updated.subagentActivities = current.subagentActivities.map((s) =>
                s.task_id === task_id ? { ...s, status, summary, usage } : s,
              );
              updated.contentBlocks = current.contentBlocks.map((b) =>
                b.type === "subagent" && b.activity.task_id === task_id
                  ? { ...b, activity: { ...b.activity, status, summary, usage } }
                  : b,
              );
            } catch {
              // ignore
            }
            break;
          }
          case "files_changed": {
            try {
              const { files } = JSON.parse(chunk.content);
              if (Array.isArray(files)) {
                const existing = new Set(current.filesChanged.map((f) => f.filename));
                const newFiles = files
                  .filter((f: { filename: string }) => !existing.has(f.filename))
                  .map((f: { filename: string }) => ({ filename: f.filename }));
                updated.filesChanged = [...current.filesChanged, ...newFiles];
              }
            } catch {
              // ignore
            }
            break;
          }
          case "tool_use_summary": {
            try {
              const { summary, tool_ids } = JSON.parse(chunk.content);
              updated.toolUseSummaries = [
                ...current.toolUseSummaries,
                { summary, toolIds: tool_ids ?? [] },
              ];
              // Best-effort: find matching tool_group and set summaryText
              if (Array.isArray(tool_ids) && tool_ids.length > 0) {
                updated.contentBlocks = current.contentBlocks.map((b) => {
                  if (b.type !== "tool_group") return b;
                  const hasMatch = b.activities.some((a) => tool_ids.includes(a.tool_id));
                  return hasMatch ? { ...b, summaryText: summary } : b;
                });
              }
            } catch {
              // ignore
            }
            break;
          }
          case "compacting": {
            updated.isCompacting = chunk.content === "true";
            break;
          }
          case "thinking":
            updated.thinkingContent = current.thinkingContent + chunk.content;
            break;
          case "stderr":
            updated.stderrLines = [...current.stderrLines, chunk.content];
            break;
          case "result":
            updated.resultContent = chunk.content;
            break;
          case "error":
            updated.stderrLines = [...current.stderrLines, `[error] ${chunk.content}`];
            break;
          default:
            return prev;
        }

        return { ...prev, [stepId]: updated };
      });
    };

    return channel;
  }, [activeTicketId]);

  const getStepOutput = useCallback(
    (stepId: string): StepOutputStream | undefined => {
      return stepOutputs[stepId];
    },
    [stepOutputs],
  );

  return { stepOutputs, getStepOutput, createStreamChannel, streamingReady: true as const };
}
