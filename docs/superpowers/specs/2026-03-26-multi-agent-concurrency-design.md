# Multi-Agent Concurrency

Enable MeldUI to run multiple ticket workflows simultaneously with no artificial upper bound. Optimize memory by unloading idle sessions after a timeout.

## Problem

Today, MeldUI can only execute one ticket's agent at a time. `AgentState` holds `Mutex<Option<AgentHandle>>` — a single slot. Starting a second workflow either blocks on the mutex or overwrites the first. The frontend also assumes a single active ticket across all workflow hooks.

## Solution: Approach A — HashMap of AgentHandles

Replace the single-slot agent handle with a map keyed by `issue_id`. Each concurrent workflow spawns its own sidecar process with its own socket. The frontend tracks per-ticket state in keyed records rather than single values.

## Design

### 1. Rust Backend — Multi-Agent State

**Current:**
```rust
pub struct AgentState {
    pub handle: Mutex<Option<AgentHandle>>,
    pub auto_advance: tokio::sync::RwLock<HashMap<String, bool>>,
}
```

**New:**
```rust
pub struct AgentState {
    pub handles: Mutex<HashMap<String, AgentHandle>>,
    pub auto_advance: tokio::sync::RwLock<HashMap<String, bool>>,
}
```

**Lifecycle:**
- `workflow_execute_step(issue_id, ...)` spawns a sidecar, inserts `handles[issue_id] = agent_handle`
- On completion/timeout/error, removes `handles[issue_id]`
- The mutex is held only during insert/remove, not during execution — no contention between concurrent agents

**Idle timeout:** Already exists per-sidecar in `run_agent_sidecar`. After inactivity, the sidecar is killed and the handle removed. No change needed to timeout logic itself.

### 2. Tauri Command Signatures

Commands that currently assume a single agent get an `issue_id` parameter:

| Command | Current Signature | New Signature |
|---|---|---|
| `agent_permission_respond` | `(request_id, allowed)` | `(issue_id, request_id, allowed)` |
| `agent_review_respond` | `(request_id, submission)` | `(issue_id, request_id, submission)` |
| `agent_set_model` | `(model)` | `(issue_id, model)` |
| `agent_set_thinking` | `(thinking_type, budget_tokens)` | `(issue_id, thinking_type, budget_tokens)` |
| `agent_set_effort` | `(effort)` | `(issue_id, effort)` |
| `agent_set_fast_mode` | `(enabled)` | `(issue_id, enabled)` |

Error changes from `"No active agent session"` to `"No active agent for ticket {issue_id}"`.

### 3. Event Payload Changes

**Add `issue_id` field to:**
- `AgentPermissionRequest` — currently has no issue context; frontend assumes single agent
- `SupervisorEvaluating` — currently empty struct
- `SupervisorReply` — currently has no issue context

**Already has ticket context (no change):**
- `AgentReviewFindingsRequest` — has `ticket_id`
- `StatusUpdateEvent` — has `ticket_id`
- `SectionUpdateEvent` — has `ticket_id`
- `PrUrlReportedEvent` — has `ticket_id`
- `SubtaskCreated/Updated/Closed` — has `parent_id`
- `NotificationEvent` — stateless, no routing needed

**New event:**
- `AgentSessionEnded { issue_id: String }` — emitted when a sidecar exits (completion, timeout, or error). Used by the frontend to start the unload timer.

### 4. Frontend — useWorkflow Becomes Per-Ticket

**State changes in `useWorkflow`:**

| Current | New |
|---|---|
| `currentState: WorkflowState \| null` | `workflowStates: Record<string, WorkflowState>` |
| `loading: boolean` | `loadingTickets: Record<string, boolean>` |
| `error: string \| null` | `errors: Record<string, string \| null>` |
| `activeTicketId: string \| null` | `activeTicketId: string \| null` (unchanged — "currently viewed") |

**Convenience accessors** derived from `activeTicketId`:
```ts
currentState: workflowStates[activeTicketId] ?? null
loading: loadingTickets[activeTicketId] ?? false
error: errors[activeTicketId] ?? null
```

**New accessor** for sidebar badges:
```ts
getTicketStatus(ticketId: string): "running" | "idle" | null
```

**`executeStep`** sets `loadingTickets[issueId] = true` instead of a global boolean. Multiple calls with different `issueId`s can be in-flight simultaneously.

### 5. Frontend — Streaming for Multiple Agents

