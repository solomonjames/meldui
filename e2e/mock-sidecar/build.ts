/**
 * Build script — compiles the mock agent sidecar to a native binary.
 *
 * Output: src-tauri/binaries/agent-mock-{arch}-apple-darwin
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const target = `${arch}-apple-darwin`;
const outDir = join(dirname(import.meta.dir), "..", "src-tauri", "binaries");
const outFile = join(outDir, `agent-mock-${target}`);

// Ensure output directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log(`Building mock agent sidecar for ${target}...`);
console.log(`Output: ${outFile}`);

await $`bun build --compile --outfile ${outFile} ${join(import.meta.dir, "main.ts")}`;

console.log("Mock agent sidecar built successfully.");
