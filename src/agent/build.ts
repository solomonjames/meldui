/**
 * Build script — compiles the agent sidecar to a native binary
 * using Bun's --compile flag.
 *
 * Usage:
 *   bun run build.ts                        # builds for current arch
 *   bun run build.ts aarch64-apple-darwin   # cross-compile for Apple Silicon
 *   bun run build.ts x86_64-apple-darwin    # cross-compile for Intel
 *
 * Output: src-tauri/binaries/agent-{target-triple}
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// Target triple from CLI arg or detect from current arch
const targetArg = process.argv[2];
let target: string;
let bunTarget: string | undefined;

if (targetArg) {
  target = targetArg;
  const targetMap: Record<string, string> = {
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-apple-darwin": "bun-darwin-x64",
  };
  bunTarget = targetMap[target];
  if (!bunTarget) {
    console.error(`Unknown target triple: ${target}`);
    console.error(`Supported: ${Object.keys(targetMap).join(", ")}`);
    process.exit(1);
  }
} else {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  target = `${arch}-apple-darwin`;
}

const outDir = join(dirname(import.meta.dir), "..", "src-tauri", "binaries");
const outFile = join(outDir, `agent-${target}`);

// Ensure output directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log(`Building agent sidecar for ${target}...`);
console.log(`Output: ${outFile}`);

const args = ["build", "--compile", "--outfile", outFile, join(import.meta.dir, "main.ts")];
if (bunTarget) {
  args.splice(2, 0, "--target", bunTarget);
}

await $`bun ${args}`;

console.log("Agent sidecar built successfully.");