**Current:** `useWorkflowStreaming` filters chunks by `activeTicketId` and uses a single `executingStepRef`.

**Changes:**
- Remove the `activeTicketId` filter (line 74). Chunks from all agents land in `stepOutputs` keyed by `stepId`.
- Replace `executingStepRef: string | null` with `executingStepsRef: Record<string, string | null>` keyed by `issue_id`. When a chunk arrives, look up the step via `chunk.issue_id`.

**Memory cleanup:** When `AgentSessionEnded` fires, start a 10-minute timer. On expiry, clear that ticket's entries from `stepOutputs`.

### 6. Frontend — Sub-hooks (Permissions, Review, Notifications)

These hooks listen to Tauri events and need to key state by `issue_id`:

**`useWorkflowPermissions`:**
- `pendingPermission: PermissionRequest | null` → `pendingPermissions: Record<string, PermissionRequest>`
- Event handler uses `issue_id` from the updated `AgentPermissionRequest` payload
- `respondToPermission` gains `issueId` param, calls `commands.agentPermissionRespond(issueId, requestId, allowed)`
- Convenience: surface `pendingPermissions[activeTicketId]` as `pendingPermission` for the viewed ticket

**`useWorkflowReview`:**
- Same pattern — key review state by ticket ID
- `AgentReviewFindingsRequest` already has `ticket_id`

**`useWorkflowNotifications`:**
- Already uses `ticket_id` from event payloads — minimal change needed

### 7. Sidebar Status Badges

Add a small running indicator (pulsing dot or spinner) per ticket in the sidebar.

**Data flow:** `useWorkflow` exposes `runningTicketIds` or `getTicketStatus()`. Sidebar checks each ticket and renders the indicator.

**Source of truth:** `loadingTickets` record — any ticket with `loadingTickets[id] === true` has an active agent.

### 8. Idle Timeout & Memory Unloading

**Trigger:** `AgentSessionEnded { issue_id }` event from Rust.

**Frontend timer (10 minutes):**
1. On `AgentSessionEnded`, start a per-ticket timer
2. On expiry, clear:
   - `stepOutputs` entries for that ticket
   - `workflowStates[issueId]`
   - `loadingTickets[issueId]`
   - `errors[issueId]`
3. If the user re-starts the agent before timer fires, cancel the timer

**Rehydration:** When navigating to an unloaded ticket, `getWorkflowState(issueId)` fetches from disk (already works today). Streaming outputs are gone but the step is complete — conversation history shows what happened.

**No unloading while active:** Timer only starts when the agent process ends.

## What Doesn't Change

- **Sidecar code** (`src/agent/`) — already handles one session per process; we just spawn multiple processes
- **Workflow state persistence** — already per-ticket in beads metadata
- **Conversation history** — already per-ticket
- **Ticket page UI** — single-ticket view, unchanged
- **Sidecar binary** — no changes needed

## Acceptance Criteria

### Given multiple tickets in the backlog, When the user starts workflows on two tickets, Then both agents run simultaneously
- Two sidecar processes spawn with separate sockets
- Both `handles[issueA]` and `handles[issueB]` exist in the map
- Streaming output accumulates for both tickets independently

### Given two running agents, When the user views ticket A, Then they see live streaming output as if it had been running there the whole time
- Switching from ticket B to ticket A shows accumulated output instantly
- New chunks continue to appear in real-time
- No "loading" or "catching up" flash

### Given two running agents, When a permission request arrives for ticket B while viewing ticket A, Then the permission is held until the user views ticket B
- `pendingPermissions` keyed by issue_id stores the request
- Sidebar badge indicates ticket B needs attention
- When user navigates to B, the permission dialog appears

### Given a ticket whose agent completed 10 minutes ago, When the unload timer fires, Then in-memory state is cleared
- `stepOutputs`, `workflowStates`, `loadingTickets`, `errors` entries removed for that ticket
- Navigating back to the ticket rehydrates from disk via `getWorkflowState`

### Given a ticket whose agent completed, When the user restarts the agent before the 10-minute timer, Then the timer is cancelled and state is preserved
- No clearing occurs
- Streaming output continues to accumulate

### Given a running agent for ticket A, When `agent_set_model(issueA, model)` is called, Then only ticket A's agent receives the model change
- Other running agents are unaffected
- Calling with a non-existent issue_id returns `"No active agent for ticket {issue_id}"`
