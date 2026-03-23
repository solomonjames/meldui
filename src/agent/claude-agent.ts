/**
 * ClaudeAgent — wraps the Claude Agent SDK's query() function
 * and emits typed events for the sidecar to translate to NDJSON.
 *
 * Modeled on Pencil's @ha/agent/src/claude/index.ts.
 */

import EventEmitter from "eventemitter3";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createMelduiMcpServer, type ReviewSubmissionResponse, type ReviewFinding } from "./mcp/meldui-server.js";
import { buildSystemPromptAppend } from "./config.js";
import type { AgentConfig, MeldAgentEvents, MeldAgent } from "./types.js";
import type { OutboundMessage } from "./protocol.js";
import { resolve, isAbsolute } from "path";
import { existsSync } from "fs";

function findClaudeBinary(): string | undefined {
  const home = process.env.HOME ?? "";
  const candidates = [
    `${home}/.claude/bin/claude`,
    `${home}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return undefined;
}

export class ClaudeAgent
  extends EventEmitter<MeldAgentEvents>
  implements MeldAgent
{
  private abortController: AbortController | null = null;
  private agentQuery: ReturnType<typeof query> | null = null;
  private sendFn: (msg: OutboundMessage) => void;
  /** Maps content block index → real tool_use_id for stream events */
  private blockIndexToToolId = new Map<number, string>();

  constructor(send: (msg: OutboundMessage) => void) {
    super();
    this.sendFn = send;
  }

  async execute(prompt: string, config: AgentConfig): Promise<void> {
    this.abortController = new AbortController();

    const emitReviewRequest = (ticketId: string, findings: ReviewFinding[], summary: string): Promise<ReviewSubmissionResponse> => {
      const requestId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve) => {
        this.emit("review-request", { requestId, ticketId, findings, summary, resolve });
      });
    };

    const melduiMcpServer = createMelduiMcpServer(config.projectDir, this.sendFn, emitReviewRequest, config.ticketsDir);

    const systemPromptAppend = buildSystemPromptAppend(config);

    // Find claude binary — inside a compiled Bun binary, SDK auto-detection fails
    const claudePath = findClaudeBinary();
    if (claudePath) {
      process.stderr.write(`[agent] Found claude binary: ${claudePath}\n`);
    } else {
      process.stderr.write(`[agent] No claude binary found, falling back to SDK auto-detect\n`);
    }

    // Build query options
    const options: Record<string, unknown> = {
      cwd: config.projectDir,
      model: config.model,
      maxTurns: config.maxTurns,
      tools: config.allowedTools,           // Restrict available tool set
      allowedTools: config.allowedTools,    // Auto-allow them for permissions
      disallowedTools: config.disallowedTools,
      permissionMode: "bypassPermissions",  // Sidecar is headless; we handle via canUseTool
      allowDangerouslySkipPermissions: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: systemPromptAppend,
      },
      mcpServers: {
        meldui: melduiMcpServer,
      },
      abortController: this.abortController,
      // Enable streaming events for progressive UI updates
      includePartialMessages: true,
      // Tell SDK where to find the claude binary (critical inside compiled Bun binaries)
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      // Capture SDK stderr for debugging
      stderr: (data: string) => {
        process.stderr.write(`[claude-sdk-stderr] ${data}\n`);
      },
      // Load user's Claude settings
      settingSources: ["local", "project", "user"],
      // Permission callback — auto-allow safe operations, ask for others
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        toolOptions: Record<string, unknown>
      ) => {
        return this.handlePermission(toolName, input, toolOptions, config);
      },
    };

    // Session resumption
    if (config.sessionId) {
      options.resume = config.sessionId;
    }

    let sessionId = "";
    let resultText = "";
    let emittedFailure = false;

    try {
      this.agentQuery = query({ prompt, options: options as never });

      for await (const message of this.agentQuery) {
        if (this.abortController?.signal.aborted) break;

        // Handle different message types
        const msg = message as Record<string, unknown>;

        // Final result — handles both SDKResultSuccess and SDKResultError
        if (msg.type === "result") {
          const resultMsg = msg as {
            type: "result";
            subtype?: string;
            result?: string;
            errors?: string[];
            session_id?: string;
          };
          if (resultMsg.subtype === "success") {
            resultText = resultMsg.result ?? "";
          } else {
            // SDKResultError — extract error info
            const errors = resultMsg.errors ?? [];
            resultText = "";
            emittedFailure = true;
            this.emit("failed", {
              message: `Agent ended with ${resultMsg.subtype ?? "error"}: ${errors.join(", ") || "unknown error"}`,
            });
          }
          sessionId = resultMsg.session_id ?? sessionId;
          continue;
        }

        const msgType = msg.type as string;

        switch (msgType) {
          case "system": {
            if (msg.subtype === "init") {
              sessionId = msg.session_id as string;
              this.emit("chat-session", { sessionId });
              // Emit init metadata for the frontend
              this.emit("init-metadata", {
                model: (msg as Record<string, unknown>).model as string ?? "unknown",
                available_models: ["claude-opus-4-6-1m", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
                tools: Array.isArray((msg as Record<string, unknown>).tools)
                  ? ((msg as Record<string, unknown>).tools as Array<{ name: string }>).map(t => t.name)
                  : [],
                slash_commands: Array.isArray((msg as Record<string, unknown>).slash_commands)
                  ? (msg as Record<string, unknown>).slash_commands as string[]
                  : [],
                skills: Array.isArray((msg as Record<string, unknown>).skills)
                  ? (msg as Record<string, unknown>).skills as string[]
                  : [],
                mcp_servers: Array.isArray((msg as Record<string, unknown>).mcp_servers)
                  ? ((msg as Record<string, unknown>).mcp_servers as Array<{ name: string; status: string }>).map(s => ({
                      name: s.name,
                      status: s.status,
                    }))
                  : [],
              });
            }
            break;
          }

          case "assistant": {
            // Clear block index map for each new assistant turn
            this.blockIndexToToolId.clear();
            const assistantMsg = msg.message as Record<string, unknown> | undefined;
            if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
              for (const block of assistantMsg.content) {
                const blockObj = block as Record<string, unknown>;
                if (blockObj.type === "tool_use") {
                  this.emit("chat-tool-use", {
                    toolName: blockObj.name as string,
                    toolInput: blockObj.input as Record<string, unknown>,
                    toolUseId: blockObj.id as string,
                  });
                }
                // Note: text blocks are NOT emitted here — they arrive as
                // stream_event content_block_delta text_delta instead.
                // Emitting from both causes duplicate text in the UI.
              }
            }
            break;
          }

          case "user": {
            const userMsg = msg.message as Record<string, unknown> | undefined;
            if (userMsg?.content && Array.isArray(userMsg.content)) {
              for (const block of userMsg.content) {
                const blockObj = block as Record<string, unknown>;
                if (blockObj.type === "tool_result") {
                  const content = Array.isArray(blockObj.content)
                    ? (blockObj.content as Record<string, unknown>[])
                        .map((c) => c.text ?? "")
                        .join("")
                    : String(blockObj.content ?? "");
                  this.emit("chat-tool-result", {
                    toolUseId: blockObj.tool_use_id as string,
                    content,
                    isError: blockObj.is_error === true,
                  });
                }
              }
            }
            break;
          }

          case "stream_event": {
            this.handleStreamEvent(msg);
            break;
          }

          case "tool_progress": {
            const toolMsg = msg as { tool_use_id?: string; tool_name?: string; elapsed_time_seconds?: number };
            if (toolMsg.tool_use_id) {
              this.emit("tool-progress", {
                toolUseId: toolMsg.tool_use_id,
                toolName: toolMsg.tool_name ?? "unknown",
                elapsedSeconds: toolMsg.elapsed_time_seconds ?? 0,
              });
            }
            break;
          }

          case "tool_use_summary": {
            const summaryMsg = msg as { summary?: string; preceding_tool_use_ids?: string[] };
            if (summaryMsg.summary) {
              this.emit("tool-use-summary", {
                summary: summaryMsg.summary,
                toolIds: summaryMsg.preceding_tool_use_ids ?? [],
              });
            }
            break;
          }

          case "compact_boundary": {
            const cbMsg = msg as Record<string, unknown>;
            this.sendFn({
              type: "compact_boundary",
              pre_tokens: (cbMsg.pre_tokens as number) ?? 0,
              trigger: (cbMsg.trigger as string) ?? "auto",
            });
            break;
          }

          case "rate_limit": {
            const rlMsg = msg as Record<string, unknown>;
            this.sendFn({
              type: "rate_limit",
              status: (rlMsg.status as string) ?? "ok",
              utilization: (rlMsg.utilization as number) ?? 0,
              resets_at: rlMsg.resets_at as string | undefined,
            });
            break;
          }
        }

        // Handle system subtypes (subagent lifecycle, files_persisted, status)
        if (msgType === "system") {
          const subtype = msg.subtype as string | undefined;
          switch (subtype) {
            case "task_started": {
              const taskMsg = msg as { task_id?: string; tool_use_id?: string; description?: string };
              if (taskMsg.task_id) {
                this.emit("subagent-start", {
                  taskId: taskMsg.task_id,
                  toolUseId: taskMsg.tool_use_id,
                  description: taskMsg.description ?? "",
                });
              }
              break;
            }
            case "task_progress": {
              const taskMsg = msg as { task_id?: string; summary?: string; last_tool_name?: string; usage?: unknown };
              if (taskMsg.task_id) {
                this.emit("subagent-progress", {
                  taskId: taskMsg.task_id,
                  summary: taskMsg.summary,
                  lastToolName: taskMsg.last_tool_name,
                  usage: taskMsg.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined,
                });
              }
              break;
            }
            case "task_notification": {
              const taskMsg = msg as { task_id?: string; status?: string; summary?: string; usage?: unknown };
              if (taskMsg.task_id) {
                this.emit("subagent-complete", {
                  taskId: taskMsg.task_id,
                  status: (taskMsg.status ?? "completed") as "completed" | "failed" | "stopped",
                  summary: taskMsg.summary,
                  usage: taskMsg.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined,
                });
              }
              break;
            }
            case "files_persisted": {
              const filesMsg = msg as { files?: Array<{ filename: string }> };
              if (filesMsg.files && filesMsg.files.length > 0) {
                this.emit("files-persisted", {
                  files: filesMsg.files.map((f) => ({ filename: f.filename })),
                });
              }
              break;
            }
            case "status": {
              const statusMsg = msg as { status?: string | null };
              this.emit("status-change", {
                isCompacting: statusMsg.status === "compacting",
              });
              break;
            }
          }
        }
      }

      if (!emittedFailure) {
        this.emit("completed", { response: resultText, sessionId });
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.emit("stopped");
      } else {
        // Extract as much detail as possible from the error
        let message = err instanceof Error ? err.message : String(err);
        const errObj = err as Record<string, unknown>;

        // Agent SDK subprocess errors may have stderr/stdout/exitCode
        if (errObj.stderr) message += `\nstderr: ${errObj.stderr}`;
        if (errObj.stdout) message += `\nstdout: ${errObj.stdout}`;
        if (errObj.exitCode !== undefined) message += `\nexitCode: ${errObj.exitCode}`;
        if (errObj.cause) message += `\ncause: ${errObj.cause}`;

        // Log full error to sidecar stderr (captured by Rust)
        process.stderr.write(`[agent-error] ${message}\n`);
        if (err instanceof Error && err.stack) {
          process.stderr.write(`[agent-stack] ${err.stack}\n`);
        }

        this.emit("failed", { message });
      }
    }
  }

  stop(): void {
    this.abortController?.abort();
  }

  private handleStreamEvent(msg: Record<string, unknown>): void {
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event) return;

    const eventType = event.type as string;

    switch (eventType) {
      case "content_block_start": {
        const contentBlock = event.content_block as Record<string, unknown> | undefined;
        const index = event.index as number;
        if (contentBlock?.type === "tool_use") {
          const toolId = contentBlock.id as string;
          this.blockIndexToToolId.set(index, toolId);
          this.emit("tool-use-start", {
            name: contentBlock.name as string,
            id: toolId,
          });
        }
        break;
      }

      case "content_block_delta": {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (!delta) break;

        const deltaType = delta.type as string;
        if (deltaType === "text_delta") {
          const text = delta.text as string;
          if (text) {
            this.emit("chat-agent-message", { content: text });
          }
        } else if (deltaType === "thinking_delta") {
          const thinking = delta.thinking as string;
          if (thinking) {
            this.emit("thinking-update", { text: thinking });
          }
        } else if (deltaType === "input_json_delta") {
          const partialJson = delta.partial_json as string;
          if (partialJson) {
            const index = event.index as number;
            const toolId = this.blockIndexToToolId.get(index) ?? String(index);
            this.emit("tool-input-delta", {
              id: toolId,
              partialJson,
            });
          }
        }
        break;
      }

      case "content_block_stop": {
        const index = event.index as number;
        const toolId = this.blockIndexToToolId.get(index) ?? String(index);
        this.emit("tool-use-end", { id: toolId });
        break;
      }
    }
  }

  private async handlePermission(
    toolName: string,
    input: Record<string, unknown>,
    _toolOptions: Record<string, unknown>,
    config: AgentConfig
  ): Promise<Record<string, unknown>> {
    // Auto-allow: all mcp__meldui tools
    if (toolName.startsWith("mcp__meldui")) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-allow: file operations inside project directory
    const filePath = input.file_path as string | undefined;
    if (filePath && config.projectDir) {
      const resolved = isAbsolute(filePath)
        ? filePath
        : resolve(config.projectDir, filePath);
      if (resolved.startsWith(config.projectDir)) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Auto-allow: Read, Glob, Grep (read-only operations)
    if (["Read", "Glob", "Grep", "WebSearch", "WebFetch"].includes(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    // Ask user: emit permission request and wait for response.
    // Emit heartbeats while waiting to keep the idle timeout alive.
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<Record<string, unknown>>((resolve) => {
      const heartbeat = setInterval(() => {
        this.sendFn({ type: "heartbeat" });
      }, 30_000);

      this.emit("permission-request", {
        requestId,
        toolName,
        input,
        resolve: (result: "allow" | "always-allow" | "deny") => {
          clearInterval(heartbeat);
          if (result === "allow") {
            resolve({ behavior: "allow", updatedInput: input });
          } else if (result === "always-allow") {
            resolve({ behavior: "allow", updatedInput: input });
          } else {
            resolve({ behavior: "deny", message: "User denied permission" });
          }
        },
      });
    });
  }
}
