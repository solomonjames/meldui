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
    ticketsDir: config.tickets_dir,
  };
}

function getDefaultAllowedTools(): string[] {
  return [
    "mcp__meldui",
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
  parts.push(`\n### MeldUI MCP Tools (mcp__meldui__*)\n`);
  parts.push(`You have access to app communication tools via the MeldUI MCP server:`);
  parts.push(`- **meldui_write_section(ticket_id, section, content)** — Write to a ticket field (design, notes, acceptance_criteria, description). The UI updates live.`);
  parts.push(`- **meldui_read_section(ticket_id, section)** — Read a ticket field before writing.`);
  parts.push(`- **meldui_ticket_show(ticket_id)** — Read the full ticket.`);
  parts.push(`- **meldui_step_complete(ticket_id, summary)** — Signal you are done with the current step.`);
  parts.push(`- **meldui_request_feedback(ticket_id, summary)** — Ask the user to approve your work or provide feedback. BLOCKS until the user responds. Use this after writing a deliverable — the user can iterate until satisfied.`);
  parts.push(`- **meldui_notify(title, message, level?)** — Push a toast notification to the app.`);
  parts.push(`- **meldui_show_status(ticket_id, status_text)** — Show transient progress text in the step header.`);
  parts.push(`\nWhen you produce a deliverable (spec section, investigation report, etc.), write it to the appropriate ticket field using meldui_write_section, then call meldui_request_feedback to let the user review and iterate. Once the user approves, call meldui_step_complete to advance.`);

  return parts.join("\n");
}
