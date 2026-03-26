# Supervisor Auto-Advance Design

## Problem

The current auto-advance mode blindly advances to the next workflow step as soon as the agent finishes processing the step prompt. This breaks when the agent asks clarifying questions, requests confirmation, or needs multiple exchanges before the step is truly complete. In auto-mode, there's no one to answer — the next step just starts with the question unaddressed.

## Solution

Introduce a **supervisor agent** — a lightweight Haiku-powered evaluator that sits between the worker agent and the auto-advance trigger. When auto-advance is enabled, the supervisor reads the worker's output after each turn and decides: reply on behalf of the user, or advance to the next step.

The supervisor only runs when auto-advance is enabled. When auto-advance is off, the existing manual flow is unchanged.

## Key Decisions

- **Turn-based**: Worker finishes → supervisor evaluates → supervisor replies or advances
- **Visible with override**: Supervisor replies appear in the chat stream; user can take over at any point
- **Model**: Haiku by default, configurable later
- **Worker sees normal user messages**: No special tagging — the worker can't distinguish supervisor replies from real user input
- **Narrow action space (v1)**: Supervisor can only reply or advance — no skip, abort, or sub-ticket creation
- **Configurable prompt and limits**: Project settings control the supervisor's system prompt and max replies per step
- **Auto-advance state moved to Rust**: Currently a React-only flag; must be synced to Rust so the backend can orchestrate the supervisor loop

## Architecture

The supervisor lives in the Rust backend as a decision point in the `queryComplete` flow. This requires moving the auto-advance flag from frontend-only React state to Rust-managed state, synced via a new `set_auto_advance` Tauri command.

When the worker finishes a turn and auto-advance is enabled:

1. Rust intercepts the `queryComplete` notification
2. Sends worker output + ticket context to the sidecar via new JSON-RPC method `supervisorEvaluate`
3. Sidecar makes a single synchronous Haiku API call (request-response, not streaming) with the supervisor prompt
4. Returns structured decision: `{ action: "reply", message }` or `{ action: "advance" }`
5. If `reply` → Rust emits `SupervisorReply` Tauri event, then sends a `queryFollowUp` (new JSON-RPC method) to continue the existing worker session with the supervisor's message. Loop back to step 1.
6. If `advance` → Rust emits normal `queryComplete`, triggering existing auto-advance flow
7. Safety limit: max replies per step (default 5, configurable). Exceeding it emits `queryComplete` to frontend with a notification toast "Supervisor reached reply limit — your turn". Auto-advance stays on but the supervisor won't re-engage until the next step.

```
Worker Agent (Claude Agent SDK)
    ↕ JSON-RPC (existing query/queryComplete — streaming)
Rust Backend (agent.rs + new supervisor.rs)
    ↕ JSON-RPC (new supervisorEvaluate — synchronous request/response)
Sidecar (new supervisor.ts module)
    ↕ Anthropic API (Haiku, direct SDK call)
```

### Auto-advance state migration

Currently, `autoAdvance` is React state in `use-workflow.ts` and the `useEffect` in `workflow-shell.tsx` watches for `step_status === "completed"` to trigger advancement. With this change:

- New Tauri commands: `set_auto_advance(project_dir: String, enabled: bool)` and `get_auto_advance(project_dir: String) -> bool`
- Auto-advance flag stored on `AppState` keyed by `project_dir` (not `WorkflowState`, since auto-advance is a session-level preference, not per-ticket)
- Frontend toggle calls `set_auto_advance` instead of setting local state
- Frontend reads initial value via `get_auto_advance` on mount
- Rust checks this flag when `queryComplete` arrives to decide whether to enter the supervisor loop

## Sidecar Protocol

### Request: `supervisorEvaluate`

```typescript
{
  method: "supervisorEvaluate",
  params: {
    workerResponse: string,       // the `response` string from queryComplete
    ticketContext: {
      title: string,
      description: string,
      acceptanceCriteria?: string,
      currentStep: { index: number, name: string, prompt: string }
    },
    systemPrompt?: string         // custom prompt from settings, null = use default
  }
}
```

