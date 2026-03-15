/**
 * Ticket MCP server — exposes ticket operations as tools
 * that Claude can call directly during workflow execution.
 *
 * Reads/writes JSON files in .meldui/tickets/ directly
 * instead of calling an external CLI.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Ensure the tickets directory exists.
 */
function ensureTicketsDir(projectDir: string): string {
  const dir = join(projectDir, ".meldui", "tickets");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate a ticket ID.
 */
function generateId(): string {
  const uuid = crypto.randomUUID();
  return `meld-${uuid.slice(0, 8)}`;
}

/**
 * Read a ticket from disk.
 */
function readTicket(projectDir: string, id: string): Record<string, unknown> | null {
  const path = join(ensureTicketsDir(projectDir), `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Write a ticket to disk.
 */
function writeTicket(projectDir: string, ticket: Record<string, unknown>): void {
  const dir = ensureTicketsDir(projectDir);
  const path = join(dir, `${ticket.id}.json`);
  writeFileSync(path, JSON.stringify(ticket, null, 2));
}

/**
 * Create a Ticket MCP server with tools for issue management.
 */
export function createTicketMcpServer(projectDir: string) {
  const ticketList = tool(
    "ticket_list",
    "List tickets. Returns JSON array of tickets.",
    {
      status: z.string().optional().describe("Filter by status: open, closed, in_progress"),
      type: z.string().optional().describe("Filter by ticket type: task, bug, feature, epic"),
    },
    async ({ status, type: ticketType }) => {
      const dir = ensureTicketsDir(projectDir);
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      let tickets = files.map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf-8"));
        } catch {
          return null;
        }
      }).filter(Boolean);

      if (status) {
        tickets = tickets.filter((t: Record<string, unknown>) => t.status === status);
      }
      if (ticketType) {
        tickets = tickets.filter((t: Record<string, unknown>) => t.ticket_type === ticketType);
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(tickets, null, 2) }] };
    }
  );

  const ticketShow = tool(
    "ticket_show",
    "Show full details of a ticket by ID.",
    {
      id: z.string().describe("The ticket ID (e.g., meld-abc12345)"),
    },
    async ({ id }) => {
      const ticket = readTicket(projectDir, id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${id}' not found` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  const ticketCreate = tool(
    "ticket_create",
    "Create a new ticket.",
    {
      title: z.string().describe("Ticket title"),
      description: z.string().optional().describe("Ticket description"),
      type: z.string().optional().describe("Ticket type: task, bug, feature, epic"),
      priority: z.number().optional().describe("Priority: 0-4 (0=critical, 2=medium, 4=backlog)"),
    },
    async ({ title, description, type: ticketType, priority }) => {
      const now = new Date().toISOString();
      const ticket = {
        id: generateId(),
        title,
        status: "open",
        priority: priority ?? 2,
        ticket_type: ticketType ?? "task",
        description: description ?? undefined,
        created_at: now,
        updated_at: now,
        labels: [],
        children_ids: [],
        metadata: {},
        comments: [],
      };
      writeTicket(projectDir, ticket);
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  const ticketUpdate = tool(
    "ticket_update",
    "Update a field on a ticket.",
    {
      id: z.string().describe("The ticket ID"),
      field: z.string().describe("Field to update: title, status, priority, description, notes, design, acceptance_criteria"),
      value: z.string().describe("New value for the field"),
    },
    async ({ id, field, value }) => {
      const ticket = readTicket(projectDir, id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${id}' not found` }], isError: true };
      }

      const validFields = ["title", "status", "priority", "description", "notes", "design", "acceptance_criteria"];
      if (!validFields.includes(field)) {
        return { content: [{ type: "text" as const, text: `Unknown field: ${field}` }], isError: true };
      }

      if (field === "priority") {
        ticket[field] = parseInt(value, 10);
      } else {
        ticket[field] = value;
      }
      ticket.updated_at = new Date().toISOString();

      writeTicket(projectDir, ticket);
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  const ticketClose = tool(
    "ticket_close",
    "Close a ticket.",
    {
      id: z.string().describe("The ticket ID to close"),
      reason: z.string().optional().describe("Reason for closing"),
    },
    async ({ id, reason }) => {
      const ticket = readTicket(projectDir, id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${id}' not found` }], isError: true };
      }

      const now = new Date().toISOString();
      ticket.status = "closed";
      ticket.closed_at = now;
      ticket.updated_at = now;
      if (reason) ticket.close_reason = reason;

      writeTicket(projectDir, ticket);
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  const ticketComment = tool(
    "ticket_comment",
    "Add a comment to a ticket.",
    {
      id: z.string().describe("The ticket ID"),
      text: z.string().describe("Comment text to add"),
    },
    async ({ id, text }) => {
      const ticket = readTicket(projectDir, id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: `Ticket '${id}' not found` }], isError: true };
      }

      const comments = (ticket.comments as unknown[]) ?? [];
      comments.push({
        id: crypto.randomUUID().slice(0, 8),
        author: "agent",
        text,
        created_at: new Date().toISOString(),
      });
      ticket.comments = comments;
      ticket.updated_at = new Date().toISOString();

      writeTicket(projectDir, ticket);
      return { content: [{ type: "text" as const, text: `Comment added to ${id}` }] };
    }
  );

  return createSdkMcpServer({
    name: "tickets",
    tools: [ticketList, ticketShow, ticketCreate, ticketUpdate, ticketClose, ticketComment],
  });
}
