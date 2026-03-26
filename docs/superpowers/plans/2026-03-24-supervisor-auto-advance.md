# Supervisor Auto-Advance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an intelligent supervisor agent that evaluates worker output and replies on behalf of the user during auto-advance, instead of blindly advancing to the next step.

**Architecture:** A Haiku-powered supervisor sits in the Rust backend's `queryComplete` flow. When auto-advance is on, Rust sends the worker's response to the sidecar's new `supervisorEvaluate` JSON-RPC method. The sidecar calls Haiku directly. If the supervisor says "reply", Rust sends a `queryFollowUp` to continue the worker session. If "advance", the normal auto-advance flow triggers. The frontend shows supervisor replies in the chat stream and can override with a "Take over" button.

**Tech Stack:** Rust (Tauri v2), TypeScript (sidecar, `@anthropic-ai/sdk`), React 19 (frontend), TanStack Query, tauri-specta

**Spec:** `docs/superpowers/specs/2026-03-24-supervisor-auto-advance-design.md`

---

## File Map

### New files
- `src-tauri/src/agent/supervisor.rs` — Rust supervisor evaluation loop
- `src/agent/supervisor.ts` — Sidecar Haiku evaluation logic

### Modified files
- `src-tauri/src/agent/mod.rs` — Add supervisor module, auto-advance state on AgentState (RwLock), conditional `queryComplete` handling
- `src-tauri/src/agent/events.rs` — Add `SupervisorReply` event
- `src-tauri/src/agent/protocol.rs` — Add `SupervisorEvaluateParams`/`SupervisorEvaluateResult` structs
- `src-tauri/src/settings.rs` — Add `SupervisorSettings` to `ProjectSettings`
- `src-tauri/src/lib.rs` — Register new commands and events
- `src-tauri/src/workflow/mod.rs` — Pass ticket context to `execute_step`
- `src/agent/protocol.ts` — Add `supervisorEvaluate`, `queryFollowUp` method names and types
- `src/agent/main.ts` — Register `supervisorEvaluate` and `queryFollowUp` JSON-RPC handlers
- `src/agent/claude-agent.ts` — Add `lastConfig`/`lastSessionId` tracking for session resume
- `src/features/workflow/hooks/use-workflow.ts` — Replace local `autoAdvance` state with Tauri commands
- `src/features/workflow/components/workflow-shell.tsx` — Supervisor state awareness (keep existing auto-advance effect)
- `src/features/workflow/components/compact-workflow-indicator.tsx` — Update autoAdvance prop source
- `src/features/workflow/components/views/chat-view.tsx` — Render supervisor replies, "Take over" button
- `src/features/settings/components/settings-page.tsx` — Add Supervisor settings section
- `src/shared/types/index.ts` — Add `SupervisorReply` type if needed

### Known v1 limitations
- **Permission requests during supervisor follow-up turns**: `toolApproval` and `reviewRequest` methods from the sidecar are logged but not handled during the supervisor's `read_until_query_complete` loop. If the agent requests permission during a supervisor-initiated follow-up, it will hang. Mitigation: the agent's auto-allow list covers most common tools. Full fix deferred to v2.
- **Conversation restore**: Supervisor reply entries (`supervisor_reply` type) persisted to the conversation log need matching restore logic. The existing `snapshotToBlocks()` function may pass them through as unknown types. A follow-up task should add rendering for restored supervisor replies.

---

## Task 1: Add `SupervisorSettings` to Rust settings

**Files:**
- Modify: `src-tauri/src/settings.rs:30-55`

- [ ] **Step 1: Add SupervisorSettings struct and field**

In `src-tauri/src/settings.rs`, add after `WorktreeSettings`:

```rust
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct SupervisorSettings {
    /// Custom supervisor system prompt (replaces guidelines section only).
    /// None = use default prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_prompt: Option<String>,
    /// Max supervisor replies per step before falling back to user. Default: 5.
    #[serde(default = "default_max_replies")]
    pub max_replies_per_step: u32,
}

fn default_max_replies() -> u32 {
    5
}

impl Default for SupervisorSettings {
    fn default() -> Self {
        Self {
            custom_prompt: None,
            max_replies_per_step: default_max_replies(),
        }
    }
}
```

Add field to `ProjectSettings`:

```rust
pub struct ProjectSettings {
    #[serde(default)]
    pub sync: Option<SyncSettings>,
    #[serde(default)]
    pub worktree: Option<WorktreeSettings>,
    #[serde(default)]
    pub supervisor: Option<SupervisorSettings>,
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat: add SupervisorSettings to project settings"
```

---

## Task 2: Add auto-advance state and commands to Rust

**Files:**
- Modify: `src-tauri/src/agent/mod.rs:96-198`
- Modify: `src-tauri/src/lib.rs:435-498`

- [ ] **Step 1: Add auto-advance state to AgentState**

In `src-tauri/src/agent/mod.rs`, add a HashMap to `AgentState`:

```rust
use std::collections::HashMap;

pub struct AgentState {
    pub handle: Mutex<Option<AgentHandle>>,
    /// Auto-advance enabled per project (keyed by project_dir).
    /// Uses RwLock since reads are frequent (every queryComplete) and writes are rare (toggle).
    pub auto_advance: tokio::sync::RwLock<HashMap<String, bool>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            auto_advance: tokio::sync::RwLock::new(HashMap::new()),
        }
    }
}
```

