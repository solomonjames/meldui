#!/usr/bin/env bun
/**
 * Verify that versions are in sync across all project files.
 * Exits with code 1 if any mismatch is found.
 *
 * Used by CI to prevent version drift.
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

function getJsonVersion(filePath: string): string {
  return JSON.parse(readFileSync(filePath, "utf-8")).version;
}

function getCargoVersion(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^version = "(.+)"$/m);
  if (!match) {
    console.error(`Could not find version in ${filePath}`);
    process.exit(1);
  }
  return match[1];
}

const versions: Record<string, string> = {
  "package.json": getJsonVersion(join(ROOT, "package.json")),
  "tauri.conf.json": getJsonVersion(join(ROOT, "src-tauri", "tauri.conf.json")),
  "Cargo.toml": getCargoVersion(join(ROOT, "src-tauri", "Cargo.toml")),
};

const values = Object.values(versions);
const allMatch = values.every((v) => v === values[0]);

if (allMatch) {
  console.log(`✓ All versions in sync: ${values[0]}`);
  process.exit(0);
} else {
  console.error("✗ Version mismatch detected:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version}`);
  }
  console.error("\nRun 'bun run version:bump <version>' to sync them.");
  process.exit(1);
}
