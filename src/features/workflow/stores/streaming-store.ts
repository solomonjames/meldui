import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type {
  ContentBlock,
  ContextUsage,
  StepOutputStream,
  StreamChunk,
  SubagentActivity,
  ToolActivity,
} from "@/shared/types";

function defaultContextUsage(): ContextUsage {
  return {
    tokensUsed: 0,
    contextLimit: 200000,
    inputTokens: 0,
    outputTokens: 0,
    cacheReads: 0,
    cacheCreations: 0,
    costUsd: 0,
    rateLimitUtilization: 0,
    rateLimitStatus: "ok",
  };
}

export function emptyStepOutput(): StepOutputStream {
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
    contextUsage: undefined,
    supervisorEvaluating: false,
  };
}

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

export interface StreamingState {
  stepOutputs: Record<string, StepOutputStream>;
  handleChunk: (stepId: string, chunk: StreamChunk) => void;
  getStepOutput: (issueId: string, stepId: string) => StepOutputStream | undefined;
  clearStepOutputs: () => void;
}

export const streamingStoreFactory = createTicketStoreFactory<StreamingState>((set, get) => ({
  stepOutputs: {},

  handleChunk: (stepId: string, chunk: StreamChunk) => {
    set((prev) => {
      const outputKey = `${chunk.issue_id}:${stepId}`;
      const current = prev.stepOutputs[outputKey] ?? emptyStepOutput();
      const updated = { ...current };

      // Clear supervisor evaluating flag when agent content arrives
      if (current.supervisorEvaluating && !chunk.chunk_type.startsWith("supervisor_")) {
        updated.supervisorEvaluating = false;
      }

      switch (chunk.chunk_type) {
        case "text": {
          if (current.textContent && current.lastChunkType !== "text") {
            updated.textContent = `${current.textContent}\n\n${chunk.content}`;
          } else {
            updated.textContent = current.textContent + chunk.content;
          }
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
                updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                  ...a,
                  input: a.input + inputContent,
                }));
              }
            }
          } catch {
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
                updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                  ...a,
                  status: "complete",
                }));
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
            const { tool_name, tool_use_id, elapsed_seconds } = JSON.parse(chunk.content);
            updated.activeToolName = tool_name;
            if (tool_use_id && elapsed_seconds !== undefined) {
              updated.toolActivities = current.toolActivities.map((a) =>
                a.tool_id === tool_use_id ? { ...a, elapsed_seconds } : a,
              );
              updated.contentBlocks = updateToolInBlocks(
                current.contentBlocks,
                tool_use_id,
                (a) => ({ ...a, elapsed_seconds }),
              );
            }
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
        case "compact_boundary": {
          try {
            const { pre_tokens } = JSON.parse(chunk.content);
            updated.contextUsage = {
              ...(current.contextUsage ?? defaultContextUsage()),
              tokensUsed: pre_tokens,
            };
          } catch {
            /* ignore */
          }
          break;
        }
        case "rate_limit": {
          try {
            const { utilization, status } = JSON.parse(chunk.content);
            updated.contextUsage = {
              ...(current.contextUsage ?? defaultContextUsage()),
              rateLimitUtilization: utilization,
              rateLimitStatus: status,
            };
          } catch {
            /* ignore */
          }
          break;
        }
        case "compacting": {
          updated.isCompacting = chunk.content === "true";
          break;
        }
        case "thinking": {
          updated.thinkingContent = current.thinkingContent + chunk.content;
          const blocks = [...current.contentBlocks];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === "thinking") {
            blocks[blocks.length - 1] = {
              ...lastBlock,
              content: lastBlock.content + chunk.content,
            };
          } else {
            blocks.push({ type: "thinking", content: chunk.content });
          }
          updated.contentBlocks = blocks;
          updated.lastChunkType = "thinking";
          break;
        }
        case "stderr":
          updated.stderrLines = [...current.stderrLines, chunk.content];
          break;
        case "result":
          updated.resultContent = chunk.content;
          break;
        case "supervisor_evaluating":
          updated.supervisorEvaluating = true;
          break;
        case "supervisor_reply": {
          const blocks = [...current.contentBlocks];
          blocks.push({ type: "supervisor_reply", content: chunk.content });
          updated.contentBlocks = blocks;
          updated.lastChunkType = "supervisor_reply";
          break;
        }
        case "error":
          updated.stderrLines = [...current.stderrLines, `[error] ${chunk.content}`];
          break;
        default:
          return prev;
      }

      return {
        ...prev,
        stepOutputs: { ...prev.stepOutputs, [outputKey]: updated },
      };
    });
  },

  getStepOutput: (issueId: string, stepId: string) => {
    return get().stepOutputs[`${issueId}:${stepId}`];
  },

  clearStepOutputs: () => {
    set({ stepOutputs: {} });
  },
}));