- [ ] **Step 2: Add set/get auto-advance Tauri commands**

Add two new public functions in `src-tauri/src/agent/mod.rs`:

```rust
#[tauri::command]
#[specta::specta]
pub async fn set_auto_advance(
    state: tauri::State<'_, AgentState>,
    project_dir: String,
    enabled: bool,
) -> Result<(), String> {
    let mut map = state.auto_advance.write().await;
    map.insert(project_dir, enabled);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_auto_advance(
    state: tauri::State<'_, AgentState>,
    project_dir: String,
) -> Result<bool, String> {
    let map = state.auto_advance.read().await;
    Ok(map.get(&project_dir).copied().unwrap_or(false))
}
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the imports at line 437-441:

```rust
use agent::{
    agent_set_effort, agent_set_fast_mode, agent_set_model, agent_set_thinking,
    set_auto_advance, get_auto_advance,
    // ... existing event imports ...
};
```

Add to `collect_commands!` (after `agent_set_fast_mode`):

```rust
set_auto_advance,
get_auto_advance,
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add set/get auto-advance Tauri commands"
```

---

## Task 3: Add `SupervisorReply` event to Rust

**Files:**
- Modify: `src-tauri/src/agent/events.rs`
- Modify: `src-tauri/src/lib.rs:486-498`

- [ ] **Step 1: Add SupervisorReply event struct**

In `src-tauri/src/agent/events.rs`, add after `PrUrlReportedEvent`:

```rust
/// Emitted when the supervisor auto-replies on behalf of the user.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type, tauri_specta::Event)]
pub struct SupervisorReply {
    pub message: String,
    pub reasoning: Option<String>,
    pub turn_number: u32,
}
```

- [ ] **Step 2: Register event in lib.rs**

In `src-tauri/src/lib.rs`, add `SupervisorReply` to the use statement and `collect_events!`:

```rust
use agent::{
    // ... existing imports ...,
    SupervisorReply,
};
```

```rust
.events(tauri_specta::collect_events![
    // ... existing events ...,
    SupervisorReply,
])
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/events.rs src-tauri/src/lib.rs
git commit -m "feat: add SupervisorReply Tauri event"
```

---

## Task 4: Add sidecar protocol types (TypeScript)

**Files:**
- Modify: `src/agent/protocol.ts`

- [ ] **Step 1: Add new method names and types**

In `src/agent/protocol.ts`, add to `METHOD_NAMES` object:

```typescript
export const METHOD_NAMES = {
  // Rust → Sidecar (requests)
  query: "query",
  cancel: "cancel",
  supervisorEvaluate: "supervisorEvaluate",  // NEW
  queryFollowUp: "queryFollowUp",            // NEW

  // ... rest unchanged ...
} as const;
```

Add new param/result types after existing ones:

```typescript
// ── Supervisor evaluation (Rust → Sidecar) ──

export interface SupervisorEvaluateParams {
  workerResponse: string;
  ticketContext: {
    title: string;
    description: string;
    acceptanceCriteria?: string;
    currentStep: { index: number; name: string; prompt: string };
  };
  systemPrompt?: string;
}

export interface SupervisorEvaluateResult {
  action: "reply" | "advance";
  message?: string;
  reasoning?: string;
}

// ── Follow-up query (Rust → Sidecar) ──

export interface QueryFollowUpParams {
  message: string;
}

