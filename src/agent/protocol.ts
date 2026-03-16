/**
 * NDJSON protocol types for stdin/stdout communication
 * between the Rust backend and the agent sidecar.
 */

// ── Stdin: Rust → Sidecar ──

export interface ExecuteCommand {
  type: "execute";
  prompt: string;
  config: SidecarConfig;
}

export interface PermissionResponseCommand {
  type: "permission_response";
  request_id: string;
  allowed: boolean;
}

export interface CancelCommand {
  type: "cancel";
}

export interface FeedbackResponseCommand {
  type: "feedback_response";
  request_id: string;
  approved: boolean;
  feedback?: string;
}

export type InboundMessage =
  | ExecuteCommand
  | PermissionResponseCommand
  | FeedbackResponseCommand
  | CancelCommand;

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

// ── Stdout: Sidecar → Rust ──

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

export interface PermissionRequestMessage {
  type: "permission_request";
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
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

// ── MeldUI MCP → App events ──

export interface SectionUpdateMessage {
  type: "section_update";
  ticket_id: string;
  section: string;
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

export interface FeedbackRequestMessage {
  type: "feedback_request";
  request_id: string;
  ticket_id: string;
  summary: string;
}

export type OutboundMessage =
  | SessionMessage
  | TextMessage
  | ToolStartMessage
  | ToolInputMessage
  | ToolEndMessage
  | ToolResultMessage
  | PermissionRequestMessage
  | ThinkingMessage
  | ResultMessage
  | ErrorMessage
  | SectionUpdateMessage
  | NotificationMessage
  | StepCompleteMessage
  | StatusUpdateMessage
  | FeedbackRequestMessage;
