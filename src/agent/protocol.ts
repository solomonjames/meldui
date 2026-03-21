/**
 * JSON-RPC 2.0 protocol types for Unix socket communication
 * between the Rust backend and the agent sidecar.
 *
 * Transport: Newline-delimited JSON-RPC 2.0 over Unix domain socket.
 * Sidecar = socket server, Rust = socket client.
 * Both sides act as simultaneous JSON-RPC client + server.
 */

// ── Sidecar Config (unchanged — used by config.ts) ──

export interface SidecarConfig {
  project_dir: string;
  system_prompt?: string;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  session_id?: string;
  max_turns?: number;
  model?: string;
  tickets_dir?: string;
}

// ── JSON-RPC Method Names ──

export const METHOD_NAMES = {
  // Rust → Sidecar (requests)
  query: "query",
  cancel: "cancel",

  // Sidecar → Rust (notifications)
  message: "message",
  queryComplete: "queryComplete",
  queryError: "queryError",

  // Sidecar → Rust (requests — expect response)
  toolApproval: "toolApproval",
  feedbackRequest: "feedbackRequest",
  reviewRequest: "reviewRequest",
} as const;

// ── Rust → Sidecar: Request Params & Results ──

export interface QueryParams {
  prompt: string;
  config: SidecarConfig;
}

export interface QueryResult {
  status: "started";
}

export interface CancelParams {
  // empty
}

export interface CancelResult {
  status: "cancelled";
}

// ── Sidecar → Rust: Notification Params ──

/**
 * All streaming message types are wrapped in a `message` notification.
 * The `type` field discriminates the message kind (same types as the
 * old OutboundMessage union, minus permission/feedback/review which
 * are now JSON-RPC requests).
 */
export type MessageNotificationParams =
  | SessionMessage
  | TextMessage
  | ToolStartMessage
  | ToolInputMessage
  | ToolEndMessage
  | ToolResultMessage
  | ThinkingMessage
  | ResultMessage
  | ErrorMessage
  | SectionUpdateMessage
  | NotificationMessage
  | StepCompleteMessage
  | StatusUpdateMessage
  | HeartbeatMessage
  | PrUrlReportedMessage
  | ToolProgressMessage
  | SubagentStartMessage
  | SubagentProgressMessage
  | SubagentCompleteMessage
  | FilesChangedMessage
  | ToolUseSummaryMessage
  | CompactingMessage
  | SubtaskCreatedMessage
  | SubtaskUpdatedMessage
  | SubtaskClosedMessage;

export interface QueryCompleteParams {
  sessionId: string;
  response: string;
}

export interface QueryErrorParams {
  message: string;
}

// ── Sidecar → Rust: Reverse Request Params & Results ──

export interface ToolApprovalParams {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolApprovalResult {
  decision: "allow" | "always-allow" | "deny";
}

export interface FeedbackRequestParams {
  requestId: string;
  ticketId: string;
  summary: string;
}

export interface FeedbackRequestResult {
  approved: boolean;
  feedback?: string;
}

export interface ReviewRequestParams {
  requestId: string;
  ticketId: string;
  findings: ReviewFindingPayload[];
  summary: string;
}

export interface ReviewRequestResult {
  submission: ReviewSubmissionPayload;
}

// ── Streaming Message Types (used inside `message` notifications) ──

export interface SessionMessage {
  type: "session";
  session_id: string;
}

export interface TextMessage {
  type: "text";
  content: string;
}

export interface ToolStartMessage {
  type: "tool_start";
  tool_name: string;
  tool_id: string;
}

export interface ToolInputMessage {
  type: "tool_input";
  tool_id: string;
  content: string;
}

export interface ToolEndMessage {
  type: "tool_end";
  tool_id: string;
}

export interface ToolResultMessage {
  type: "tool_result";
  tool_id: string;
  content: string;
  is_error: boolean;
}

export interface ThinkingMessage {
  type: "thinking";
  content: string;
}

export interface ResultMessage {
  type: "result";
  content: string;
  session_id: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface SectionUpdateMessage {
  type: "section_update";
  ticket_id: string;
  section: string;
  section_id?: string;
  content: string;
}

export interface NotificationMessage {
  type: "notification";
  title: string;
  message: string;
  level: string;
}

export interface StepCompleteMessage {
  type: "step_complete";
  ticket_id: string;
  summary: string;
}

export interface StatusUpdateMessage {
  type: "status_update";
  ticket_id: string;
  status_text: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export interface PrUrlReportedMessage {
  type: "pr_url_reported";
  ticket_id: string;
  url: string;
}

export interface SubtaskCreatedMessage {
  type: "subtask_created";
  subtask_id: string;
  parent_id: string;
}

export interface SubtaskUpdatedMessage {
  type: "subtask_updated";
  subtask_id: string;
  parent_id: string;
}

export interface SubtaskClosedMessage {
  type: "subtask_closed";
  subtask_id: string;
  parent_id: string;
}

export interface ToolProgressMessage {
  type: "tool_progress";
  tool_name: string;
  tool_use_id: string;
  elapsed_seconds: number;
}

export interface SubagentStartMessage {
  type: "subagent_start";
  task_id: string;
  tool_use_id?: string;
  description: string;
}

export interface SubagentProgressMessage {
  type: "subagent_progress";
  task_id: string;
  summary?: string;
  last_tool_name?: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
}

export interface SubagentCompleteMessage {
  type: "subagent_complete";
  task_id: string;
  status: "completed" | "failed" | "stopped";
  summary?: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
}

export interface FilesChangedMessage {
  type: "files_changed";
  files: Array<{ filename: string }>;
}

export interface ToolUseSummaryMessage {
  type: "tool_use_summary";
  summary: string;
  tool_ids: string[];
}

export interface CompactingMessage {
  type: "compacting";
  is_compacting: boolean;
}

// ── Review types (used by review flow — unchanged) ──

export interface ReviewSubmissionPayload {
  action: "approve" | "request_changes";
  summary: string;
  comments: ReviewCommentPayload[];
  finding_actions: FindingActionPayload[];
}

export interface ReviewCommentPayload {
  id: string;
  file_path: string;
  line_number: number;
  content: string;
  suggestion?: string;
  resolved: boolean;
}

export interface FindingActionPayload {
  finding_id: string;
  action: "fix" | "accept" | "dismiss";
}

export interface ReviewFindingPayload {
  id: string;
  file_path: string;
  line_number?: number;
  severity: "critical" | "warning" | "info";
  validity: "real" | "noise" | "undecided";
  title: string;
  description: string;
  suggestion?: string;
}

// ── Legacy compatibility: OutboundMessage union ──
// Used by ClaudeAgent's sendFn signature. These are all types
// that can be sent as `message` notification params.
export type OutboundMessage = MessageNotificationParams;
