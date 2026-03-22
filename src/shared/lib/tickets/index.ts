export { generateTicketId, isValidTicketId } from "@/shared/lib/tickets/id";
export type {
  AcceptanceCriteriaContent,
  AcceptanceCriterion,
  ChecklistContent,
  ChecklistItem,
  KeyValueContent,
  KeyValueEntry,
  MarkdownContent,
  SectionType,
  Ticket,
  TicketComment,
  TicketSection,
  TicketStatus,
  TicketType,
} from "@/shared/lib/tickets/types";
export { TICKET_STATUSES, TICKET_TYPES } from "@/shared/lib/tickets/types";
export {
  isValidStatus,
  isValidType,
  type ValidationError,
  validateTicket,
} from "@/shared/lib/tickets/validation";
