/**
 * Maps SidecarConfig (from Rust) to Agent SDK query() options.
 */

import type { SidecarConfig } from "./protocol.js";
import type { AgentConfig } from "./types.js";

/**
 * Convert protocol config to internal AgentConfig.
 */
export function parseAgentConfig(config: SidecarConfig): AgentConfig {
  return {
    projectDir: config.project_dir,
    systemPrompt: config.system_prompt,
    allowedTools: config.allowed_tools ?? getDefaultAllowedTools(),
    disallowedTools: config.disallowed_tools,
    sessionId: config.session_id,
    maxTurns: config.max_turns ?? 200,
    model: config.model,
    bdBinaryPath: config.bd_binary_path,
  };
}

function getDefaultAllowedTools(): string[] {
  return [
    "mcp__beads",
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
  ];
}

/**
 * Build the system prompt append text from agent config.
 * The base is Claude Code's preset prompt; we append workflow-specific context.
 */
export function buildSystemPromptAppend(config: AgentConfig): string {
  const parts: string[] = [];

  if (config.systemPrompt) {
    parts.push(config.systemPrompt);
  }

  parts.push(`\n## MeldUI Context\n`);
  parts.push(`You are operating inside MeldUI, a visual workflow tool for software development.`);
  parts.push(`Working directory: ${config.projectDir}`);
  parts.push(`You have access to Beads issue tracking via MCP tools (mcp__beads__*).`);
  parts.push(`Use beads tools to read and update ticket fields as you work.`);

  return parts.join("\n");
}
