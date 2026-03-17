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

function ensureTicketsDir(ticketsDir: string): string {
  if (!existsSync(ticketsDir)) {
    mkdirSync(ticketsDir, { recursive: true });
  }
  return ticketsDir;
}

function readTicket(ticketsDir: string, id: string): Record<string, unknown> | null {
  const dir = ensureTicketsDir(ticketsDir);
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

function writeTicket(ticketsDir: string, ticket: Record<string, unknown>): void {
  const dir = ensureTicketsDir(ticketsDir);
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

export type ReviewSubmissionResponse = {
  action: "approve" | "request_changes";
  summary: string;
  comments: Array<{
    id: string;
    file_path: string;
    line_number: number;
    content: string;
    suggestion?: string;
    resolved: boolean;
  }>;
  finding_actions: Array<{
    finding_id: string;
    action: "fix" | "accept" | "dismiss";
  }>;
};

export interface ReviewFinding {
  id: string;
  file_path: string;
  line_number?: number;
  severity: "critical" | "warning" | "info";
  validity: "real" | "noise" | "undecided";
  title: string;
  description: string;
  suggestion?: string;
}

export function createMelduiMcpServer(
  projectDir: string,
  send: (msg: OutboundMessage) => void,
  emitFeedbackRequest?: (ticketId: string, summary: string) => Promise<FeedbackResponse>,
  emitReviewRequest?: (ticketId: string, findings: ReviewFinding[], summary: string) => Promise<ReviewSubmissionResponse>,
  ticketsDir?: string,
) {
  // Resolve tickets directory: use explicit override (e.g. from main project when running in a worktree),
  // or fall back to the default location under projectDir.
  const resolvedTicketsDir = ticketsDir ?? join(projectDir, ".meldui", "tickets");

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
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      ticket[section] = content;
      ticket.updated_at = new Date().toISOString();
      writeTicket(resolvedTicketsDir, ticket);

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
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
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
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
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

      // Emit heartbeats while waiting for user response to keep the
      // idle timeout on the Rust side from firing.
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat" });
      }, 30_000);

      try {
        const response = await emitFeedbackRequest(ticket_id, summary);
        if (response.approved) {
          return { content: [{ type: "text" as const, text: "User approved. You may now call meldui_step_complete to advance to the next step." }] };
        }
        return { content: [{ type: "text" as const, text: `User feedback: ${response.feedback ?? "(no details provided)"}. Please address this feedback, update the ticket field using meldui_write_section, then call meldui_request_feedback again to re-confirm.` }] };
      } finally {
        clearInterval(heartbeat);
      }
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

  // ── Review tools ──

  const submitReview = tool(
    "meldui_submit_review",
    "Submit review findings for the user to review. BLOCKS until the user responds with approve or request changes. The user sees your findings in the diff review UI and can add inline comments. Returns a ReviewSubmission with the user's decision, comments, and per-finding actions.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      findings: z.array(z.object({
        id: z.string().describe("Unique finding ID (e.g. F1, F2)"),
        file_path: z.string().describe("File path the finding relates to"),
        line_number: z.number().optional().describe("Line number in the new file"),
        severity: z.enum(["critical", "warning", "info"]).describe("Finding severity"),
        validity: z.enum(["real", "noise", "undecided"]).describe("Your assessment of whether this is a real issue"),
        title: z.string().describe("Short title for the finding"),
        description: z.string().describe("Detailed description of the issue"),
        suggestion: z.string().optional().describe("Suggested code fix"),
      })).describe("Array of review findings"),
      summary: z.string().describe("Brief summary of your review"),
    },
    async ({ ticket_id, findings, summary }) => {
      if (!emitReviewRequest) {
        return { content: [{ type: "text" as const, text: "Review request not available (no callback configured)" }], isError: true };
      }

      // Emit heartbeats while waiting for user response
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat" });
      }, 30_000);

      try {
        const submission = await emitReviewRequest(ticket_id, findings, summary);

        if (submission.action === "approve") {
          const commentCount = submission.comments.length;
          return { content: [{ type: "text" as const, text: `User approved the review${commentCount > 0 ? ` with ${commentCount} comment(s)` : ""}. Summary: ${submission.summary || "(none)"}. You may now call meldui_step_complete to advance to the next step.` }] };
        }

        // Request changes — format the feedback for the agent
        const parts: string[] = [`User requested changes. Summary: ${submission.summary}`];

        if (submission.comments.length > 0) {
          parts.push("\n\nInline comments:");
          for (const comment of submission.comments) {
            parts.push(`- ${comment.file_path}:${comment.line_number}: ${comment.content}${comment.suggestion ? `\n  Suggestion: ${comment.suggestion}` : ""}`);
          }
        }

        if (submission.finding_actions.length > 0) {
          const fixRequests = submission.finding_actions.filter(a => a.action === "fix");
          const accepted = submission.finding_actions.filter(a => a.action === "accept");
          const dismissed = submission.finding_actions.filter(a => a.action === "dismiss");

          if (fixRequests.length > 0) {
            parts.push(`\nFindings to fix: ${fixRequests.map(a => a.finding_id).join(", ")}`);
          }
          if (accepted.length > 0) {
            parts.push(`Findings accepted (no action needed): ${accepted.map(a => a.finding_id).join(", ")}`);
          }
          if (dismissed.length > 0) {
            parts.push(`Findings dismissed: ${dismissed.map(a => a.finding_id).join(", ")}`);
          }
        }

        parts.push("\nPlease address the feedback, then call meldui_submit_review again with updated findings for re-review.");

        return { content: [{ type: "text" as const, text: parts.join("\n") }] };
      } finally {
        clearInterval(heartbeat);
      }
    }
  );

  return createSdkMcpServer({
    name: "meldui",
    tools: [writeSection, readSection, ticketShow, stepComplete, requestFeedback, submitReview, notify, showStatus],
  });
}
