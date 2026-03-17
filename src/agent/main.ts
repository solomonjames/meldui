/**
 * Agent sidecar entry point.
 *
 * Communication protocol:
 *   stdin  (Rust → sidecar): NDJSON commands
 *   stdout (sidecar → Rust): NDJSON events
 *
 * First stdin line is the execute command with prompt + config.
 * Subsequent stdin lines are permission responses or cancel commands.
 */

import { ClaudeAgent } from "./claude-agent.js";
import { parseAgentConfig } from "./config.js";
import type {
  InboundMessage,
  OutboundMessage,
  ExecuteCommand,
} from "./protocol.js";
import type { PermissionRequestEvent, FeedbackRequestEvent, ReviewRequestEvent, ReviewSubmissionData } from "./types.js";

// ── Output ──

function send(msg: OutboundMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// ── Permission tracking ──

const pendingPermissions = new Map<
  string,
  (result: "allow" | "always-allow" | "deny") => void
>();

// ── Feedback tracking ──

const pendingFeedback = new Map<
  string,
  (response: { approved: boolean; feedback?: string }) => void
>();

// ── Review tracking ──

const pendingReviews = new Map<
  string,
  (submission: ReviewSubmissionData) => void
>();

// ── Stdin reader ──

async function* readLines(): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        yield line.trim();
      }
    }
  }
  if (buffer.trim()) {
    yield buffer.trim();
  }
}

// ── Main ──

async function main(): Promise<void> {
  const lineReader = readLines();

  // Read first line: execute command
  const firstLine = await lineReader.next();
  if (firstLine.done || !firstLine.value) {
    send({ type: "error", message: "No input received on stdin" });
    process.exit(1);
  }

  let executeCmd: ExecuteCommand;
  try {
    const parsed = JSON.parse(firstLine.value) as InboundMessage;
    if (parsed.type !== "execute") {
      send({ type: "error", message: `Expected 'execute' command, got '${parsed.type}'` });
      process.exit(1);
    }
    executeCmd = parsed;
  } catch (err) {
    send({ type: "error", message: `Failed to parse initial command: ${err}` });
    process.exit(1);
  }

  const config = parseAgentConfig(executeCmd.config);
  const agent = new ClaudeAgent(send);

  // ── Wire agent events to stdout NDJSON ──

  agent.on("chat-session", ({ sessionId }) => {
    send({ type: "session", session_id: sessionId });
  });

  agent.on("chat-agent-message", ({ content }) => {
    send({ type: "text", content });
  });

  agent.on("tool-use-start", ({ name, id }) => {
    send({ type: "tool_start", tool_name: name, tool_id: id });
  });

  agent.on("tool-input-delta", ({ id, partialJson }) => {
    send({ type: "tool_input", tool_id: id, content: partialJson });
  });

  agent.on("tool-use-end", ({ id }) => {
    send({ type: "tool_end", tool_id: id });
  });

  agent.on("chat-tool-result", ({ toolUseId, content, isError }) => {
    send({
      type: "tool_result",
      tool_id: toolUseId,
      content,
      is_error: isError,
    });
  });

  agent.on("thinking-update", ({ text }) => {
    send({ type: "thinking", content: text });
  });

  agent.on("permission-request", (event: PermissionRequestEvent) => {
    pendingPermissions.set(event.requestId, event.resolve);
    send({
      type: "permission_request",
      request_id: event.requestId,
      tool_name: event.toolName,
      input: event.input,
    });
  });

  agent.on("feedback-request", (event: FeedbackRequestEvent) => {
    pendingFeedback.set(event.requestId, event.resolve);
    send({
      type: "feedback_request",
      request_id: event.requestId,
      ticket_id: event.ticketId,
      summary: event.summary,
    });
  });

  agent.on("review-request", (event: ReviewRequestEvent) => {
    pendingReviews.set(event.requestId, event.resolve);
    send({
      type: "review_findings",
      request_id: event.requestId,
      ticket_id: event.ticketId,
      findings: event.findings,
      summary: event.summary,
    });
  });

  agent.on("completed", ({ response, sessionId }) => {
    send({ type: "result", content: response, session_id: sessionId });
  });

  agent.on("failed", ({ message }) => {
    send({ type: "error", message });
  });

  agent.on("stopped", () => {
    send({ type: "result", content: "", session_id: "" });
  });

  // ── Listen for stdin commands (permission responses, cancel) ──
  // Runs concurrently with execute — handles permission responses and cancel.

  void (async () => {
    for await (const line of lineReader) {
      try {
        const msg = JSON.parse(line) as InboundMessage;

        switch (msg.type) {
          case "permission_response": {
            const resolve = pendingPermissions.get(msg.request_id);
            if (resolve) {
              resolve(msg.allowed ? "allow" : "deny");
              pendingPermissions.delete(msg.request_id);
            }
            break;
          }
          case "feedback_response": {
            const resolve = pendingFeedback.get(msg.request_id);
            if (resolve) {
              resolve({ approved: msg.approved, feedback: msg.feedback });
              pendingFeedback.delete(msg.request_id);
            }
            break;
          }
          case "review_response": {
            const resolve = pendingReviews.get(msg.request_id);
            if (resolve) {
              resolve(msg.submission);
              pendingReviews.delete(msg.request_id);
            }
            break;
          }
          case "cancel": {
            agent.stop();
            break;
          }
        }
      } catch {
        // Ignore malformed stdin lines
      }
    }
  })();

  // ── Execute ──

  try {
    await agent.execute(executeCmd.prompt, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[main-catch] Unhandled execute error: ${message}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(`[main-stack] ${err.stack}\n`);
    }
    send({ type: "error", message });
  }

  // Ensure all stdout is flushed before exiting
  if (process.stdout.writableNeedDrain) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  }
  process.exit(0);
}

main().catch((err) => {
  send({ type: "error", message: `Fatal: ${err}` });
  process.exit(1);
});
