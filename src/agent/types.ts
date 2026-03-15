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

export interface MeldAgentEvents {
  "chat-session": (event: { sessionId: string }) => void;
  "chat-agent-message": (event: { content: string }) => void;
  "chat-tool-use": (event: ToolUseEvent) => void;
  "chat-tool-result": (event: ToolResultEvent) => void;
  "tool-use-start": (event: { name: string; id: string }) => void;
  "tool-input-delta": (event: { id: string; partialJson: string }) => void;
  "tool-use-end": (event: { id: string }) => void;
  "permission-request": (event: PermissionRequestEvent) => void;
  "thinking-update": (event: { text: string }) => void;
  completed: (event: { response: string; sessionId: string }) => void;
  failed: (event: { message: string }) => void;
  stopped: () => void;
}

export interface MeldAgent extends EventEmitter<MeldAgentEvents> {
  execute(prompt: string, config: AgentConfig): Promise<void>;
  stop(): void;
}
