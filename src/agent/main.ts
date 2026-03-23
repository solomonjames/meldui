/**
 * Agent sidecar entry point.
 *
 * Communication protocol:
 *   Unix domain socket with JSON-RPC 2.0 (newline-delimited)
 *   Sidecar = socket server, Rust = socket client
 *
 * Lifecycle:
 *   1. Sidecar creates Unix socket server at $TMPDIR/meldui-sidecar-<pid>.sock
 *   2. Prints SOCKET_PATH=<path> to stdout (only stdout use)
 *   3. Rust connects as client
 *   4. Bidirectional JSON-RPC: Rust sends query/cancel, sidecar sends notifications/requests
 */

import { createServer, type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { JSONRPCServerAndClient, JSONRPCServer, JSONRPCClient } from "json-rpc-2.0";
import { ClaudeAgent } from "./claude-agent.js";
import { parseAgentConfig } from "./config.js";
import type {
  QueryParams,
  QueryResult,
  CancelResult,
  ToolApprovalResult,
  ReviewRequestResult,
  MessageNotificationParams,
  OutboundMessage,
} from "./protocol.js";
import { METHOD_NAMES } from "./protocol.js";
import type { PermissionRequestEvent, ReviewRequestEvent, ReviewSubmissionData } from "./types.js";

// ── Socket path ──

const SOCKET_PATH = join(tmpdir(), `meldui-sidecar-${process.pid}.sock`);

// ── Cleanup ──

function cleanup(): void {
  try {
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  } catch {
    // Ignore cleanup errors
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", cleanup);

// ── ppid watchdog — detect orphan if parent dies ──

const originalPpid = process.ppid;
const ppidWatchdog = setInterval(() => {
  if (process.ppid !== originalPpid) {
    process.stderr.write("[sidecar] Parent process died (ppid changed), exiting\n");
    cleanup();
    process.exit(1);
  }
}, 2000);
ppidWatchdog.unref();

// ── Main ──

let activeAgent: ClaudeAgent | null = null;

async function main(): Promise<void> {
  // Clean up stale socket if it exists (from previous crash)
  cleanup();

  const server = createServer();

  server.listen(SOCKET_PATH, () => {
    // Socket is ready — announce path to Rust
    process.stdout.write(`SOCKET_PATH=${SOCKET_PATH}\n`);
  });

  // Wait for single client connection
  const socket = await new Promise<Socket>((resolve, reject) => {
    server.once("connection", (conn) => {
      // Single-connection enforcement: close listener after first connection
      server.close();
      resolve(conn);
    });
    server.once("error", reject);
  });

  // ── JSON-RPC setup ──

  let sendBuffer = "";

  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((request) => {
      const json = JSON.stringify(request) + "\n";
      return new Promise<void>((resolve, reject) => {
        socket.write(json, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    })
  );

  // ── Wire socket data to JSON-RPC ──

  socket.on("data", (chunk) => {
    sendBuffer += chunk.toString();
    const lines = sendBuffer.split("\n");
    sendBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          rpc.receiveAndSend(message);
        } catch (err) {
          process.stderr.write(`[sidecar] Failed to parse JSON-RPC message: ${err}\n`);
        }
      }
    }
  });

  socket.on("close", () => {
    process.stderr.write("[sidecar] Socket closed by client\n");
    rpc.rejectAllPendingRequests("Connection closed");
    cleanup();
    process.exit(0);
  });

  socket.on("error", (err) => {
    process.stderr.write(`[sidecar] Socket error: ${err.message}\n`);
  });

  // ── Helper: send notification ──

  function notify(method: string, params: unknown): void {
    rpc.notify(method, params);
  }

  function sendMessage(msg: OutboundMessage): void {
    notify(METHOD_NAMES.message, msg);
  }

  // ── Register JSON-RPC methods (Rust → Sidecar) ──

  rpc.addMethod(METHOD_NAMES.query, async (params: QueryParams): Promise<QueryResult> => {
    const config = parseAgentConfig(params.config);
    const agent = new ClaudeAgent(sendMessage);
    activeAgent = agent;

    // ── Wire agent events to JSON-RPC notifications ──

    agent.on("chat-session", ({ sessionId }) => {
      sendMessage({ type: "session", session_id: sessionId });
    });

    agent.on("chat-agent-message", ({ content }) => {
      sendMessage({ type: "text", content });
    });

    agent.on("tool-use-start", ({ name, id }) => {
      sendMessage({ type: "tool_start", tool_name: name, tool_id: id });
    });

    agent.on("tool-input-delta", ({ id, partialJson }) => {
      sendMessage({ type: "tool_input", tool_id: id, content: partialJson });
    });

    agent.on("tool-use-end", ({ id }) => {
      sendMessage({ type: "tool_end", tool_id: id });
    });

    agent.on("chat-tool-result", ({ toolUseId, content, isError }) => {
      sendMessage({ type: "tool_result", tool_id: toolUseId, content, is_error: isError });
    });

    agent.on("thinking-update", ({ text }) => {
      sendMessage({ type: "thinking", content: text });
    });

    agent.on("tool-progress", ({ toolUseId, toolName, elapsedSeconds }) => {
      sendMessage({ type: "tool_progress", tool_use_id: toolUseId, tool_name: toolName, elapsed_seconds: elapsedSeconds });
    });

    agent.on("tool-use-summary", ({ summary, toolIds }) => {
      sendMessage({ type: "tool_use_summary", summary, tool_ids: toolIds });
    });

    agent.on("subagent-start", ({ taskId, toolUseId, description }) => {
      sendMessage({ type: "subagent_start", task_id: taskId, tool_use_id: toolUseId, description });
    });

    agent.on("subagent-progress", ({ taskId, summary, lastToolName, usage }) => {
      sendMessage({ type: "subagent_progress", task_id: taskId, summary, last_tool_name: lastToolName, usage });
    });

    agent.on("subagent-complete", ({ taskId, status, summary, usage }) => {
      sendMessage({ type: "subagent_complete", task_id: taskId, status, summary, usage });
    });

    agent.on("files-persisted", ({ files }) => {
      sendMessage({ type: "files_changed", files });
    });

    agent.on("status-change", ({ isCompacting }) => {
      sendMessage({ type: "compacting", is_compacting: isCompacting });
    });

    agent.on("permission-request", (event: PermissionRequestEvent) => {
      // Send JSON-RPC request to Rust with heartbeats while awaiting response
      const heartbeat = setInterval(() => {
        sendMessage({ type: "heartbeat" });
      }, 30_000);

      rpc.request(METHOD_NAMES.toolApproval, {
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
      } satisfies Record<string, unknown>)
        .then((result: ToolApprovalResult) => {
          event.resolve(result.decision);
        })
        .catch((err) => {
          process.stderr.write(`[sidecar] toolApproval request failed: ${err}\n`);
          event.resolve("deny");
        })
        .finally(() => {
          clearInterval(heartbeat);
        });
    });

    agent.on("review-request", (event: ReviewRequestEvent) => {
      const heartbeat = setInterval(() => {
        sendMessage({ type: "heartbeat" });
      }, 30_000);

      rpc.request(METHOD_NAMES.reviewRequest, {
        requestId: event.requestId,
        ticketId: event.ticketId,
        findings: event.findings,
        summary: event.summary,
      } satisfies Record<string, unknown>)
        .then((result: ReviewRequestResult) => {
          event.resolve(result.submission);
        })
        .catch((err) => {
          process.stderr.write(`[sidecar] reviewRequest failed: ${err}\n`);
          event.resolve({
            action: "approve",
            summary: "Review failed due to communication error",
            comments: [],
            finding_actions: [],
          });
        })
        .finally(() => {
          clearInterval(heartbeat);
        });
    });

    // ── Wire completion events BEFORE launching execute ──
    // These must be registered first to avoid a race where execute()
    // completes before listeners are attached.
    agent.on("completed", ({ response, sessionId }) => {
      notify(METHOD_NAMES.queryComplete, { sessionId, response });
    });

    agent.on("failed", ({ message }) => {
      notify(METHOD_NAMES.queryError, { message });
    });

    agent.on("stopped", () => {
      notify(METHOD_NAMES.queryComplete, { sessionId: "", response: "" });
    });

    // Launch agent execution in detached async task
    void (async () => {
      try {
        await agent.execute(params.prompt, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[sidecar] Unhandled execute error: ${message}\n`);
        notify(METHOD_NAMES.queryError, { message });
      }
    })();

    return { status: "started" as const };
  });

  rpc.addMethod(METHOD_NAMES.cancel, async (): Promise<CancelResult> => {
    if (activeAgent) {
      activeAgent.stop();
    }
    return { status: "cancelled" as const };
  });

  // Keep process alive while socket is open
  await new Promise<void>((resolve) => {
    socket.on("close", resolve);
  });
}

main().catch((err) => {
  process.stderr.write(`[sidecar] Fatal: ${err}\n`);
  cleanup();
  process.exit(1);
});
