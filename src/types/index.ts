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
  human_gate: boolean;
  view: StepViewType;
  writes_to?: string[];
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
  | "awaiting_gate"
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
  awaiting_gate: boolean;
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

export interface DiffFile {
  path: string;
  status: string;
  content: string;
}
