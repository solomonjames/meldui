#!/usr/bin/env bun
/**
 * Bump the version across all project files.
 *
 * Usage:
 *   bun run version:bump 0.2.0
 *   bun run version:bump patch    # 0.1.0 → 0.1.1
 *   bun run version:bump minor    # 0.1.0 → 0.2.0
 *   bun run version:bump major    # 0.1.0 → 1.0.0
 *
 * Updates: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

const FILES = {
  packageJson: join(ROOT, "package.json"),
  tauriConf: join(ROOT, "src-tauri", "tauri.conf.json"),
  cargoToml: join(ROOT, "src-tauri", "Cargo.toml"),
};

function getCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync(FILES.packageJson, "utf-8"));
  return pkg.version;
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;

  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default:
      console.error(`Invalid version or bump type: ${bump}`);
      console.error("Use: major, minor, patch, or an explicit version (e.g., 0.2.0)");
      process.exit(1);
  }
}

function updateJson(filePath: string, newVersion: string) {
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  content.version = newVersion;
  writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
}

function updateCargoToml(filePath: string, newVersion: string) {
  let content = readFileSync(filePath, "utf-8");
  content = content.replace(
    /^version = ".*"$/m,
    `version = "${newVersion}"`
  );
  writeFileSync(filePath, content);
}

// --- Main ---

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun run version:bump <major|minor|patch|X.Y.Z>");
  process.exit(1);
}

const current = getCurrentVersion();
const next = bumpVersion(current, arg);

console.log(`Bumping version: ${current} → ${next}`);

updateJson(FILES.packageJson, next);
console.log(`  ✓ package.json`);

updateJson(FILES.tauriConf, next);
console.log(`  ✓ src-tauri/tauri.conf.json`);

updateCargoToml(FILES.cargoToml, next);
console.log(`  ✓ src-tauri/Cargo.toml`);

console.log(`\nDone. Run 'git diff' to review, then commit and tag:`);
console.log(`  git commit -am "chore: bump version to ${next}"`);
console.log(`  git tag v${next}`);
