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
  sections?: TicketSection[];
  metadata: Record<string, unknown>;
  comments: TicketComment[];
  external_id?: string;
  external_source?: string;
}

// ── Section Types ──

export type SectionType = "markdown" | "acceptance_criteria" | "checklist" | "key_value";

export interface TicketSection {
  id: string;
  label: string;
  type: SectionType;
  content: unknown;
  collapsed: boolean;
  source: "workflow" | "human" | "agent";
  created_at: string;
  updated_at: string;
}

export interface AcceptanceCriterion {
  id: string;
  given: string;
  when: string;
  then: string;
  status: "pending" | "passed" | "failed";
  verified_by?: "agent" | "human";
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface KeyValueEntry {
  key: string;
  value: string;
}

// Content schemas per section type
export interface MarkdownContent {
  text: string;
}

export interface AcceptanceCriteriaContent {
  items: AcceptanceCriterion[];
}

export interface ChecklistContent {
  items: ChecklistItem[];
}

export interface KeyValueContent {
  entries: KeyValueEntry[];
}

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];

export const TICKET_TYPES: TicketType[] = ["feature", "task", "bug", "chore", "epic"];
