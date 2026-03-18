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
import { randomUUID } from "crypto";
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

function addAgentComment(ticket: Record<string, unknown>, text: string): void {
  const comments = (ticket.comments as Array<Record<string, unknown>>) ?? [];
  comments.push({
    id: randomUUID().slice(0, 8),
    author: "agent",
    text,
    created_at: new Date().toISOString(),
  });
  ticket.comments = comments;
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

  // Per-parent lock to serialize parent-modifying operations
  const parentLocks = new Map<string, Promise<void>>();
  function withParentLock<T>(parentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = parentLocks.get(parentId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    parentLocks.set(parentId, next.then(() => {}, () => {}));
    return next;
  }

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
      addAgentComment(ticket, `Wrote ${content.length} chars to ${section}`);
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

  const reportPrUrl = tool(
    "meldui_report_pr_url",
    "Report a pull request URL so the app can display it. Call this after successfully creating a PR with `gh pr create`.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      url: z.string().url().describe("The full PR URL (e.g. https://github.com/owner/repo/pull/123)"),
    },
    async ({ ticket_id, url }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const metadata = (ticket.metadata as Record<string, unknown>) ?? {};
      metadata.pr_url = url;
      ticket.metadata = metadata;
      ticket.updated_at = new Date().toISOString();
      writeTicket(resolvedTicketsDir, ticket);

      send({ type: "pr_url_reported", ticket_id, url });

      return { content: [{ type: "text" as const, text: `PR URL reported for ${ticket_id}: ${url}` }] };
    }
  );

  // ── Typed section tools ──

  const writeTypedSection = tool(
    "meldui_write_typed_section",
    "Write content to a typed section on a ticket (from the sections[] array). Content must match the section's declared type.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      section_id: z.string().describe("The section ID (from the workflow's ticket_sections definition)"),
      content: z.unknown().describe("Content matching the section type: markdown={text:string}, checklist={items:[...]}, acceptance_criteria={items:[...]}, key_value={entries:[...]}"),
    },
    async ({ ticket_id, section_id, content }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      const section = sections.find((s) => s.id === section_id);
      if (!section) {
        return { content: [{ type: "text" as const, text: `Section '${section_id}' not found on ticket ${ticket_id}` }], isError: true };
      }

      section.content = content;
      section.updated_at = new Date().toISOString();
      ticket.updated_at = new Date().toISOString();
      addAgentComment(ticket, `Updated section "${section.label}"`);
      writeTicket(resolvedTicketsDir, ticket);

      send({ type: "section_update", ticket_id, section: section.label as string, section_id, content: JSON.stringify(content) });

      return { content: [{ type: "text" as const, text: `Written to section ${section_id} on ${ticket_id}` }] };
    }
  );

  const readTypedSection = tool(
    "meldui_read_typed_section",
    "Read content from a typed section on a ticket by section ID.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      section_id: z.string().describe("The section ID"),
    },
    async ({ ticket_id, section_id }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      const section = sections.find((s) => s.id === section_id);
      if (!section) {
        return { content: [{ type: "text" as const, text: `Section '${section_id}' not found` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(section.content, null, 2) }] };
    }
  );

  // ── Structured section tools ──

  const writeAcceptanceCriteria = tool(
    "meldui_write_acceptance_criteria",
    "Write structured acceptance criteria to a ticket. Creates or updates an acceptance_criteria section in the ticket's sections array.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      items: z.array(z.object({
        given: z.string().describe("Given clause"),
        when: z.string().describe("When clause"),
        then: z.string().describe("Then clause"),
        status: z.enum(["pending", "passed", "failed"]).optional().describe("Status (default: pending)"),
      })).describe("Array of acceptance criteria items"),
    },
    async ({ ticket_id, items }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const now = new Date().toISOString();
      const acItems = items.map((item, idx) => ({
        id: `ac-${randomUUID().slice(0, 8)}`,
        given: item.given,
        when: item.when,
        then: item.then,
        status: item.status ?? "pending",
      }));

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      const existingIdx = sections.findIndex((s) => s.type === "acceptance_criteria");
      const section = {
        id: existingIdx >= 0 ? sections[existingIdx].id : `sec-ac-${randomUUID().slice(0, 8)}`,
        label: "Acceptance Criteria",
        type: "acceptance_criteria",
        content: { items: acItems },
        collapsed: false,
        source: "agent",
        created_at: existingIdx >= 0 ? (sections[existingIdx].created_at as string) : now,
        updated_at: now,
      };

      if (existingIdx >= 0) {
        sections[existingIdx] = section;
      } else {
        sections.push(section);
      }
      ticket.sections = sections;
      ticket.updated_at = now;
      writeTicket(resolvedTicketsDir, ticket);

      send({ type: "section_update", ticket_id, section: "acceptance_criteria", section_id: section.id as string, content: JSON.stringify(section.content) });

      return { content: [{ type: "text" as const, text: `Wrote ${acItems.length} acceptance criteria to ${ticket_id}` }] };
    }
  );

  const updateAcceptanceCriterion = tool(
    "meldui_update_acceptance_criterion",
    "Update a single acceptance criterion's status during verification.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      criterion_id: z.string().describe("The criterion ID (e.g. ac-abc123)"),
      status: z.enum(["pending", "passed", "failed"]).describe("New status"),
      verified_by: z.enum(["agent", "human"]).optional().describe("Who verified"),
    },
    async ({ ticket_id, criterion_id, status, verified_by }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      const acSection = sections.find((s) => s.type === "acceptance_criteria");
      if (!acSection) {
        return { content: [{ type: "text" as const, text: "No acceptance_criteria section found" }], isError: true };
      }

      const content = acSection.content as { items: Array<Record<string, unknown>> };
      const item = content.items.find((i) => i.id === criterion_id);
      if (!item) {
        return { content: [{ type: "text" as const, text: `Criterion '${criterion_id}' not found` }], isError: true };
      }

      item.status = status;
      if (verified_by) item.verified_by = verified_by;
      acSection.updated_at = new Date().toISOString();
      ticket.updated_at = new Date().toISOString();
      writeTicket(resolvedTicketsDir, ticket);

      send({ type: "section_update", ticket_id, section: "acceptance_criteria", section_id: acSection.id as string, content: JSON.stringify(acSection.content) });

      return { content: [{ type: "text" as const, text: `Updated criterion ${criterion_id} → ${status}` }] };
    }
  );

  // ── Checklist tools ──

  const writeChecklist = tool(
    "meldui_write_checklist",
    "Write a checklist section to a ticket. A ticket can have multiple checklist sections differentiated by section_label.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      section_label: z.string().describe("Label for the checklist section (e.g. 'Pre-deploy Checklist')"),
      items: z.array(z.object({
        text: z.string().describe("Checklist item text"),
        checked: z.boolean().optional().describe("Whether the item is checked (default: false)"),
      })).describe("Array of checklist items"),
    },
    async ({ ticket_id, section_label, items }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const now = new Date().toISOString();
      const checklistItems = items.map((item) => ({
        id: `cl-${randomUUID().slice(0, 8)}`,
        text: item.text,
        checked: item.checked ?? false,
      }));

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      const existingIdx = sections.findIndex((s) => s.type === "checklist" && s.label === section_label);
      const sectionId = existingIdx >= 0 ? (sections[existingIdx].id as string) : `sec-cl-${randomUUID().slice(0, 8)}`;
      const section = {
        id: sectionId,
        label: section_label,
        type: "checklist",
        content: { items: checklistItems },
        collapsed: false,
        source: "agent",
        created_at: existingIdx >= 0 ? (sections[existingIdx].created_at as string) : now,
        updated_at: now,
      };

      if (existingIdx >= 0) {
        sections[existingIdx] = section;
      } else {
        sections.push(section);
      }
      ticket.sections = sections;
      ticket.updated_at = now;
      writeTicket(resolvedTicketsDir, ticket);

      send({ type: "section_update", ticket_id, section: "checklist", section_id: sectionId, content: JSON.stringify(section.content) });

      return { content: [{ type: "text" as const, text: `Wrote ${checklistItems.length} items to checklist "${section_label}" on ${ticket_id}` }] };
    }
  );

  const checkItem = tool(
    "meldui_check_item",
    "Toggle a specific checklist item by ID.",
    {
      ticket_id: z.string().describe("The ticket ID"),
      item_id: z.string().describe("The checklist item ID"),
      checked: z.boolean().describe("Whether the item should be checked"),
    },
    async ({ ticket_id, item_id, checked }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const sections = (ticket.sections as Array<Record<string, unknown>>) ?? [];
      for (const section of sections) {
        if (section.type !== "checklist") continue;
        const content = section.content as { items: Array<Record<string, unknown>> };
        const item = content.items.find((i) => i.id === item_id);
        if (item) {
          item.checked = checked;
          section.updated_at = new Date().toISOString();
          ticket.updated_at = new Date().toISOString();
          writeTicket(resolvedTicketsDir, ticket);
          send({ type: "section_update", ticket_id, section: "checklist", section_id: section.id as string, content: JSON.stringify(section.content) });
          return { content: [{ type: "text" as const, text: `Item ${item_id} → ${checked ? "checked" : "unchecked"}` }] };
        }
      }

      return { content: [{ type: "text" as const, text: `Item '${item_id}' not found` }], isError: true };
    }
  );

  // ── Sub-ticket tools ──

  const createSubtask = tool(
    "meldui_create_subtask",
    "Create a sub-ticket under a parent ticket. The sub-ticket will be hidden from the kanban board and shown in the parent's detail view.",
    {
      parent_id: z.string().describe("The parent ticket ID"),
      title: z.string().describe("Sub-ticket title"),
      description: z.string().optional().describe("Sub-ticket description"),
      type: z.string().optional().describe("Ticket type (default: task)"),
      priority: z.number().optional().describe("Priority 0-4 (default: 2)"),
    },
    async ({ parent_id, title, description, type, priority }) => {
      return withParentLock(parent_id, async () => {
        const parent = readTicket(resolvedTicketsDir, parent_id);
        if (!parent) {
          return { content: [{ type: "text" as const, text: `Parent ticket '${parent_id}' not found` }], isError: true };
        }

        const subtaskId = `meld-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const subtask: Record<string, unknown> = {
          id: subtaskId,
          title,
          description: description ?? "",
          status: "open",
          priority: priority ?? 2,
          ticket_type: type ?? "task",
          parent_id,
          children_ids: [],
          labels: [],
          metadata: {},
          comments: [],
          created_by: "agent",
          created_at: now,
          updated_at: now,
        };

        addAgentComment(subtask, `Created as subtask of ${parent_id}`);
        writeTicket(resolvedTicketsDir, subtask);

        // Update parent's children_ids
        const childrenIds = (parent.children_ids as string[]) ?? [];
        childrenIds.push(subtaskId);
        parent.children_ids = childrenIds;
        parent.updated_at = now;
        addAgentComment(parent, `Created subtask: ${title}`);
        writeTicket(resolvedTicketsDir, parent);

        send({ type: "subtask_created", subtask_id: subtaskId, parent_id });

        return { content: [{ type: "text" as const, text: `Created subtask ${subtaskId}: "${title}"` }] };
      });
    }
  );

  const updateSubtask = tool(
    "meldui_update_subtask",
    "Update a sub-ticket's fields. Set status to 'closed' to close it (automatically sets closed_at).",
    {
      ticket_id: z.string().describe("The sub-ticket ID"),
      status: z.string().optional().describe("New status (open, in_progress, closed)"),
      description: z.string().optional().describe("Updated description"),
      notes: z.string().optional().describe("Updated notes"),
    },
    async ({ ticket_id, status, description, notes }) => {
      const ticket = readTicket(resolvedTicketsDir, ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${ticket_id}' not found` }], isError: true };
      }

      const now = new Date().toISOString();
      if (status !== undefined) ticket.status = status;
      if (description !== undefined) ticket.description = description;
      if (notes !== undefined) ticket.notes = notes;
      ticket.updated_at = now;

      if (status === "closed") {
        ticket.closed_at = now;
      }

      writeTicket(resolvedTicketsDir, ticket);

      const parentId = (ticket.parent_id as string) ?? "";
      if (status === "closed") {
        send({ type: "subtask_closed", subtask_id: ticket_id, parent_id: parentId });
      } else {
        send({ type: "subtask_updated", subtask_id: ticket_id, parent_id: parentId });
      }

      return { content: [{ type: "text" as const, text: `Updated ${ticket_id}${status ? ` → ${status}` : ""}` }] };
    }
  );

  return createSdkMcpServer({
    name: "meldui",
    tools: [writeSection, readSection, writeTypedSection, readTypedSection, ticketShow, stepComplete, requestFeedback, submitReview, notify, showStatus, reportPrUrl, writeAcceptanceCriteria, updateAcceptanceCriterion, writeChecklist, checkItem, createSubtask, updateSubtask],
  });
}
