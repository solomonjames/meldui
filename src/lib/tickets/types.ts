export type TicketStatus = "open" | "in_progress" | "blocked" | "deferred" | "closed";
export type TicketType = "feature" | "task" | "bug" | "chore" | "epic";

export interface TicketComment {
  id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: number;
  ticket_type: TicketType;
  description?: string;
  notes?: string;
  design?: string;
  acceptance_criteria?: string;
  assignee?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  close_reason?: string;
  labels: string[];
  parent_id?: string;
  children_ids: string[];
  metadata: Record<string, unknown>;
  comments: TicketComment[];
  external_id?: string;
  external_source?: string;
}

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];

export const TICKET_TYPES: TicketType[] = [
  "feature",
  "task",
  "bug",
  "chore",
  "epic",
];
