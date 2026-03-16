/**
 * MeldUI MCP server — agent-to-app communication layer.
 *
 * Provides tools for the agent to:
 * - Write structured content to ticket fields (with live UI updates)
 * - Control workflow step progression
 * - Push notifications and status updates to the app
 *
 * Each tool that triggers a UI update calls `send()` to emit an NDJSON
 * event that flows: sidecar stdout → Rust → Tauri event → frontend.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { OutboundMessage } from "../protocol.js";

// ── Ticket file helpers ──

function ensureTicketsDir(projectDir: string): string {
  const dir = join(projectDir, ".meldui", "tickets");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readTicket(projectDir: string, id: string): Record<string, unknown> | null {
  const dir = ensureTicketsDir(projectDir);
  // Try exact ID match first, then scan for prefix match
  const exactPath = join(dir, `${id}.json`);
  if (existsSync(exactPath)) {
    return JSON.parse(readFileSync(exactPath, "utf-8"));
  }
  // Scan directory for files starting with the ID prefix
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const ticket = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (ticket.id === id) return ticket;
    } catch { /* skip malformed */ }
  }
  return null;
}

function writeTicket(projectDir: string, ticket: Record<string, unknown>): void {
  const dir = ensureTicketsDir(projectDir);
  const path = join(dir, `${ticket.id}.json`);
  writeFileSync(path, JSON.stringify(ticket, null, 2));
}

// ── MCP Server ──

const VALID_SECTIONS = ["design", "notes", "acceptance_criteria", "description"] as const;
type Section = (typeof VALID_SECTIONS)[number];

function isValidSection(s: string): s is Section {
  return (VALID_SECTIONS as readonly string[]).includes(s);
}

export type FeedbackResponse = { approved: boolean; feedback?: string };

export function createMelduiMcpServer(
  projectDir: string,
  send: (msg: OutboundMessage) => void,
  emitFeedbackRequest?: (ticketId: string, summary: string) => Promise<FeedbackResponse>,
) {
  // ── Ticket tools ──

  const writeSection = tool(
    "meldui_write_section",
    "Write content to a specific ticket field. Overwrites the field. The UI ticket context panel will update live.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      section: z.string().describe("Field to write: design, notes, acceptance_criteria, description"),
      content: z.string().describe("Content to write to the field"),
    },
    async ({ ticket_id, section, content }) => {
      if (!isValidSection(section)) {
        return { content: [{ type: "text" as const, text: `Invalid section: ${section}. Valid: ${VALID_SECTIONS.join(", ")}` }], isError: true };
      }
      const ticket = readTicket(projectDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      ticket[section] = content;
      ticket.updated_at = new Date().toISOString();
      writeTicket(projectDir, ticket);

      // Emit section_update so the frontend refreshes the ticket context panel
      send({ type: "section_update", ticket_id, section, content });

      return { content: [{ type: "text" as const, text: `Written to ${section} on ${ticket_id}` }] };
    }
  );

  const readSection = tool(
    "meldui_read_section",
    "Read a specific ticket field. Use this to see what's already there before writing.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      section: z.string().describe("Field to read: design, notes, acceptance_criteria, description"),
    },
    async ({ ticket_id, section }) => {
      if (!isValidSection(section)) {
        return { content: [{ type: "text" as const, text: `Invalid section: ${section}. Valid: ${VALID_SECTIONS.join(", ")}` }], isError: true };
      }
      const ticket = readTicket(projectDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }
      const value = (ticket[section] as string) ?? "";
      return { content: [{ type: "text" as const, text: value }] };
    }
  );

  const ticketShow = tool(
    "meldui_ticket_show",
    "Show full details of a ticket by ID.",
    {
      ticket_id: z.string().describe("The ticket ID"),
    },
    async ({ ticket_id }) => {
      const ticket = readTicket(projectDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  // ── Workflow control tools ──

  const stepComplete = tool(
    "meldui_step_complete",
    "Signal that the current workflow step is done. For gated steps this shows the approval UI; for non-gated steps it auto-advances.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      summary: z.string().describe("Brief description of what was accomplished in this step"),
    },
    async ({ ticket_id, summary }) => {
      send({ type: "step_complete", ticket_id, summary });
      return { content: [{ type: "text" as const, text: `Step completion signaled for ${ticket_id}` }] };
    }
  );

  const requestFeedback = tool(
    "meldui_request_feedback",
    "Ask the user to approve your work or provide feedback. BLOCKS until the user responds. Use this after writing a deliverable to a ticket field — the user can iterate until satisfied, then approve to continue.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      summary: z.string().describe("Brief summary of what you produced for the user to review"),
    },
    async ({ ticket_id, summary }) => {
      if (!emitFeedbackRequest) {
        return { content: [{ type: "text" as const, text: "Feedback request not available (no callback configured)" }], isError: true };
      }
      const response = await emitFeedbackRequest(ticket_id, summary);
      if (response.approved) {
        return { content: [{ type: "text" as const, text: "User approved. You may now call meldui_step_complete to advance to the next step." }] };
      }
      return { content: [{ type: "text" as const, text: `User feedback: ${response.feedback ?? "(no details provided)"}. Please address this feedback, update the ticket field using meldui_write_section, then call meldui_request_feedback again to re-confirm.` }] };
    }
  );

  // ── App communication tools ──

  const notify = tool(
    "meldui_notify",
    "Push a notification to the app. Shows as a toast. Works even when the user is on a different tab or window.",
    {
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification message"),
      level: z.string().optional().describe("Level: info, success, warning, error (default: info)"),
    },
    async ({ title, message, level }) => {
      send({ type: "notification", title, message, level: level ?? "info" });
      return { content: [{ type: "text" as const, text: "Notification sent" }] };
    }
  );

  const showStatus = tool(
    "meldui_show_status",
    "Update a transient status line in the step header (e.g., 'Analyzing 12 files...'). Replaces any previous status text.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      status_text: z.string().describe("Status text to display"),
    },
    async ({ ticket_id, status_text }) => {
      send({ type: "status_update", ticket_id, status_text });
      return { content: [{ type: "text" as const, text: "Status updated" }] };
    }
  );

  return createSdkMcpServer({
    name: "meldui",
    tools: [writeSection, readSection, ticketShow, stepComplete, requestFeedback, notify, showStatus],
  });
}
