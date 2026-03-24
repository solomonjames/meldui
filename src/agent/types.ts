/**
 * Core types for the MeldUI agent abstraction layer.
 * Modeled on Pencil's @ha/agent/src/types.ts.
 */

import type EventEmitter from "eventemitter3";

export interface AgentConfig {
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  sessionId?: string;
  projectDir: string;
  maxTurns?: number;
  ticketsDir?: string;
  thinking?: { type: "adaptive" | "enabled" | "disabled"; budgetTokens?: number };
  effort?: "low" | "medium" | "high" | "max";
  fastMode?: boolean;
}

export interface PermissionRequestEvent {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: "allow" | "always-allow" | "deny") => void;
}

export interface ToolUseEvent {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface ToolResultEvent {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ReviewRequestEvent {
  requestId: string;
  ticketId: string;
  findings: ReviewFindingData[];
  summary: string;
  resolve: (submission: ReviewSubmissionData) => void;
}

export interface ReviewFindingData {
  id: string;
  file_path: string;
  line_number?: number;
  severity: "critical" | "warning" | "info";
  validity: "real" | "noise" | "undecided";
  title: string;
  description: string;
  suggestion?: string;
}

export interface ReviewSubmissionData {
  action: "approve" | "request_changes";
  summary: string;
  comments: Array<{
    id: string;
    file_path: string;
    line_number: number;
    content: string;
    suggestion?: string;
    resolved: boolean;
  }>;
  finding_actions: Array<{
    finding_id: string;
    action: "fix" | "accept" | "dismiss";
  }>;
}

export interface InitMetadataEvent {
  model: string;
  available_models: string[];
  tools: string[];
  slash_commands: string[];
  skills: string[];
  mcp_servers: Array<{ name: string; status: string }>;
}

export interface MeldAgentEvents {
  "chat-session": (event: { sessionId: string }) => void;
  "init-metadata": (event: InitMetadataEvent) => void;
  "chat-agent-message": (event: { content: string }) => void;
  "chat-tool-use": (event: ToolUseEvent) => void;
  "chat-tool-result": (event: ToolResultEvent) => void;
  "tool-use-start": (event: { name: string; id: string }) => void;
  "tool-input-delta": (event: { id: string; partialJson: string }) => void;
  "tool-use-end": (event: { id: string }) => void;
  "tool-progress": (event: { toolUseId: string; toolName: string; elapsedSeconds: number }) => void;
  "tool-use-summary": (event: { summary: string; toolIds: string[] }) => void;
  "subagent-start": (event: { taskId: string; toolUseId?: string; description: string }) => void;
  "subagent-progress": (event: { taskId: string; summary?: string; lastToolName?: string; usage?: { total_tokens: number; tool_uses: number; duration_ms: number } }) => void;
  "subagent-complete": (event: { taskId: string; status: "completed" | "failed" | "stopped"; summary?: string; usage?: { total_tokens: number; tool_uses: number; duration_ms: number } }) => void;
  "files-persisted": (event: { files: Array<{ filename: string }> }) => void;
  "status-change": (event: { isCompacting: boolean }) => void;
  "permission-request": (event: PermissionRequestEvent) => void;
  "review-request": (event: ReviewRequestEvent) => void;
  "thinking-update": (event: { text: string }) => void;
  completed: (event: { response: string; sessionId: string }) => void;
  failed: (event: { message: string }) => void;
  stopped: () => void;
}

export interface MeldAgent extends EventEmitter<MeldAgentEvents> {
  execute(prompt: string, config: AgentConfig): Promise<void>;
  stop(): void;
}
