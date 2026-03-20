export type {
  Ticket,
  TicketComment,
  TicketStatus,
  TicketType,
  TicketSection,
  SectionType,
  AcceptanceCriterion,
  ChecklistItem,
  KeyValueEntry,
  MarkdownContent,
  AcceptanceCriteriaContent,
  ChecklistContent,
  KeyValueContent,
} from "@/shared/lib/tickets/types";
export { TICKET_STATUSES, TICKET_TYPES } from "@/shared/lib/tickets/types";
export { generateTicketId, isValidTicketId } from "@/shared/lib/tickets/id";
export {
  validateTicket,
  isValidStatus,
  isValidType,
  type ValidationError,
} from "@/shared/lib/tickets/validation";