Note: `workerResponse` is the `response` field from the existing `queryComplete` notification. If the worker's final response is terse (e.g., "Done!"), the supervisor still has the step prompt and ticket context to evaluate whether the step is complete.

`conversationSummary` is omitted in v1 — future enhancement for multi-turn context.

### Response

```typescript
{
  result: {
    action: "reply" | "advance",
    message?: string,             // present when action is "reply"
    reasoning?: string            // included in SupervisorReply event for debug panel
  }
}
```

### Implementation

- New `supervisor.ts` module in `src/agent/`
- Uses `@anthropic-ai/sdk` directly (not the Agent SDK) for the Haiku call
- API key sourced from `ANTHROPIC_API_KEY` environment variable (same env var the Agent SDK uses)
- Single synchronous API call per evaluation — no streaming, no conversation history
- Parses JSON from Haiku response; retries once on malformed JSON before falling back to `{ action: "advance" }`
- On network errors, rate limits, or auth failures: falls back to `{ action: "advance" }` with a notification to the frontend

### New JSON-RPC method: `queryFollowUp`

Sends a user message to the existing active agent session without creating a new `ClaudeAgent` instance. Used by the supervisor loop to inject replies into the ongoing conversation.

```typescript
{
  method: "queryFollowUp",
  params: {
    message: string               // the supervisor's reply, sent as a user message
  }
}
```

The sidecar keeps a reference to the active `ClaudeAgent` instance from the most recent `query` call. `queryFollowUp` sends the message to that instance, which continues the same session. The response flow (streaming notifications, `queryComplete`) is identical to a regular `query`.

If no active agent exists (e.g., it was already cleaned up), `queryFollowUp` returns an error and Rust falls back to emitting `queryComplete` normally.

## Rust Backend Changes

### New module: `src-tauri/src/agent/supervisor.rs`

- `evaluate_worker_response()` — called when worker completes a turn and auto-advance is enabled
- Sends `supervisorEvaluate` JSON-RPC call to sidecar
- Loops: reply → emit event, send `queryFollowUp`, wait for next `queryComplete`; advance → return to normal flow
- Enforces max reply limit from project settings

### New Tauri commands: `set_auto_advance` / `get_auto_advance`

```rust
#[tauri::command]
#[specta::specta]
fn set_auto_advance(state: State<AppState>, project_dir: String, enabled: bool) -> Result<()>

#[tauri::command]
#[specta::specta]
fn get_auto_advance(state: State<AppState>, project_dir: String) -> Result<bool>
```

Stores the flag on `AppState` keyed by `project_dir`. This is a session-level preference (not per-ticket), so it persists across ticket switches within the same project session but resets on app restart.

### Settings: `src-tauri/src/settings.rs`

New section in project settings:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorSettings {
    pub custom_prompt: Option<String>,  // None = use default
    pub max_replies_per_step: u32,      // default: 5
}
```

Added as `Option<SupervisorSettings>` field on `ProjectSettings` with `#[serde(default)]`.

### New Tauri event: `SupervisorReply`

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SupervisorReply {
    pub message: String,
    pub reasoning: Option<String>,  // for debug panel
    pub turn_number: u32,
}
```

### Modified `queryComplete` handler

Currently, `queryComplete` triggers `break 'outer Ok(())` in the read loop at `agent/mod.rs`. With the supervisor:

- When auto-advance is **off**: behavior unchanged — `break` out of the loop, emit `queryComplete` to frontend
- When auto-advance is **on**: instead of breaking, call `supervisor::evaluate_worker_response()`. If supervisor says "reply", send `queryFollowUp` to sidecar and **continue the read loop** to receive the next `queryComplete`. If supervisor says "advance", break as normal.

This means the `break 'outer` becomes conditional on auto-advance state. The read loop stays alive during the supervisor conversation.

## Frontend Changes

### Chat stream