export interface QueryFollowUpResult {
  status: "started";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/protocol.ts
git commit -m "feat: add supervisorEvaluate and queryFollowUp protocol types"
```

---

## Task 5: Implement supervisor evaluation in sidecar

**Files:**
- Create: `src/agent/supervisor.ts`

- [ ] **Step 1: Create supervisor.ts**

Create `src/agent/supervisor.ts`:

```typescript
/**
 * Supervisor agent — evaluates worker output using Haiku
 * and decides whether to reply or advance.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupervisorEvaluateParams, SupervisorEvaluateResult } from "./protocol";

const DEFAULT_PREAMBLE = `You are a workflow supervisor for MeldUI. An AI coding agent is working on a ticket, and you are evaluating its latest response to decide what to do next.

You have two actions available:
- "reply": The agent is asking a question or needs guidance. Respond on behalf of the user.
- "advance": The agent has completed the current step's work. Move to the next step.`;

const DEFAULT_GUIDELINES = `Guidelines for your decision:
- If the agent is asking a clarifying question, answer it using the ticket context provided.
- If the agent is asking for permission or confirmation to proceed, approve it.
- If the agent says it's done, or its output clearly fulfills the step's prompt, choose "advance".
- If the agent is stuck or going in circles, choose "advance" to move on.
- Keep your replies concise and direct. You are unblocking the agent, not collaborating.`;

const JSON_FORMAT_INSTRUCTIONS = `Respond with JSON only:
{ "action": "reply", "message": "your response here", "reasoning": "why you chose this" }
or
{ "action": "advance", "reasoning": "why the step is complete" }`;

function buildSystemPrompt(customPrompt?: string): string {
  const guidelines = customPrompt ?? DEFAULT_GUIDELINES;
  return `${DEFAULT_PREAMBLE}\n\n${guidelines}\n\n${JSON_FORMAT_INSTRUCTIONS}`;
}

function buildUserMessage(params: SupervisorEvaluateParams): string {
  const { workerResponse, ticketContext } = params;
  const step = ticketContext.currentStep;
  return `## Ticket
Title: ${ticketContext.title}
Description: ${ticketContext.description}
${ticketContext.acceptanceCriteria ? `Acceptance Criteria: ${ticketContext.acceptanceCriteria}` : ""}

## Current Step [${step.index + 1}]: ${step.name}
Prompt: ${step.prompt}

## Agent's Response
${workerResponse}`;
}

function parseResponse(text: string): SupervisorEvaluateResult {
  // Try to extract JSON from the response (Haiku may wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.action !== "reply" && parsed.action !== "advance") {
    throw new Error(`Invalid action: ${parsed.action}`);
  }
  return {
    action: parsed.action,
    message: parsed.message,
    reasoning: parsed.reasoning,
  };
}

export async function evaluateSupervisor(
  params: SupervisorEvaluateParams,
): Promise<SupervisorEvaluateResult> {
  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(params.systemPrompt);
  const userMessage = buildUserMessage(params);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      return parseResponse(text);
    } catch (err) {
      if (attempt === 0) {
        process.stderr.write(
          `[sidecar] supervisor: attempt ${attempt + 1} failed: ${err}, retrying\n`,
        );
        continue;
      }
      // Second attempt failed — fall back to advance
      process.stderr.write(
        `[sidecar] supervisor: all attempts failed: ${err}, falling back to advance\n`,
      );
      return { action: "advance", reasoning: "Supervisor evaluation failed, advancing by default" };
    }
  }

  // Unreachable, but satisfy TypeScript
  return { action: "advance", reasoning: "Supervisor evaluation failed" };
}
```

- [ ] **Step 2: Add `@anthropic-ai/sdk` dependency**

Run: `cd src/agent && bun add @anthropic-ai/sdk`

- [ ] **Step 3: Commit**

```bash
git add src/agent/supervisor.ts src/agent/package.json src/agent/bun.lockb
git commit -m "feat: add sidecar supervisor evaluation module"
```

---

## Task 6: Register sidecar JSON-RPC handlers

**Files:**
- Modify: `src/agent/main.ts:165-353`

- [ ] **Step 1: Add imports at top of main.ts**

Add to the imports in `src/agent/main.ts`:

```typescript
import { evaluateSupervisor } from "./supervisor";
import type {
  // ... existing imports ...,
  SupervisorEvaluateParams,
  SupervisorEvaluateResult,
  QueryFollowUpParams,
  QueryFollowUpResult,
} from "./protocol";
```

- [ ] **Step 2: Register `supervisorEvaluate` method**

After the `setFastMode` method registration (~line 353), add:

```typescript
rpc.addMethod(
  METHOD_NAMES.supervisorEvaluate,
  async (params: SupervisorEvaluateParams): Promise<SupervisorEvaluateResult> => {
    return evaluateSupervisor(params);
  },
);
```

- [ ] **Step 3: Register `queryFollowUp` method**

After `supervisorEvaluate`, add:

```typescript
rpc.addMethod(
  METHOD_NAMES.queryFollowUp,
  async (params: QueryFollowUpParams): Promise<QueryFollowUpResult> => {
    if (!activeAgent) {
      throw new Error("No active agent to follow up with");
    }

    const agent = activeAgent;

    // IMPORTANT: Remove all existing event listeners from the agent before re-wiring.
    // The previous `query` call registered listeners (completed, failed, stopped, etc.)
    // which would cause duplicate queryComplete notifications if left in place.
    agent.removeAllListeners();

    // Re-wire completion events for this follow-up turn
    agent.on("completed", ({ response, sessionId }) => {
      notify(METHOD_NAMES.queryComplete, { sessionId, response });
    });

    agent.on("failed", ({ message }) => {
      notify(METHOD_NAMES.queryError, { message });
    });

    agent.on("stopped", () => {
      notify(METHOD_NAMES.queryComplete, { sessionId: "", response: "" });
    });

    // Re-wire streaming events
    agent.on("chat-agent-message", ({ content }) => {
      sendMessage({ type: "text", content });
    });

    agent.on("tool-use-start", ({ name, id }) => {
      sendMessage({ type: "tool_start", tool_name: name, tool_id: id });
    });

    agent.on("tool-input-delta", ({ id, partialJson }) => {
      sendMessage({ type: "tool_input", tool_id: id, content: partialJson });
    });

    agent.on("tool-use-end", ({ id }) => {
      sendMessage({ type: "tool_end", tool_id: id });
    });

    agent.on("chat-tool-result", ({ toolUseId, content, isError }) => {
      sendMessage({ type: "tool_result", tool_id: toolUseId, content, is_error: isError });
    });

    agent.on("thinking-update", ({ text }) => {
      sendMessage({ type: "thinking", content: text });
    });

    // Launch follow-up execution in detached async task
    void (async () => {
      try {
        await agent.execute(params.message, {
          ...agent.lastConfig!,
          sessionId: agent.lastSessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[sidecar] Unhandled followUp error: ${message}\n`);
        notify(METHOD_NAMES.queryError, { message });
      }
    })();

    return { status: "started" as const };
  },
);
```

- [ ] **Step 4: Add `lastConfig` and `lastSessionId` tracking to ClaudeAgent**

In `src/agent/claude-agent.ts`, add properties to store the last config and session ID so `queryFollowUp` can resume:

```typescript
// Add to class properties
public lastConfig: AgentConfig | null = null;
public lastSessionId: string | undefined = undefined;
```

At the start of `execute()`, store the config:
```typescript
this.lastConfig = config;
```

When the session ID is captured (in the `result` message handler), store it:
```typescript
this.lastSessionId = sessionId;
```

- [ ] **Step 5: Verify sidecar compiles**

Run: `cd src/agent && bunx tsc --noEmit --project tsconfig.json` (or equivalent check)
If no tsconfig in agent dir, just verify with `bun build --compile` dry-run or rely on the build step later.

- [ ] **Step 6: Commit**

```bash
git add src/agent/main.ts src/agent/claude-agent.ts
git commit -m "feat: register supervisorEvaluate and queryFollowUp handlers in sidecar"
```

---

## Task 7: Add Rust protocol types for supervisor

**Files:**
- Modify: `src-tauri/src/agent/protocol.rs`

- [ ] **Step 1: Add supervisor request/response structs**

In `src-tauri/src/agent/protocol.rs`, add:

```rust
/// Ticket context sent to the supervisor for evaluation.
#[derive(Debug, Serialize)]
pub(crate) struct TicketContext {
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<String>,
    pub current_step: StepContext,
}

#[derive(Debug, Serialize)]
pub(crate) struct StepContext {
    pub index: u32,
    pub name: String,
    pub prompt: String,
}

/// Params for the supervisorEvaluate JSON-RPC request.
#[derive(Debug, Serialize)]
pub(crate) struct SupervisorEvaluateParams {
    #[serde(rename = "workerResponse")]
    pub worker_response: String,
    #[serde(rename = "ticketContext")]
    pub ticket_context: TicketContext,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

/// Result from supervisorEvaluate.
#[derive(Debug, Deserialize)]
pub(crate) struct SupervisorEvaluateResult {
    pub action: String,
    pub message: Option<String>,
    pub reasoning: Option<String>,
}

/// Params for queryFollowUp JSON-RPC request.
#[derive(Debug, Serialize)]
pub(crate) struct QueryFollowUpParams {
    pub message: String,
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/agent/protocol.rs
git commit -m "feat: add supervisor protocol types to Rust"
```

---

## Task 8: Implement Rust supervisor module

**Files:**
- Create: `src-tauri/src/agent/supervisor.rs`
- Modify: `src-tauri/src/agent/mod.rs` (add `mod supervisor;`)

- [ ] **Step 1: Create supervisor.rs**

Create `src-tauri/src/agent/supervisor.rs`:

```rust
//! Supervisor evaluation loop — intercepts queryComplete when auto-advance is on.
//!
//! Sends worker response to the sidecar's supervisorEvaluate method,
//! then either emits SupervisorReply + sends queryFollowUp, or returns
//! to let the normal auto-advance flow proceed.

use std::sync::Arc;

use serde_json::json;
use tauri_specta::Event;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use super::events::SupervisorReply;
use super::protocol::{
    JsonRpcRequest, JsonRpcMessage, QueryFollowUpParams,
    SupervisorEvaluateParams, SupervisorEvaluateResult,
    TicketContext, StepContext,
};
use crate::claude::StreamChunk;
use crate::settings;

/// Result of a supervisor evaluation loop.
pub(crate) enum SupervisorDecision {
    /// Supervisor says advance to next step.
    Advance,
    /// Supervisor loop exhausted max replies — fall back to user.
    MaxRepliesReached,
}

/// Run the supervisor evaluation loop.
///
/// Called from the read loop when `queryComplete` arrives and auto-advance is on.
/// Returns when the supervisor decides to advance or hits the reply limit.
///
/// During the loop, this function:
/// 1. Sends `supervisorEvaluate` to sidecar
/// 2. If "reply": emits SupervisorReply event, sends `queryFollowUp`, reads until next `queryComplete`
/// 3. If "advance": returns SupervisorDecision::Advance
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_supervisor_loop(
    project_dir: &str,
    issue_id: &str,
    worker_response: &str,
    ticket_context: TicketContext,
    socket_writer: &Arc<Mutex<tokio::io::WriteHalf<tokio::net::UnixStream>>>,
    next_id: &std::sync::atomic::AtomicU64,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
) -> Result<(SupervisorDecision, String, String), String> {
    // Load supervisor settings
    let supervisor_settings = settings::get_settings(project_dir)
        .unwrap_or_default()
        .supervisor
        .unwrap_or_default();

    let max_replies = supervisor_settings.max_replies_per_step;
    let custom_prompt = supervisor_settings.custom_prompt;

    let mut current_response = worker_response.to_string();
    let mut final_session_id = String::new();
    let mut response_text = worker_response.to_string();

    for turn in 0..max_replies {
        // Check if user clicked "Take Over" (set_auto_advance(false)) between turns
        {
            let map = app_handle.state::<super::AgentState>().auto_advance.read().await;
            if !map.get(project_dir).copied().unwrap_or(false) {
                log::info!("supervisor: auto-advance disabled mid-loop, returning to user");
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
        }

        // 1. Send supervisorEvaluate request
        let eval_params = SupervisorEvaluateParams {
            worker_response: current_response.clone(),
            ticket_context: TicketContext {
                title: ticket_context.title.clone(),
                description: ticket_context.description.clone(),
                acceptance_criteria: ticket_context.acceptance_criteria.clone(),
                current_step: StepContext {
                    index: ticket_context.current_step.index,
                    name: ticket_context.current_step.name.clone(),
                    prompt: ticket_context.current_step.prompt.clone(),
                },
            },
            system_prompt: custom_prompt.clone(),
        };

        let id = next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: "supervisorEvaluate".to_string(),
            params: Some(serde_json::to_value(&eval_params).map_err(|e| e.to_string())?),
        };

        let mut msg_bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        msg_bytes.push(b'\n');

        {
            let mut writer = socket_writer.lock().await;
            writer.write_all(&msg_bytes).await.map_err(|e| e.to_string())?;
            writer.flush().await.map_err(|e| e.to_string())?;
        }

        // 2. Read response (skip notifications, find our response by id)
        let eval_result = read_rpc_response(id, lines).await?;

        let result: SupervisorEvaluateResult =
            serde_json::from_value(eval_result).map_err(|e| format!("supervisor parse error: {e}"))?;

        match result.action.as_str() {
            "advance" => {
                log::info!("supervisor: advance (turn {turn}): {:?}", result.reasoning);
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
            "reply" => {
                let message = result.message.unwrap_or_default();
                log::info!("supervisor: reply (turn {turn}): {message}");

                // Emit SupervisorReply event to frontend
                let _ = SupervisorReply {
                    message: message.clone(),
                    reasoning: result.reasoning,
                    turn_number: turn + 1,
                }
                .emit(app_handle);

                // Persist supervisor reply to conversation log
                if let Some(writer) = conversation_writer {
                    let step = current_step_id.unwrap_or(issue_id);
                    let supervisor_msg = json!({
                        "type": "supervisor_reply",
                        "content": message,
                        "turn_number": turn + 1,
                    });
                    if let Err(e) = writer
                        .lock()
                        .await
                        .append_raw("supervisor_reply", &supervisor_msg, step)
                    {
                        log::error!("conversation: failed to append supervisor reply: {e}");
                    }
                }

                // 3. Send queryFollowUp
                let follow_up_params = QueryFollowUpParams {
                    message: message.clone(),
                };

                let follow_id = next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let follow_request = JsonRpcRequest {
                    jsonrpc: "2.0".to_string(),
                    id: follow_id,
                    method: "queryFollowUp".to_string(),
                    params: Some(
                        serde_json::to_value(&follow_up_params).map_err(|e| e.to_string())?,
                    ),
                };

                let mut follow_bytes =
                    serde_json::to_vec(&follow_request).map_err(|e| e.to_string())?;
                follow_bytes.push(b'\n');

                {
                    let mut writer = socket_writer.lock().await;
                    writer.write_all(&follow_bytes).await.map_err(|e| e.to_string())?;
                    writer.flush().await.map_err(|e| e.to_string())?;
                }

                // 4. Read until next queryComplete (processing streaming messages along the way)
                let (next_response, session_id) = read_until_query_complete(
                    issue_id,
                    on_chunk,
                    app_handle,
                    lines,
                    conversation_writer,
                    current_step_id,
                )
                .await?;

                current_response = next_response.clone();
                response_text = next_response;
                if !session_id.is_empty() {
                    final_session_id = session_id;
                }
            }
            other => {
                log::warn!("supervisor: unexpected action '{other}', treating as advance");
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
        }
    }

    // Max replies reached
    log::warn!("supervisor: max replies ({max_replies}) reached, falling back to user");
    Ok((SupervisorDecision::MaxRepliesReached, response_text, final_session_id))
}

/// Read JSON-RPC lines until we find a response matching the given request id.
/// Discards notifications while waiting.
async fn read_rpc_response(
    expected_id: u64,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
) -> Result<serde_json::Value, String> {
    let timeout = std::time::Duration::from_secs(30);
    loop {
        let line = tokio::time::timeout(timeout, lines.next_line())
            .await
            .map_err(|_| "supervisor: timeout waiting for response".to_string())?
            .map_err(|e| format!("supervisor: read error: {e}"))?
            .ok_or_else(|| "supervisor: socket closed while waiting for response".to_string())?;

        let msg: JsonRpcMessage =
            serde_json::from_str(&line).map_err(|e| format!("supervisor: parse error: {e}"))?;

        // Check if this is a response to our request
        if let Some(ref id) = msg.id {
            if id.as_u64() == Some(expected_id) {
                if let Some(error) = msg.error {
                    return Err(format!("supervisor: RPC error: {error:?}"));
                }
                return Ok(msg.result.unwrap_or(json!({})));
            }
        }

        // Otherwise it's a notification — discard (supervisor doesn't generate streaming messages)
    }
}

/// Read from the socket until a queryComplete notification arrives.
/// Processes streaming messages (forwarding to frontend via on_chunk) along the way.
/// Returns (response_text, session_id).
#[allow(clippy::too_many_arguments)]
async fn read_until_query_complete(
    issue_id: &str,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
) -> Result<(String, String), String> {
    let idle_timeout = std::time::Duration::from_secs(120);
    let mut response_text = String::new();
    let mut session_id = String::new();

    loop {
        let line_result = tokio::time::timeout(idle_timeout, lines.next_line()).await;
        let line = match line_result {
            Err(_) => return Err("supervisor: worker timed out".to_string()),
            Ok(Err(e)) => return Err(format!("supervisor: read error: {e}")),
            Ok(Ok(None)) => return Err("supervisor: socket closed".to_string()),
            Ok(Ok(Some(line))) => line,
        };

        let msg: JsonRpcMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let method = match msg.method.as_deref() {
            Some(m) => m,
            None => continue, // Response to our queryFollowUp — ignore
        };

        let params = msg.params.unwrap_or(json!({}));

        match method {
            "message" => {
                // Forward streaming messages to frontend
                let msg_type = params.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");

                let chunk_type = match msg_type {
                    "text" => "text",
                    "thinking" => "thinking",
                    "tool_start" | "tool_end" | "tool_input" | "tool_result" | "tool_progress" => "tool",
                    "error" => "error",
                    _ => "other",
                };

                let _ = on_chunk.send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: chunk_type.to_string(),
                    content: content.to_string(),
                });

                // Persist to conversation log
                if let Some(writer) = conversation_writer {
                    let step = current_step_id.unwrap_or(issue_id);
                    if let Err(e) = writer.lock().await.append_raw(msg_type, &params, step) {
                        log::error!("conversation: failed to append: {e}");
                    }
                }
            }
            "queryComplete" => {
                if let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) {
                    if !sid.is_empty() {
                        session_id = sid.to_string();
                    }
                }
                if let Some(resp) = params.get("response").and_then(|r| r.as_str()) {
                    response_text = resp.to_string();
                    let _ = on_chunk.send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "result".to_string(),
                        content: resp.to_string(),
                    });
                }
                return Ok((response_text, session_id));
            }
            "queryError" => {
                let message = params
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown agent error");
                return Err(format!("supervisor: worker error: {message}"));
            }
            _ => {
                // toolApproval, reviewRequest, etc. — these need the same handling as
                // the main read loop. For now, log and skip. The existing permission/review
                // handlers on AgentHandle will NOT work here because we're in a different
                // read context. This is a known limitation for v1 — permission requests
                // during supervisor follow-up turns won't be handled.
                log::warn!("supervisor: unhandled method during follow-up: {method}");
            }
        }
    }
}
```

- [ ] **Step 2: Add module declaration**

In `src-tauri/src/agent/mod.rs`, add after `mod protocol;`:

```rust
pub(crate) mod supervisor;
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully (may need import adjustments)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/supervisor.rs src-tauri/src/agent/mod.rs
git commit -m "feat: implement Rust supervisor evaluation loop"
```

---

## Task 9: Modify queryComplete handler for supervisor

**Files:**
- Modify: `src-tauri/src/agent/mod.rs:828-843`

This is the critical integration point. The `break 'outer Ok(())` on `queryComplete` becomes conditional.

- [ ] **Step 1: Add supervisor check to queryComplete handler**

Replace the `queryComplete` handler block (lines 828-843 in `mod.rs`) with:

```rust
"queryComplete" => {
    if let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) {
        if !sid.is_empty() {
            final_session_id = sid.to_string();
        }
    }
    if let Some(resp) = params.get("response").and_then(|r| r.as_str()) {
        response_text = resp.to_string();
        let _ = on_chunk.send(StreamChunk {
            issue_id: issue_id.to_string(),
            chunk_type: "result".to_string(),
            content: resp.to_string(),
        });
    }

    // Check if supervisor should evaluate
    let auto_advance_enabled = {
        let map = agent_state.auto_advance.read().await;
        map.get(project_dir).copied().unwrap_or(false)
    };

    if auto_advance_enabled {
        // Build ticket context for supervisor
        // ticket_title, ticket_description, ticket_acceptance_criteria,
        // step_index, step_name, step_prompt must be passed into execute_step
        let ticket_ctx = protocol::TicketContext {
            title: ticket_title.clone(),
            description: ticket_description.clone(),
            acceptance_criteria: ticket_acceptance_criteria.clone(),
            current_step: protocol::StepContext {
                index: step_index,
                name: step_name.clone(),
                prompt: step_prompt.clone(),
            },
        };

        match supervisor::run_supervisor_loop(
            project_dir,
            issue_id,
            &response_text,
            ticket_ctx,
            &socket_writer_clone,
            &next_id_clone,
            on_chunk,
            app_handle,
            &mut lines,
            conversation_writer,
            current_step_id,
        )
        .await
        {
            Ok((decision, final_resp, final_sid)) => {
                response_text = final_resp;
                if !final_sid.is_empty() {
                    final_session_id = final_sid;
                }
                match decision {
                    supervisor::SupervisorDecision::Advance => {
                        // Normal advance — break out of read loop
                    }
                    supervisor::SupervisorDecision::MaxRepliesReached => {
                        // Emit notification to frontend
                        let _ = on_chunk.send(StreamChunk {
                            issue_id: issue_id.to_string(),
                            chunk_type: "notification".to_string(),
                            content: "Supervisor reached reply limit — your turn".to_string(),
                        });
                    }
                }
            }
            Err(e) => {
                log::error!("supervisor loop error: {e}");
                // Fall through to normal break
            }
        }
    }

    break 'outer Ok(());
}
```

- [ ] **Step 2: Pass ticket context into execute_step**

The `execute_step` function needs additional parameters for ticket context. Add these parameters to `execute_step` signature:

```rust
pub async fn execute_step(
    project_dir: &str,
    issue_id: &str,
    prompt: &str,
    session_id: Option<&str>,
    allowed_tools: Option<Vec<String>>,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    tickets_dir_override: Option<&str>,
    _canonical_project_dir: Option<&str>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
    // NEW — ticket context for supervisor
    ticket_title: String,
    ticket_description: String,
    ticket_acceptance_criteria: Option<String>,
    step_index: u32,
    step_name: String,
) -> Result<(String, String), String> {
```

These values come from the workflow module which already has the ticket and step info when calling `execute_step`.

- [ ] **Step 3: Update callers of execute_step**

Find where `execute_step` is called (in `src-tauri/src/workflow/mod.rs`) and pass the ticket context. The workflow module already loads the ticket and step definition, so the data is available.

- [ ] **Step 4: Pass AgentState to the read loop**

The read loop needs access to `AgentState` to check `auto_advance`. This is already available via `app_handle.state::<AgentState>()`. Add:

```rust
let agent_state = app_handle.state::<AgentState>();
```

Before the read loop begins.

- [ ] **Step 5: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/workflow/mod.rs
git commit -m "feat: integrate supervisor into queryComplete handler"
```

---

## Task 10: Migrate frontend auto-advance to Tauri commands

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow.ts:28-34`
- Modify: `src/features/workflow/components/workflow-shell.tsx:251-276`

- [ ] **Step 1: Replace useState with Tauri commands in use-workflow.ts**

Replace the `useState(false)` for autoAdvance with a query-based approach:

```typescript
// Remove: const [autoAdvance, setAutoAdvance] = useState(false);

// Add query for auto-advance state
const autoAdvanceQuery = useQuery({
  queryKey: ["autoAdvance", projectDir],
  queryFn: () => commands.getAutoAdvance(projectDir),
  staleTime: Infinity, // Only changes via mutation
});

const autoAdvance = autoAdvanceQuery.data ?? false;

const setAutoAdvanceMutation = useMutation({
  mutationFn: (enabled: boolean) => commands.setAutoAdvance(projectDir, enabled),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["autoAdvance", projectDir] });
  },
});

const setAutoAdvance = useCallback(
  (enabled: boolean) => setAutoAdvanceMutation.mutate(enabled),
  [setAutoAdvanceMutation],
);
```

- [ ] **Step 2: Keep the existing auto-advance useEffect as-is**

Do NOT remove the auto-advance `useEffect` in `workflow-shell.tsx` (lines 251-276). It still works correctly because:
- When the supervisor is running, Rust holds `queryComplete` → `step_status` stays `"in_progress"` during the supervisor loop
- Only when the supervisor says "advance" does Rust let `queryComplete` through → workflow marks step as "completed" → frontend's existing effect triggers → advances to next step

The only change in this task is migrating the state source from `useState` to Tauri commands.

- [ ] **Step 3: Regenerate bindings**

Run: `bun run tauri:dev` briefly to regenerate `src/bindings.ts` with new commands/events. Or if there's a dedicated bindings generation command, use that.

- [ ] **Step 4: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/hooks/use-workflow.ts src/bindings.ts
git commit -m "feat: migrate auto-advance state to Rust backend"
```

---

## Task 11: Add SupervisorReply rendering to chat view

**Files:**
- Modify: `src/features/workflow/components/views/chat-view.tsx`

- [ ] **Step 1: Add SupervisorReply message bubble component**

Add a new component in `chat-view.tsx`:

```typescript
function SupervisorReplyBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end my-2">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              Auto-reply
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 shrink-0 mt-0.5">
          <Play className="w-3.5 h-3.5 text-amber-500" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Listen for SupervisorReply events**

Add event listener in the chat view (or in the parent workflow hook) to capture supervisor replies and add them to the message stream:

```typescript
// In ChatView component or useWorkflowStreaming hook
useEffect(() => {
  const unlisten = events.supervisorReply.listen((event) => {
    // Add to message stream as a supervisor reply block
    addMessage({
      type: "supervisor_reply",
      content: event.payload.message,
      turnNumber: event.payload.turn_number,
    });
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

- [ ] **Step 3: Render supervisor replies in the content block loop**

In the content block rendering section of ChatView, add a case for supervisor_reply type that renders `SupervisorReplyBubble`.

- [ ] **Step 4: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/components/views/chat-view.tsx
git commit -m "feat: render supervisor auto-replies in chat stream"
```

---

## Task 12: Add "Take Over" button to chat view

**Files:**
- Modify: `src/features/workflow/components/views/chat-view.tsx`

- [ ] **Step 1: Add supervisor-active state detection**

The chat view needs to know when the supervisor loop is running. This can be detected by: auto-advance is on AND step is in_progress AND we've received at least one SupervisorReply event for the current step.

Add state tracking:

```typescript
const [supervisorActive, setSupervisorActive] = useState(false);

// Set to true when we receive a SupervisorReply, false when step completes
useEffect(() => {
  if (stepStatus === "completed" || stepStatus === "pending") {
    setSupervisorActive(false);
  }
}, [stepStatus]);

// In the SupervisorReply listener:
setSupervisorActive(true);
```

- [ ] **Step 2: Disable input and show "Take Over" during supervisor loop**

In the `ComposeToolbar` area, conditionally disable input and show a "Take Over" button:

```typescript
{supervisorActive ? (
  <div className="flex items-center justify-center gap-3 px-4 py-3 border-t bg-amber-50/50 dark:bg-amber-950/20">
    <span className="text-xs text-amber-600 dark:text-amber-400">
      Supervisor is responding...
    </span>
    <Button
      size="sm"
      variant="outline"
      onClick={() => setAutoAdvance(false)}
      className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
    >
      Take Over
    </Button>
  </div>
) : (
  <ComposeToolbar ... />  // existing compose toolbar
)}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src/features/workflow/components/views/chat-view.tsx
git commit -m "feat: add Take Over button during supervisor loop"
```

---

## Task 13: Add Supervisor settings section to settings page

**Files:**
- Modify: `src/features/settings/components/settings-page.tsx`

- [ ] **Step 1: Add SupervisorSettings type import**

Update the import to include the new type (from `src/bindings.ts` after regeneration):

```typescript
import type { ProjectSettings, SyncSettings, WorktreeSettings, SupervisorSettings } from "@/shared/lib/sync";
```

Or import directly from bindings if the type isn't re-exported yet.

- [ ] **Step 2: Add updateSupervisor callback**

```typescript
const updateSupervisor = useCallback((patch: Partial<SupervisorSettings>) => {
  setDraft((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      supervisor: {
        max_replies_per_step: 5,
        ...prev.supervisor,
        ...patch,
      },
    };
  });
}, []);
```

- [ ] **Step 3: Add Supervisor settings section in the JSX**

After the Worktrees section, add:

```tsx
{/* Supervisor Section */}
<section className="space-y-4">
  <div>
    <h4 className="text-sm font-semibold">Auto-Advance Supervisor</h4>
    <p className="text-xs text-muted-foreground mt-1">
      When auto-advance is enabled, the supervisor evaluates agent output and
      replies on your behalf instead of blindly advancing
    </p>
  </div>
  <Separator />
  <div className="space-y-4">
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="supervisor-max-replies">
        Max replies per step
      </label>
      <Input
        id="supervisor-max-replies"
        type="number"
        min={1}
        max={20}
        value={effectiveDraft.supervisor?.max_replies_per_step ?? 5}
        onChange={(e) =>
          updateSupervisor({
            max_replies_per_step: Math.max(1, Math.min(20, Number(e.target.value) || 5)),
          })
        }
        className="text-sm w-24"
      />
      <p className="text-[11px] text-muted-foreground">
        Maximum supervisor replies before falling back to manual input (default: 5)
      </p>
    </div>
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="supervisor-prompt">
        Custom supervisor prompt
      </label>
      <Textarea
        id="supervisor-prompt"
        value={effectiveDraft.supervisor?.custom_prompt ?? ""}
        onChange={(e) =>
          updateSupervisor({
            custom_prompt: e.target.value || undefined,
          })
        }
        placeholder="Leave empty for default. Custom prompts replace the guidelines section only — the preamble and JSON format instructions are always included."
        className="font-mono text-sm min-h-[120px]"
      />
      <p className="text-[11px] text-muted-foreground">
        Customize how the supervisor evaluates agent responses. Empty = use default guidelines.
      </p>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/components/settings-page.tsx
