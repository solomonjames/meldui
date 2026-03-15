/**
 * ClaudeAgent — wraps the Claude Agent SDK's query() function
 * and emits typed events for the sidecar to translate to NDJSON.
 *
 * Modeled on Pencil's @ha/agent/src/claude/index.ts.
 */

import EventEmitter from "eventemitter3";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createTicketMcpServer } from "./mcp/ticket-server.js";
import { buildSystemPromptAppend } from "./config.js";
import type { AgentConfig, MeldAgentEvents, MeldAgent } from "./types.js";
import { resolve, isAbsolute } from "path";

export class ClaudeAgent
  extends EventEmitter<MeldAgentEvents>
  implements MeldAgent
{
  private abortController: AbortController | null = null;
  private agentQuery: ReturnType<typeof query> | null = null;

  async execute(prompt: string, config: AgentConfig): Promise<void> {
    this.abortController = new AbortController();

    const ticketMcpServer = createTicketMcpServer(config.projectDir);

    const systemPromptAppend = buildSystemPromptAppend(config);

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
        tickets: ticketMcpServer,
      },
      abortController: this.abortController,
      // Enable streaming events for progressive UI updates
      includePartialMessages: true,
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
            }
            break;
          }

          case "assistant": {
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
                } else if (blockObj.type === "text") {
                  const text = blockObj.text as string;
                  if (text) {
                    this.emit("chat-agent-message", { content: text });
                  }
                }
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
        }
      }

      if (!emittedFailure) {
        this.emit("completed", { response: resultText, sessionId });
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.emit("stopped");
      } else {
        const message = err instanceof Error ? err.message : String(err);
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
        if (contentBlock?.type === "tool_use") {
          this.emit("tool-use-start", {
            name: contentBlock.name as string,
            id: contentBlock.id as string,
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
            // Find the current tool use block by index
            const index = event.index as number;
            // We track active tool IDs by index in the stream
            this.emit("tool-input-delta", {
              id: String(index),
              partialJson,
            });
          }
        }
        break;
      }

      case "content_block_stop": {
        const index = event.index as number;
        this.emit("tool-use-end", { id: String(index) });
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
    // Auto-allow: all mcp__tickets tools
    if (toolName.startsWith("mcp__tickets")) {
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

    // Ask user: emit permission request and wait for response
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<Record<string, unknown>>((resolve) => {
      this.emit("permission-request", {
        requestId,
        toolName,
        input,
        resolve: (result: "allow" | "always-allow" | "deny") => {
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