- New listener for `SupervisorReply` events
- Supervisor replies rendered in the conversation stream with distinct styling: lighter color, "Auto-reply" label
- Inserted into the same chat history as worker messages and user messages
- Supervisor replies are persisted to the conversation log (tagged as `supervisor` source) so they appear correctly on app restart
- `reasoning` field available in debug panel

### Override mechanism — input during supervisor loop

When the supervisor loop is running:
- Chat input is **disabled** (greyed out) with a "Take over" button displayed
- Clicking "Take over" calls `set_auto_advance(false)`
- Rust finishes the current worker turn, then emits `queryComplete` normally
- Chat input re-enables, user types their own reply

This prevents race conditions — users cannot submit input while the supervisor is mid-loop. The frontend's `executingRef` guard should also be aware that Rust owns the execution lifecycle during the supervisor loop — the frontend should not attempt to execute steps while auto-advance is active and the supervisor is running.

### Auto-advance toggle migration

- Toggle calls `set_auto_advance` Tauri command instead of setting React state
- UI derives auto-advance status from Rust state (via query or event listener)
- The `useEffect` in `workflow-shell.tsx` that watches `step_status` is replaced by Rust-side orchestration when auto-advance is enabled

### Settings UI

New "Auto-Advance Supervisor" section in project settings:
- **Custom supervisor prompt** — textarea with placeholder showing default, empty = use default
- **Max replies per step** — number input, default 5
- Persisted via existing settings infrastructure

Note: Custom prompts replace the _guidelines_ section of the default prompt. The JSON format instructions (the "Respond with JSON only" block) are **always appended** regardless of custom prompt, to prevent parsing breakage.

### No changes to

- "Next Step" button behavior
- Worker streaming UI

## Default Supervisor Prompt

```
You are a workflow supervisor for MeldUI. An AI coding agent is working on a ticket, and you are evaluating its latest response to decide what to do next.

You have two actions available:
- "reply": The agent is asking a question or needs guidance. Respond on behalf of the user.
- "advance": The agent has completed the current step's work. Move to the next step.

Guidelines for your decision:
- If the agent is asking a clarifying question, answer it using the ticket context provided.
- If the agent is asking for permission or confirmation to proceed, approve it.
- If the agent says it's done, or its output clearly fulfills the step's prompt, choose "advance".
- If the agent is stuck or going in circles, choose "advance" to move on.
- Keep your replies concise and direct. You are unblocking the agent, not collaborating.

Respond with JSON only:
{ "action": "reply", "message": "your response here", "reasoning": "why you chose this" }
or
{ "action": "advance", "reasoning": "why the step is complete" }
```

When a custom prompt is configured, it replaces the "Guidelines" section above. The preamble ("You are a workflow supervisor...") and the JSON format instructions ("Respond with JSON only...") are always included.

## Testing Strategy

- **Unit tests**: Supervisor decision logic in sidecar (`supervisor.ts`) — mock the Anthropic API call, verify correct action/message for various worker outputs
- **Rust tests**: `supervisor.rs` loop logic — mock the JSON-RPC call, verify loop termination on "advance", max-reply enforcement, event emission
- **Mock sidecar**: Extend `e2e/mock-sidecar/` to support `supervisorEvaluate` responses for e2e testing
- **Manual testing**: Verify chat stream rendering, "Take over" flow, settings persistence

## Cost Considerations

Each supervisor evaluation is one Haiku API call (small input: worker response + ticket context + prompt). For a typical step with 0-2 supervisor replies, this adds minimal cost. The max-replies safety limit caps worst-case cost per step. Token usage per evaluation should be logged to the debug panel for visibility.

## Out of Scope (v1)

- Supervisor skipping steps
- Supervisor modifying step prompts
- Supervisor aborting workflows
- Supervisor creating sub-tickets
- User-configurable supervisor model (Haiku-only for now)
- Supervisor conversation history across turns (stateless per call)
- `conversationSummary` field population (always null)
- Cost tracking beyond debug panel visibility