git commit -m "feat: add Auto-Advance Supervisor section to settings UI"
```

---

## Task 14: Build agent sidecar and integration test

**Files:**
- No new files

- [ ] **Step 1: Build the agent sidecar**

Run: `bun run agent:build`
Expected: Compiles successfully to `src-tauri/binaries/agent-*-apple-darwin`

- [ ] **Step 2: Run type checks**

Run: `npx tsc --noEmit && cd src-tauri && cargo check`
Expected: Both pass

- [ ] **Step 3: Run existing tests**

Run: `bun run test`
Expected: All existing tests pass (no regressions)

- [ ] **Step 4: Run lint**

Run: `bun run lint && cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings`
Expected: No lint errors

- [ ] **Step 5: Manual test plan**

1. Open MeldUI, navigate to a ticket with a workflow
2. Toggle auto-advance ON
3. Execute a step where the agent asks a question
4. Verify: supervisor reply appears in chat with "Auto-reply" label
5. Verify: chat input is disabled with "Take Over" button
6. Click "Take Over" — verify input re-enables
7. Toggle auto-advance ON again, execute a step that completes cleanly
8. Verify: supervisor says "advance", step advances normally
9. Go to Settings, verify Supervisor section appears
10. Set max replies to 1, verify it stops after 1 reply

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: build sidecar and verify integration"
```
