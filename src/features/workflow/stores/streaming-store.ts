import { produce } from "immer";
import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type {
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

/** Mutate a tool activity in both toolActivities and contentBlocks by tool_id (immer draft) */
function mutateToolById(
  output: StepOutputStream,
  toolId: string,
  updater: (a: ToolActivity) => void,
): boolean {
  const activity = output.toolActivities.find((a) => a.tool_id === toolId);
  if (!activity) return false;
  updater(activity);
  for (const block of output.contentBlocks) {
    if (block.type !== "tool_group") continue;
    const blockActivity = block.activities.find((a) => a.tool_id === toolId);
    if (blockActivity) updater(blockActivity);
  }
  return true;
}

/** Append to the last content block of a given type, or push a new one (immer draft) */
function appendToLastBlock(output: StepOutputStream, type: "text" | "thinking", content: string) {
  const last = output.contentBlocks[output.contentBlocks.length - 1];
  if (last && last.type === type) {
    last.content += content;
  } else {
    output.contentBlocks.push({ type, content });
  }
}

export interface StreamingState {
  stepOutputs: Record<string, StepOutputStream>;
  handleChunk: (stepId: string, chunk: StreamChunk) => void;
  getStepOutput: (issueId: string, stepId: string) => StepOutputStream | undefined;
  clearStepOutputs: () => void;
}

export const streamingStoreFactory = createTicketStoreFactory<StreamingState>(
  "streaming",
  (set, get) => ({
    stepOutputs: {},

    handleChunk: (stepId: string, chunk: StreamChunk) => {
      set(
        produce((draft: StreamingState) => {
          const outputKey = `${chunk.issue_id}:${stepId}`;
          if (!draft.stepOutputs[outputKey]) {
            draft.stepOutputs[outputKey] = emptyStepOutput();
          }
          const output = draft.stepOutputs[outputKey];

          // Clear supervisor evaluating flag when agent content arrives
          if (output.supervisorEvaluating && !chunk.chunk_type.startsWith("supervisor_")) {
            output.supervisorEvaluating = false;
          }

          switch (chunk.chunk_type) {
            case "text": {
              if (output.textContent && output.lastChunkType !== "text") {
                output.textContent += `\n\n${chunk.content}`;
              } else {
                output.textContent += chunk.content;
              }
              appendToLastBlock(output, "text", chunk.content);
              output.lastChunkType = "text";
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
                output.toolActivities.push(activity);
                output.activeToolName = tool_name;
                output.activeToolStartTime = Date.now();
                const last = output.contentBlocks[output.contentBlocks.length - 1];
                if (last && last.type === "tool_group") {
                  last.activities.push({ ...activity });
                } else {
                  output.contentBlocks.push({
                    type: "tool_group",
                    activities: [{ ...activity }],
                  });
                }
              } catch {
                // ignore malformed tool_start
              }
              output.lastChunkType = "tool_start";
              break;
            }
            case "tool_input": {
              try {
                const { tool_id, content: inputContent } = JSON.parse(chunk.content);
                if (tool_id) {
                  mutateToolById(output, tool_id, (a) => {
                    a.input += inputContent;
                  });
                }
              } catch {
                const last = output.toolActivities[output.toolActivities.length - 1];
                if (last) last.input += chunk.content;
              }
              break;
            }
            case "tool_end": {
              let matched = false;
              try {
                const { tool_id } = JSON.parse(chunk.content);
                if (tool_id) {
                  matched = mutateToolById(output, tool_id, (a) => {
                    a.status = "complete";
                  });
                }
              } catch {
                // Fallback
              }
              if (!matched) {
                const last = output.toolActivities[output.toolActivities.length - 1];
                if (last) last.status = "complete";
              }
              output.activeToolName = null;
              output.activeToolStartTime = null;
              break;
            }
            case "tool_result": {
              try {
                const { tool_id, content, is_error } = JSON.parse(chunk.content);
                mutateToolById(output, tool_id, (a) => {
                  a.result = content;
                  a.is_error = is_error;
                  a.status = "complete";
                });
              } catch {
                // ignore malformed tool_result
              }
              output.lastChunkType = "tool_result";
              break;
            }
            case "tool_progress": {
              try {
                const { tool_name, tool_use_id, elapsed_seconds } = JSON.parse(chunk.content);
                output.activeToolName = tool_name;
                if (tool_use_id && elapsed_seconds !== undefined) {
                  mutateToolById(output, tool_use_id, (a) => {
                    a.elapsed_seconds = elapsed_seconds;
                  });
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
                output.subagentActivities.push(subagent);
                output.contentBlocks.push({ type: "subagent", activity: { ...subagent } });
              } catch {
                // ignore
              }
              break;
            }
            case "subagent_progress": {
              try {
                const { task_id, summary, last_tool_name, usage } = JSON.parse(chunk.content);
                const sa = output.subagentActivities.find((s) => s.task_id === task_id);
                if (sa) Object.assign(sa, { summary, last_tool_name, usage });
                for (const b of output.contentBlocks) {
                  if (b.type === "subagent" && b.activity.task_id === task_id) {
                    Object.assign(b.activity, { summary, last_tool_name, usage });
                  }
                }
              } catch {
                // ignore
              }
              break;
            }
            case "subagent_complete": {
              try {
                const { task_id, status, summary, usage } = JSON.parse(chunk.content);
                const sa = output.subagentActivities.find((s) => s.task_id === task_id);
                if (sa) Object.assign(sa, { status, summary, usage });
                for (const b of output.contentBlocks) {
                  if (b.type === "subagent" && b.activity.task_id === task_id) {
                    Object.assign(b.activity, { status, summary, usage });
                  }
                }
              } catch {
                // ignore
              }
              break;
            }
            case "files_changed": {
              try {
                const { files } = JSON.parse(chunk.content);
                if (Array.isArray(files)) {
                  const existing = new Set(output.filesChanged.map((f) => f.filename));
                  for (const f of files as { filename: string }[]) {
                    if (!existing.has(f.filename)) {
                      output.filesChanged.push({ filename: f.filename });
                    }
                  }
                }
              } catch {
                // ignore
              }
              break;
            }
            case "tool_use_summary": {
              try {
                const { summary, tool_ids } = JSON.parse(chunk.content);
                output.toolUseSummaries.push({ summary, toolIds: tool_ids ?? [] });
                if (Array.isArray(tool_ids) && tool_ids.length > 0) {
                  for (const b of output.contentBlocks) {
                    if (
                      b.type === "tool_group" &&
                      b.activities.some((a) => tool_ids.includes(a.tool_id))
                    ) {
                      b.summaryText = summary;
                    }
                  }
                }
              } catch {
                // ignore
              }
              break;
            }
            case "compact_boundary": {
              try {
                const { pre_tokens } = JSON.parse(chunk.content);
                output.contextUsage = {
                  ...(output.contextUsage ?? defaultContextUsage()),
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
                output.contextUsage = {
                  ...(output.contextUsage ?? defaultContextUsage()),
                  rateLimitUtilization: utilization,
                  rateLimitStatus: status,
                };
              } catch {
                /* ignore */
              }
              break;
            }
            case "compacting": {
              output.isCompacting = chunk.content === "true";
              break;
            }
            case "thinking": {
              output.thinkingContent += chunk.content;
              appendToLastBlock(output, "thinking", chunk.content);
              output.lastChunkType = "thinking";
              break;
            }
            case "stderr":
              output.stderrLines.push(chunk.content);
              break;
            case "result":
              output.resultContent = chunk.content;
              break;
            case "supervisor_evaluating":
              output.supervisorEvaluating = true;
              break;
            case "supervisor_reply":
              output.contentBlocks.push({ type: "supervisor_reply", content: chunk.content });
              output.lastChunkType = "supervisor_reply";
              break;
            case "error":
              output.stderrLines.push(`[error] ${chunk.content}`);
              break;
            // Unknown chunk types — no-op (produce returns unchanged draft)
          }
        }),
      );
    },

    getStepOutput: (issueId: string, stepId: string) => {
      return get().stepOutputs[`${issueId}:${stepId}`];
    },

    clearStepOutputs: () => {
      set({ stepOutputs: {} });
    },
  }),
);
