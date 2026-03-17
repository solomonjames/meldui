// Re-export Ticket types from lib
export type {
  Ticket,
  TicketComment,
  TicketStatus,
  TicketType,
} from "@/lib/tickets";

export interface ClaudeStatus {
  installed: boolean;
  authenticated: boolean;
  path?: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// ── Workflow Types ──

export type StepViewType = "chat" | "review" | "progress" | "diff_review" | "commit";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  instructions: StepInstructions;
  view: StepViewType;
}

export type StepInstructions =
  | { prompt: string }
  | { file: string };

export interface WorkflowState {
  workflow_id: string;
  current_step_id: string | null;
  step_status: StepStatus;
  step_history: StepRecord[];
}

export type StepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | { failed: string };

export interface StepRecord {
  step_id: string;
  status: StepStatus;
  started_at?: string;
  completed_at?: string;
  output_summary?: string;
}

export interface StepExecutionResult {
  step_id: string;
  response: string;
  workflow_completed: boolean;
}

export interface WorkflowSuggestion {
  workflow_id: string;
  reasoning: string;
}

export interface StreamChunk {
  issue_id: string;
  chunk_type: "text" | "tool_start" | "tool_input" | "tool_end" | "tool_result" | "thinking" | "result" | "error" | "stderr";
  content: string;
}

export interface ToolActivity {
  tool_id: string;
  tool_name: string;
  input: string;
  result?: string;
  is_error?: boolean;
  status: "running" | "complete";
}

export interface StepOutputStream {
  textContent: string;
  toolActivities: ToolActivity[];
  stderrLines: string[];
  resultContent: string | null;
  thinkingContent: string;
  lastChunkType: string;
}

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

// ── Diff Types (structured) ──

export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  line_type: DiffLineType;
  content: string;
  old_line_no?: number;
  new_line_no?: number;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

// ── Review Types ──

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

export interface ReviewComment {
  id: string;
  file_path: string;
  line_number: number;
  content: string;
  suggestion?: string;
  resolved: boolean;
}

export interface FindingAction {
  finding_id: string;
  action: "fix" | "accept" | "dismiss";
}

export interface ReviewSubmission {
  action: "approve" | "request_changes";
  summary: string;
  comments: ReviewComment[];
  finding_actions: FindingAction[];
}

// ── MeldUI MCP Event Types ──

export interface SectionUpdateEvent {
  ticket_id: string;
  section: string;
  content: string;
}

export interface NotificationEvent {
  title: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
}

export interface StepCompleteEvent {
  ticket_id: string;
  summary: string;
}

export interface StatusUpdateEvent {
  ticket_id: string;
  status_text: string;
}

export interface FeedbackRequestEvent {
  request_id: string;
  ticket_id: string;
  summary: string;
}
