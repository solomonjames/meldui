import { existsSync } from "fs";

let cachedClaudePath: string | undefined;
let resolved = false;

/**
 * Find the claude CLI binary. Result is cached after first call
 * since the binary path doesn't change during the process lifetime.
 */
export function findClaudeBinary(): string | undefined {
  if (resolved) return cachedClaudePath;

  const home = process.env.HOME ?? "";
  const candidates = [
    `${home}/.claude/bin/claude`,
    `${home}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        cachedClaudePath = p;
        break;
      }
    } catch {}
  }

  resolved = true;
  return cachedClaudePath;
}
