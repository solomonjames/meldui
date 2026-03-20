import type { Ticket, TicketStatus, TicketType } from "@/shared/lib/tickets/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/shared/lib/tickets/types";

export interface ValidationError {
  field: string;
  message: string;
}

export function validateTicket(ticket: Partial<Ticket>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!ticket.id || typeof ticket.id !== "string") {
    errors.push({ field: "id", message: "ID is required" });
  }

  if (!ticket.title || typeof ticket.title !== "string" || ticket.title.trim() === "") {
    errors.push({ field: "title", message: "Title is required" });
  }

  if (!ticket.status || !TICKET_STATUSES.includes(ticket.status as TicketStatus)) {
    errors.push({
      field: "status",
      message: `Status must be one of: ${TICKET_STATUSES.join(", ")}`,
    });
  }

  if (ticket.priority == null || ticket.priority < 0 || ticket.priority > 4) {
    errors.push({ field: "priority", message: "Priority must be 0-4" });
  }

  if (!ticket.ticket_type || !TICKET_TYPES.includes(ticket.ticket_type as TicketType)) {
    errors.push({
      field: "ticket_type",
      message: `Type must be one of: ${TICKET_TYPES.join(", ")}`,
    });
  }

  return errors;
}

export function isValidStatus(status: string): status is TicketStatus {
  return TICKET_STATUSES.includes(status as TicketStatus);
}

export function isValidType(type: string): type is TicketType {
  return TICKET_TYPES.includes(type as TicketType);
}
