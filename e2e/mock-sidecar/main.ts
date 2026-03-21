/**
 * Mock agent sidecar — replays recorded fixtures over Unix socket + JSON-RPC 2.0
 * instead of calling Claude API.
 *
 * Usage:
 *   MOCK_FIXTURE_DIR=e2e/fixtures/spec-understand-happy ./agent-mock-*
 *
 * Creates a Unix socket server, announces SOCKET_PATH= on stdout,
 * then replays fixture NDJSON lines as JSON-RPC notifications.
 */

import { createServer, type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync, unlinkSync, existsSync } from "fs";

const FIXTURE_DIR = process.env.MOCK_FIXTURE_DIR;
if (!FIXTURE_DIR) {
  process.stderr.write("mock-sidecar: MOCK_FIXTURE_DIR env var not set\n");
  process.exit(1);
}

const SOCKET_PATH = join(tmpdir(), `meldui-sidecar-${process.pid}.sock`);

function cleanup(): void {
  try {
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  } catch {
    // Ignore
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

// ── JSON-RPC helpers ──

let rpcIdCounter = 1;

function jsonRpcNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

function jsonRpcResponse(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonRpcRequest(method: string, params: unknown): { id: number; json: string } {
  const id = rpcIdCounter++;
  return {
    id,
    json: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  };
}

// ── Main ──

async function main(): Promise<void> {
  cleanup();

  const server = createServer();

  server.listen(SOCKET_PATH, () => {
    process.stdout.write(`SOCKET_PATH=${SOCKET_PATH}\n`);
  });

  const socket = await new Promise<Socket>((resolve, reject) => {
    server.once("connection", (conn) => {
      server.close();
      resolve(conn);
    });
    server.once("error", reject);
  });

  // ── Wait for `query` JSON-RPC request ──

  let recvBuffer = "";
  const pendingResponses = new Map<number, (result: unknown) => void>();

  const queryParams = await new Promise<{ prompt: string; config: unknown }>((resolve) => {
    socket.on("data", (chunk) => {
      recvBuffer += chunk.toString();
      const lines = recvBuffer.split("\n");
      recvBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Handle JSON-RPC request from Rust
          if (msg.method === "query" && msg.id != null) {
            // Send immediate response
            socket.write(jsonRpcResponse(msg.id, { status: "started" }) + "\n");
            resolve(msg.params);
          } else if (msg.method === "cancel" && msg.id != null) {
            socket.write(jsonRpcResponse(msg.id, { status: "cancelled" }) + "\n");
            cleanup();
            process.exit(0);
          }
          // Handle JSON-RPC response (to our reverse requests)
          if (msg.id != null && msg.result != null && !msg.method) {
            const resolver = pendingResponses.get(msg.id);
            if (resolver) {
              resolver(msg.result);
              pendingResponses.delete(msg.id);
            }
          }
        } catch {
          // Ignore
        }
      }
    });
  });

  process.stderr.write(
    `mock-sidecar: received query prompt="${(queryParams.prompt ?? "").slice(0, 80)}..."\n`
  );

  // ── Replay fixture ──

  const fixturePath = join(FIXTURE_DIR!, "output.ndjson");
  let fixtureContent: string;
  try {
    fixtureContent = readFileSync(fixturePath, "utf-8");
  } catch {
    socket.write(
      jsonRpcNotification("queryError", { message: `Failed to read fixture: ${fixturePath}` }) + "\n"
    );
    cleanup();
    process.exit(1);
  }

  const fixtureLines = fixtureContent.split("\n").filter((l) => l.trim());

  for (const line of fixtureLines) {
    try {
      const obj = JSON.parse(line);
      const msgType = obj.type;

      // Permission requests become JSON-RPC reverse requests
      if (msgType === "permission_request") {
        const req = jsonRpcRequest("toolApproval", {
          requestId: obj.request_id,
          toolName: obj.tool_name,
          input: obj.input,
        });
        socket.write(req.json + "\n");
        // Wait for response
        await new Promise<void>((resolve) => {
          pendingResponses.set(req.id, () => resolve());
        });
      } else if (msgType === "feedback_request") {
        const req = jsonRpcRequest("feedbackRequest", {
          requestId: obj.request_id,
          ticketId: obj.ticket_id,
          summary: obj.summary,
        });
        socket.write(req.json + "\n");
        await new Promise<void>((resolve) => {
          pendingResponses.set(req.id, () => resolve());
        });
      } else if (msgType === "review_findings") {
        const req = jsonRpcRequest("reviewRequest", {
          requestId: obj.request_id,
          ticketId: obj.ticket_id,
          findings: obj.findings,
          summary: obj.summary,
        });
        socket.write(req.json + "\n");
        await new Promise<void>((resolve) => {
          pendingResponses.set(req.id, () => resolve());
        });
      } else if (msgType === "result") {
        // Send as queryComplete notification
        socket.write(
          jsonRpcNotification("queryComplete", {
            sessionId: obj.session_id ?? "",
            response: obj.content ?? "",
          }) + "\n"
        );
      } else if (msgType === "error") {
        socket.write(
          jsonRpcNotification("queryError", { message: obj.message ?? "Unknown error" }) + "\n"
        );
      } else {
        // All other messages become `message` notifications
        socket.write(jsonRpcNotification("message", obj) + "\n");
      }
    } catch {
      // Skip malformed fixture lines
    }

    // Small delay to simulate streaming
    await Bun.sleep(20);
  }

  // If no explicit result/error in fixture, send queryComplete
  const hasResult = fixtureLines.some((l) => {
    try {
      const obj = JSON.parse(l);
      return obj.type === "result" || obj.type === "error";
    } catch {
      return false;
    }
  });
  if (!hasResult) {
    socket.write(
      jsonRpcNotification("queryComplete", { sessionId: "", response: "" }) + "\n"
    );
  }

  // Small delay then exit
  await Bun.sleep(100);
  socket.end();
  cleanup();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`mock-sidecar: fatal: ${err}\n`);
  cleanup();
  process.exit(1);
});
