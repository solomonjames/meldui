/**
 * Mock agent sidecar — replays recorded NDJSON fixtures
 * instead of calling Claude API.
 *
 * Usage:
 *   MOCK_FIXTURE_DIR=e2e/fixtures/spec-understand-happy ./agent-mock-*
 *
 * Reads first stdin line (ExecuteCommand), logs it to stderr,
 * then streams output.ndjson from the fixture directory to stdout.
 */

import { readFileSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = process.env.MOCK_FIXTURE_DIR;
if (!FIXTURE_DIR) {
  const msg = JSON.stringify({ type: "error", message: "MOCK_FIXTURE_DIR env var not set" });
  process.stdout.write(msg + "\n");
  process.exit(1);
}

// ── Read first stdin line (ExecuteCommand) ──

async function* readLines(): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line.trim();
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

async function main(): Promise<void> {
  const lineReader = readLines();

  // Read the execute command
  const first = await lineReader.next();
  if (first.done || !first.value) {
    process.stderr.write("mock-sidecar: no input received on stdin\n");
    process.exit(1);
  }

  try {
    const cmd = JSON.parse(first.value);
    process.stderr.write(`mock-sidecar: received command type=${cmd.type} prompt="${cmd.prompt?.slice(0, 80)}..."\n`);
  } catch {
    process.stderr.write(`mock-sidecar: failed to parse execute command\n`);
  }

  // ── Replay fixture ──

  const fixturePath = join(FIXTURE_DIR, "output.ndjson");
  let fixtureContent: string;
  try {
    fixtureContent = readFileSync(fixturePath, "utf-8");
  } catch (err) {
    const msg = JSON.stringify({ type: "error", message: `Failed to read fixture: ${fixturePath}` });
    process.stdout.write(msg + "\n");
    process.exit(1);
  }

  const lines = fixtureContent.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    process.stdout.write(line + "\n");
    // Small delay to simulate streaming (20ms between messages)
    await Bun.sleep(20);
  }

  // Drain remaining stdin (permission_response, cancel) — ignore them
  void (async () => {
    for await (const _line of lineReader) {
      // discard
    }
  })();

  // Ensure stdout is flushed
  if (process.stdout.writableNeedDrain) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  }

  process.exit(0);
}

main().catch((err) => {
  const msg = JSON.stringify({ type: "error", message: `Mock sidecar fatal: ${err}` });
  process.stdout.write(msg + "\n");
  process.exit(1);
});
