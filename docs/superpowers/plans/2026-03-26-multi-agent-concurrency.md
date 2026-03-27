# Multi-Agent Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable MeldUI to run multiple ticket agent workflows concurrently, with per-ticket state management and idle timeout unloading.

**Architecture:** Replace `Mutex<Option<AgentHandle>>` with `Mutex<HashMap<String, Arc<AgentHandle>>>` on the Rust side. Thread `issue_id` through all agent commands. Convert frontend hooks from scalar state to per-ticket Records keyed by issue_id. Add sidebar running indicators and 10-minute idle unload timers.

**Tech Stack:** Rust (Tauri v2, specta), TypeScript (React 19, TanStack Query), Tauri events, Unix sockets

**Spec:** `docs/superpowers/specs/2026-03-26-multi-agent-concurrency-design.md`

---

## File Map

### Rust — Modified
| File | Responsibility |
|------|---------------|
| `src-tauri/src/agent/mod.rs` | AgentState struct, execute_step handle insertion/removal, all `agent_set_*` commands |
| `src-tauri/src/agent/events.rs` | Event structs — add `issue_id` fields, new `AgentSessionEnded` |
| `src-tauri/src/agent/supervisor.rs` | SupervisorEvaluating/SupervisorReply emit sites — add `issue_id` |
| `src-tauri/src/lib.rs` | Tauri command wrappers — add `issue_id` params, update `workflow_state`, register new event |

### Frontend — Modified
| File | Responsibility |
|------|---------------|
| `src/features/workflow/hooks/use-workflow.ts` | Per-ticket state Records, keyed convenience accessors |
| `src/features/workflow/hooks/use-workflow-streaming.ts` | Remove activeTicketId filter, multi-key executingStepsRef |
| `src/features/workflow/hooks/use-workflow-permissions.ts` | Per-ticket pending permissions keyed by issue_id |
| `src/features/workflow/hooks/use-workflow-review.ts` | Remove activeTicketId filter, key review state by ticket_id |
| `src/features/workflow/hooks/use-workflow-notifications.ts` | Remove activeTicketId filter, key state by ticket_id |
| `src/features/workflow/hooks/use-agent-config.ts` | Pass issue_id to agent config commands |
| `src/shared/layout/app-sidebar.tsx` | Running indicator badge per ticket |
| `src/app/App.tsx` | Pass runningTicketIds to sidebar |

---

## Task 1: Rust — AgentState HashMap + Arc Pattern

**Files:**
- Modify: `src-tauri/src/agent/mod.rs:189-203` (AgentState struct + impl)
- Modify: `src-tauri/src/agent/mod.rs:647-658` (handle insertion in execute_step)
- Modify: `src-tauri/src/agent/mod.rs:1043-1065` (handle cleanup on completion/timeout)

- [ ] **Step 1: Change AgentState struct from single Option to HashMap**

In `src-tauri/src/agent/mod.rs`, update the struct and constructor:

```rust
use std::sync::Arc;

pub struct AgentState {
    pub handles: Mutex<HashMap<String, Arc<AgentHandle>>>,
    pub auto_advance: tokio::sync::RwLock<std::collections::HashMap<String, bool>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
            auto_advance: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        }
    }
}
```

- [ ] **Step 2: Update execute_step — reject duplicate issue_id and insert into map**

In `src-tauri/src/agent/mod.rs`, around line 647-658, replace the handle storage.

**Important:** `workflow_suggest` and `workflow_execute_commit_action` also call `execute_step` internally (through `workflow/mod.rs` and `workflow/diff.rs`). They already pass `issue_id`, so they will participate in the HashMap automatically. The duplicate-rejection check must NOT block these — it should only block truly concurrent calls. Since `workflow_suggest` and `workflow_execute_commit_action` are sequential operations (they await `execute_step`), the handle will be removed before the next call. No special handling needed.

```rust
// Before spawning — check for existing agent on this ticket
if let Some(state) = app_handle.try_state::<AgentState>() {
    let guard = state.handles.lock().await;
    if guard.contains_key(issue_id) {
        return Err(format!("Agent already running for ticket {issue_id}"));
    }
}

// ... after creating agent_handle ...

// Store the handle in Tauri managed state
if let Some(state) = app_handle.try_state::<AgentState>() {
    let mut handle_guard = state.handles.lock().await;
    handle_guard.insert(issue_id.to_string(), Arc::new(agent_handle));
}
```

- [ ] **Step 3: Update cleanup paths — remove from map by issue_id**

In `src-tauri/src/agent/mod.rs`, update all cleanup paths:

**Timeout path (~line 1043):** Already clears the handle. Change `*handle_guard = None` to `handle_guard.remove(issue_id)`.

**Error path (~line 1052-1055):** Currently does NOT clear the handle — it only kills the child and returns. This is a bug in the existing code. Add handle cleanup here too, otherwise a crashed agent leaves a stale entry blocking future launches.

**Success path (~line 1062):** Already clears the handle. Change `*handle_guard = None` to `handle_guard.remove(issue_id)`.

All three paths use the same pattern:

```rust
if let Some(state) = app_handle.try_state::<AgentState>() {
    let mut handle_guard = state.handles.lock().await;
    handle_guard.remove(issue_id);
}
```

- [ ] **Step 4: Run cargo check to verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | head -40`
Expected: Compilation errors in `agent_set_*` functions that still reference `state.handle` — this is expected and fixed in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/mod.rs
git commit -m "refactor: change AgentState from single Option to HashMap<String, Arc<AgentHandle>>"
```

---

## Task 2: Rust — Update Agent Config Commands to Use HashMap

**Files:**
- Modify: `src-tauri/src/agent/mod.rs:205-312` (agent_set_model, agent_set_thinking, agent_set_effort, agent_set_fast_mode)

- [ ] **Step 1: Add issue_id parameter and use Arc clone-out pattern for agent_set_model**

Update both the command wrapper and inner function:

```rust
#[tauri::command]
#[specta::specta]
pub async fn agent_set_model(
    issue_id: String,
    model: String,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    agent_set_model_inner(&issue_id, model, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn agent_set_model_inner(issue_id: &str, model: String, state: &AgentState) -> Result<(), AgentError> {
    let handle = {
        let guard = state.handles.lock().await;
        guard.get(issue_id).cloned()
            .ok_or(AgentError::NotRunning)?
    };
    let id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "agent/set_model",
        "params": { "model": model },
        "id": id
    });
    let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
    handle.send_raw(&json).await
}
```

- [ ] **Step 2: Apply same pattern to agent_set_thinking**

Same change: add `issue_id: String` param, clone Arc from map, drop lock before send.

- [ ] **Step 3: Apply same pattern to agent_set_effort**

Same change as above.

- [ ] **Step 4: Apply same pattern to agent_set_fast_mode**

Same change as above.

- [ ] **Step 5: Run cargo check**

Run: `cd src-tauri && cargo check 2>&1 | head -40`
Expected: Compilation errors in `lib.rs` command wrappers — fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/mod.rs
git commit -m "refactor: add issue_id parameter to all agent config commands"
```

---

## Task 3: Rust — Update lib.rs Command Wrappers

**Files:**
- Modify: `src-tauri/src/lib.rs:66-100` (agent_permission_respond, agent_review_respond)

- [ ] **Step 1: Update agent_permission_respond to use issue_id**

```rust
#[tauri::command]
#[specta::specta]
async fn agent_permission_respond(
    issue_id: String,
    request_id: String,
    allowed: bool,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle = {
        let guard = state.handles.lock().await;
        guard.get(&issue_id).cloned()
            .ok_or_else(|| format!("No active agent for ticket {issue_id}"))?
    };
    handle
        .respond_to_permission(&request_id, allowed)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Update agent_review_respond to use issue_id**

```rust
#[tauri::command]
#[specta::specta]
async fn agent_review_respond(
    issue_id: String,
    request_id: String,
    submission: serde_json::Value,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle = {
        let guard = state.handles.lock().await;
        guard.get(&issue_id).cloned()
            .ok_or_else(|| format!("No active agent for ticket {issue_id}"))?
    };
    handle
        .respond_to_review(&request_id, submission)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Update workflow_state stale-step detection**

In `src-tauri/src/lib.rs:338-366`, the `workflow_state` command uses `state.handle.lock()` to detect stale in-progress steps (no running sidecar = stale). Update to check the HashMap for the specific ticket:

```rust
async fn workflow_state(
    project_dir: String,
    issue_id: String,
    state: tauri::State<'_, AgentState>,
) -> Result<Option<WorkflowState>, String> {
    let wf_state = workflow::get_workflow_state(&project_dir, &issue_id)?;

    if let Some(ref ws) = wf_state {
        if ws.step_status == workflow::StepStatus::InProgress {
            let handle_guard = state.handles.lock().await;
            if !handle_guard.contains_key(&issue_id) {
                // No active sidecar for THIS ticket — step is stale
                let failed_state = workflow::update_step_status(
                    &project_dir,
                    &issue_id,
                    workflow::StepStatus::Failed(
                        "Session interrupted — click Resume to continue".to_string(),
                    ),
                )?;
                return Ok(Some(failed_state));
            }
        }
    }

    Ok(wf_state)
}
```

- [ ] **Step 4: Run cargo check**

Run: `cd src-tauri && cargo check 2>&1 | head -40`
Expected: PASS — all Rust-side handle references should now compile.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "refactor: add issue_id to permission/review commands and fix workflow_state stale detection"
```

---

## Task 4: Rust — Event Payload Changes + AgentSessionEnded

**Files:**
- Modify: `src-tauri/src/agent/events.rs:7-11` (AgentPermissionRequest)
- Modify: `src-tauri/src/agent/events.rs:93-94` (SupervisorEvaluating)
- Modify: `src-tauri/src/agent/events.rs:97-102` (SupervisorReply)
- Modify: `src-tauri/src/lib.rs:437-503` (import + event registration)
- Modify: `src-tauri/src/agent/mod.rs` (emit AgentSessionEnded at cleanup points, emit issue_id in events)

- [ ] **Step 1: Add issue_id to AgentPermissionRequest**

In `src-tauri/src/agent/events.rs`:

```rust
pub struct AgentPermissionRequest {
    pub issue_id: String,
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}
```

- [ ] **Step 2: Add issue_id to SupervisorEvaluating and SupervisorReply**

```rust
pub struct SupervisorEvaluating {
    pub issue_id: String,
}

pub struct SupervisorReply {
    pub issue_id: String,
    pub message: String,
    pub reasoning: Option<String>,
    pub turn_number: u32,
}
```

- [ ] **Step 3: Add issue_id to AgentInitMetadata**

```rust
pub struct AgentInitMetadata {
    pub issue_id: String,
    pub model: String,
    pub available_models: Vec<String>,
    pub tools: Vec<String>,
    pub slash_commands: Vec<String>,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<McpServerInfo>,
}
```

- [ ] **Step 4: Create AgentSessionEnded event struct**

Add to `src-tauri/src/agent/events.rs`:

```rust
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type, tauri_specta::Event)]
pub struct AgentSessionEnded {
    pub issue_id: String,
}
```

- [ ] **Step 5: Register AgentSessionEnded in lib.rs**

In `src-tauri/src/lib.rs`, add `AgentSessionEnded` to the imports (around line 439) and to the `collect_events!` macro (around line 502).

- [ ] **Step 6: Update event emit sites — pass issue_id**

- In `src-tauri/src/agent/mod.rs`: find `.emit()` calls for `AgentPermissionRequest` and `AgentInitMetadata`. Add `issue_id: issue_id.to_string()` field. The local `issue_id` variable is already in scope.
- In `src-tauri/src/agent/supervisor.rs` (NOT mod.rs): find `.emit()` calls for `SupervisorEvaluating` and `SupervisorReply`. Add `issue_id: issue_id.to_string()` field. The supervisor function already has `issue_id: &str` in scope.

- [ ] **Step 7: Emit AgentSessionEnded at all three cleanup paths**

At each point where the handle is removed from the map (timeout, error, success), add:

```rust
let _ = AgentSessionEnded {
    issue_id: issue_id.to_string(),
}
.emit(&app_handle);
```

- [ ] **Step 8: Run cargo check**

Run: `cd src-tauri && cargo check 2>&1 | head -40`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/agent/events.rs src-tauri/src/agent/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add issue_id to event payloads and create AgentSessionEnded event"
```

---

## Task 5: Regenerate TypeScript Bindings

**Files:**
- Auto-generated: `src/bindings.ts`

- [ ] **Step 1: Run tauri dev briefly to regenerate bindings**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/bordeaux && bun run tauri:dev`

Wait for bindings to regenerate (watch for `src/bindings.ts` to update), then kill the process. Alternatively, if there's a dedicated bindings generation command, use that.

- [ ] **Step 2: Verify the new signatures appear in bindings.ts**

Check that `agentPermissionRespond`, `agentSetModel`, etc. now have `issueId` as a parameter, and that `AgentSessionEnded` event type exists.

Run: `grep -n 'agentPermissionRespond\|agentSetModel\|AgentSessionEnded' src/bindings.ts | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/bindings.ts
git commit -m "chore: regenerate TypeScript bindings with issue_id parameters"
```

---

## Task 6: Frontend — useAgentConfig Add issue_id

**Files:**
- Modify: `src/features/workflow/hooks/use-agent-config.ts:104-124`

- [ ] **Step 1: Update useAgentConfig to accept and pass activeTicketId**

The hook needs access to the current ticket ID. Add it as a parameter and pass to all command calls:

```ts
export function useAgentConfig(activeTicketId: string | null) {
```

Update the mutation functions to pass `issueId`:

```ts
const setModel = useMutation({
    mutationFn: (model: string) =>
        activeTicketId
            ? commands.agentSetModel(activeTicketId, model).catch(() => {})
            : Promise.resolve(),
    onMutate: (model) => updateConfig({ model }),
});

const setThinking = useMutation({
    mutationFn: (params: { type: "adaptive" | "enabled" | "disabled"; budgetTokens?: number }) =>
        activeTicketId
            ? commands.agentSetThinking(activeTicketId, params.type, params.budgetTokens ?? null).catch(() => {})
            : Promise.resolve(),
    onMutate: (params) => updateConfig({ thinking: params }),
});

const setEffort = useMutation({
    mutationFn: (effort: "low" | "medium" | "high" | "max") =>
        activeTicketId
            ? commands.agentSetEffort(activeTicketId, effort).catch(() => {})
            : Promise.resolve(),
    onMutate: (effort) => updateConfig({ effort }),
});

const setFastMode = useMutation({
    mutationFn: (enabled: boolean) =>
        activeTicketId
            ? commands.agentSetFastMode(activeTicketId, enabled).catch(() => {})
            : Promise.resolve(),
    onMutate: (enabled) => updateConfig({ fastMode: enabled }),
});
```

- [ ] **Step 2: Update all callers of useAgentConfig to pass activeTicketId**

Search for `useAgentConfig()` calls and pass the ticket ID from context.

Run: `grep -rn 'useAgentConfig' src/` to find all call sites.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: May show errors in hooks that haven't been updated yet — that's OK for now.

- [ ] **Step 4: Commit**

```bash
git add src/features/workflow/hooks/use-agent-config.ts
git commit -m "feat: pass issue_id through agent config commands"
```

---

## Task 7: Frontend — useWorkflowPermissions Per-Ticket State

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-permissions.ts`

- [ ] **Step 1: Key pending permissions by issue_id**

Replace scalar state with a Record. The event handler stores by `issue_id`, and `respondToPermission` resolves the `issueId` from the map:

```ts
export function useWorkflowPermissions(
    activeTicketId: string | null,
    setError: (issueId: string, msg: string) => void,
) {
    const [pendingPermissions, setPendingPermissions] = useState<
        Record<string, PermissionRequest & { issueId: string }>
    >({});

    const permissionsReady = useTauriEvent(events.agentPermissionRequest, (payload) => {
        const { issue_id, request_id, tool_name, input } = payload;
        setPendingPermissions((prev) => ({
            ...prev,
            [issue_id]: {
                issueId: issue_id,
                request_id,
                tool_name,
                input: input as Record<string, unknown>,
            },
        }));
    });

    // Convenience: the viewed ticket's pending permission
    const pendingPermission = activeTicketId
        ? pendingPermissions[activeTicketId] ?? null
        : null;

    const respondToPermission = useCallback(
        async (requestId: string, allowed: boolean) => {
            // Find which issue this request belongs to
            const entry = Object.values(pendingPermissions).find(
                (p) => p.request_id === requestId,
            );
            if (!entry) return;
            try {
                await commands.agentPermissionRespond(entry.issueId, requestId, allowed);
                setPendingPermissions((prev) => {
                    const next = { ...prev };
                    delete next[entry.issueId];
                    return next;
                });
            } catch (err) {
                setPendingPermissions((prev) => {
                    const next = { ...prev };
                    delete next[entry.issueId];
                    return next;
                });
                const errStr = String(err);
                if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
                    setError(entry.issueId, "Agent session expired. Click Resume to continue where you left off.");
                } else {
                    setError(entry.issueId, `Failed to respond to permission: ${err}`);
                }
            }
        },
        [pendingPermissions, setError],
    );

    const clearPending = useCallback(() => {
        if (activeTicketId) {
            setPendingPermissions((prev) => {
                const next = { ...prev };
                delete next[activeTicketId];
                return next;
            });
        }
    }, [activeTicketId]);

    return { pendingPermission, pendingPermissions, respondToPermission, permissionsReady, clearPending };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-permissions.ts
git commit -m "feat: key workflow permissions by issue_id for multi-agent support"
```

---

## Task 8: Frontend — useWorkflowReview Per-Ticket State

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-review.ts`

- [ ] **Step 1: Remove activeTicketId filter and key review state by ticket_id**

The review event handler should store all review requests regardless of which ticket is viewed. The `submitReview` function uses the stored ticket_id to route the response.

```ts
export function useWorkflowReview(
    activeTicketId: string | null,
    setError: (issueId: string, msg: string) => void,
) {
    const [reviewFindingsMap, setReviewFindingsMap] = useState<Record<string, ReviewFinding[]>>({});
    const [reviewCommentsMap, setReviewCommentsMap] = useState<Record<string, ReviewComment[]>>({});
    const [pendingReviewMap, setPendingReviewMap] = useState<Record<string, string>>({});
    const [reviewRoundKey, setReviewRoundKey] = useState(0);

    const reviewReady = useTauriEvent(events.agentReviewFindingsRequest, (payload) => {
        // No activeTicketId filter — store for all tickets
        setReviewFindingsMap((prev) => ({
            ...prev,
            [payload.ticket_id]: payload.findings as ReviewFinding[],
        }));
        setPendingReviewMap((prev) => ({
            ...prev,
            [payload.ticket_id]: payload.request_id,
        }));
        setReviewRoundKey((prev) => prev + 1);
    });

    // Convenience: viewed ticket's state
    const reviewFindings = activeTicketId ? reviewFindingsMap[activeTicketId] ?? [] : [];
    const reviewComments = activeTicketId ? reviewCommentsMap[activeTicketId] ?? [] : [];
    const pendingReviewRequestId = activeTicketId ? pendingReviewMap[activeTicketId] ?? null : null;

    const addReviewComment = useCallback(
        (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
            if (!activeTicketId) return;
            const comment: ReviewComment = {
                id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                file_path: filePath,
                line_number: lineNumber,
                content,
                suggestion,
                resolved: false,
            };
            setReviewCommentsMap((prev) => ({
                ...prev,
                [activeTicketId]: [...(prev[activeTicketId] ?? []), comment],
            }));
        },
        [activeTicketId],
    );

    const deleteReviewComment = useCallback(
        (commentId: string) => {
            if (!activeTicketId) return;
            setReviewCommentsMap((prev) => ({
                ...prev,
                [activeTicketId]: (prev[activeTicketId] ?? []).filter((c) => c.id !== commentId),
            }));
        },
        [activeTicketId],
    );

    const submitReview = useCallback(
        async (submission: ReviewSubmission) => {
            if (!activeTicketId || !pendingReviewMap[activeTicketId]) return;
            const requestId = pendingReviewMap[activeTicketId];
            try {
                await commands.agentReviewRespond(
                    activeTicketId,
                    requestId,
                    submission as import("@/bindings").JsonValue,
                );
                setPendingReviewMap((prev) => {
                    const next = { ...prev };
                    delete next[activeTicketId];
                    return next;
                });

                if (submission.action === "request_changes") {
                    setReviewCommentsMap((prev) => ({
                        ...prev,
                        [activeTicketId]: (prev[activeTicketId] ?? []).map((c) => ({ ...c, resolved: true })),
                    }));
                    setReviewFindingsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
                } else {
                    setReviewCommentsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
                    setReviewFindingsMap((prev) => ({ ...prev, [activeTicketId]: [] }));
                }
            } catch (err) {
                setPendingReviewMap((prev) => {
                    const next = { ...prev };
                    delete next[activeTicketId];
                    return next;
                });
                const errStr = String(err);
                if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
                    setError(activeTicketId, "Agent session expired. Click Resume to continue where you left off.");
                } else {
                    setError(activeTicketId, `Failed to submit review: ${err}`);
                }
            }
        },
        [activeTicketId, pendingReviewMap, setError],
    );

    return {
        reviewFindings,
        reviewComments,
        pendingReviewRequestId,
        addReviewComment,
        deleteReviewComment,
        submitReview,
        reviewRoundKey,
        reviewReady,
    };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-review.ts
git commit -m "feat: key workflow review state by ticket_id for multi-agent support"
```

---

## Task 9: Frontend — useWorkflowNotifications Per-Ticket State

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-notifications.ts`

- [ ] **Step 1: Remove activeTicketId filters and key state by ticket_id**

```ts
export function useWorkflowNotifications(
    activeTicketId: string | null,
    onRefreshTicketRef: React.MutableRefObject<(() => Promise<void>) | null>,
) {
    const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
    const [statusTextMap, setStatusTextMap] = useState<Record<string, string>>({});
    const [lastUpdatedSectionMap, setLastUpdatedSectionMap] = useState<Record<string, string>>({});

    const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => {
        // Store for all tickets, not just active
        setLastUpdatedSectionMap((prev) => ({
            ...prev,
            [payload.ticket_id]: payload.section_id ?? payload.section,
        }));
        // Trigger refresh if this is the viewed ticket
        if (activeTicketId && payload.ticket_id === activeTicketId) {
            onRefreshTicketRef.current?.();
        }
    });

    const notificationReady = useTauriEvent(events.notificationEvent, (payload) => {
        setNotifications((prev) => [...prev, payload]);
    });

    const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => {
        // Store for all tickets
        setStatusTextMap((prev) => ({
            ...prev,
            [payload.ticket_id]: payload.status_text,
        }));
    });

    const notificationsReady = sectionReady && notificationReady && statusReady;

    // Convenience: viewed ticket's state
    const statusText = activeTicketId ? statusTextMap[activeTicketId] ?? null : null;
    const lastUpdatedSectionId = activeTicketId ? lastUpdatedSectionMap[activeTicketId] ?? null : null;

    const clearNotification = useCallback((index: number) => {
        setNotifications((prev) => prev.filter((_, i) => i !== index));
    }, []);

    return { notifications, clearNotification, statusText, lastUpdatedSectionId, notificationsReady };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-notifications.ts
git commit -m "feat: key workflow notifications by ticket_id for multi-agent support"
```

---

## Task 10: Frontend — useWorkflowStreaming Multi-Agent Support

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-streaming.ts:62-427`

- [ ] **Step 1: Replace single executingStepRef with per-ticket Record**

Change the hook signature and internal state:

```ts
export function useWorkflowStreaming(
    _activeTicketId: string | null,
    executingStepsRef: React.MutableRefObject<Record<string, string | null>>,
) {
```

- [ ] **Step 2: Remove the activeTicketId filter and use chunk.issue_id for routing**

In the `createStreamChannel` callback, replace:

```ts
// REMOVE this line:
if (activeTicketId && chunk.issue_id !== activeTicketId) return;

// REPLACE this:
const stepId = executingStepRef.current;
// WITH:
const stepId = executingStepsRef.current[chunk.issue_id];
```

Remove `activeTicketId` from the `useCallback` dependency array.

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-streaming.ts
git commit -m "feat: enable streaming for multiple concurrent agents"
```

---

## Task 11: Frontend — useWorkflow Per-Ticket State

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow.ts`

This is the largest frontend change — converting scalar state to per-ticket Records.

- [ ] **Step 1: Replace scalar state with Records**

```ts
const [workflowStates, setWorkflowStates] = useState<Record<string, WorkflowState>>({});
const [loadingTickets, setLoadingTickets] = useState<Record<string, boolean>>({});
const [errors, setErrors] = useState<Record<string, string | null>>({});
const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
```

- [ ] **Step 2: Replace executingStepRef with executingStepsRef**

```ts
const currentStepsRef = useRef<Record<string, string | null>>({});
const executingStepsRef = useRef<Record<string, string | null>>({});
```

Update the `useEffect` that syncs currentStepRef:

```ts
useEffect(() => {
    if (activeTicketId) {
        const state = workflowStates[activeTicketId];
        currentStepsRef.current[activeTicketId] = state?.current_step_id ?? null;
    }
}, [activeTicketId, workflowStates]);
```

- [ ] **Step 3: Update sub-hook composition and error handling**

Create two error setters — a keyed one for sub-hooks and a convenience wrapper for internal use:

```ts
// Keyed error setter for sub-hooks (they know the issueId from event payloads)
const setErrorKeyed = useCallback((issueId: string, msg: string) => {
    setErrors((prev) => ({ ...prev, [issueId]: msg }));
}, []);

// Convenience wrapper for use within useWorkflow (uses known issueId from call context)
// Used by getWorkflowState, assignWorkflow, advanceStep, getDiff, getBranchInfo, etc.
// Each of these already has the issueId in scope, so pass it explicitly.

const streaming = useWorkflowStreaming(activeTicketId, executingStepsRef);
const permissions = useWorkflowPermissions(activeTicketId, setErrorKeyed);
const review = useWorkflowReview(activeTicketId, setErrorKeyed);
```

**Important:** All existing `setError("message")` calls throughout `useWorkflow` (in `getWorkflowState`, `assignWorkflow`, `getDiff`, `getBranchInfo`, `advanceStep`, etc.) must change to `setErrors((prev) => ({ ...prev, [issueId]: "message" }))` using the `issueId` already available in each function's scope. There are ~10 call sites — update each one.

- [ ] **Step 4: Update getWorkflowState to key by issueId**

```ts
const getWorkflowState = useCallback(
    async (issueId: string) => {
        try {
            const state = await commands.workflowState(projectDir, issueId);
            setWorkflowStates((prev) => ({ ...prev, [issueId]: state }));
            return state;
        } catch (err) {
            setErrors((prev) => ({ ...prev, [issueId]: `Failed to get workflow state: ${err}` }));
            return null;
        }
    },
    [projectDir],
);
```

- [ ] **Step 5: Update executeStep to use per-ticket state**

```ts
const executeStep = useCallback(
    async (issueId: string, userMessage?: string) => {
        try {
            setLoadingTickets((prev) => ({ ...prev, [issueId]: true }));
            setErrors((prev) => ({ ...prev, [issueId]: null }));

            // ... ticket_sections logic stays the same but uses workflowStates[issueId] ...

            executingStepsRef.current[issueId] = currentStepsRef.current[issueId] ?? null;
            setWorkflowStates((prev) => {
                const s = prev[issueId];
                return s ? { ...prev, [issueId]: { ...s, step_status: "in_progress" } } : prev;
            });
            const channel = createStreamChannelRef.current();
            const result = await commands.workflowExecuteStep(
                projectDir, issueId, channel, userMessage ?? null,
            );

            executingStepsRef.current[issueId] = null;
            await getWorkflowState(issueId);
            return result as StepExecutionResult;
        } catch (err) {
            executingStepsRef.current[issueId] = null;
            clearPermissionPending();
            setErrors((prev) => ({ ...prev, [issueId]: `Step execution failed: ${err}` }));
            await getWorkflowState(issueId);
            return null;
        } finally {
            setLoadingTickets((prev) => ({ ...prev, [issueId]: false }));
        }
    },
    [projectDir, getWorkflowState, workflowStates, workflows, clearPermissionPending],
);
```

- [ ] **Step 6: Update assignWorkflow, advanceStep, suggestWorkflow to use per-ticket state**

Apply the same pattern — use `setWorkflowStates((prev) => ({ ...prev, [issueId]: ... }))` instead of `setCurrentState(...)`, and `setLoadingTickets` / `setErrors` keyed by issueId.

- [ ] **Step 7: Add convenience accessors and runningTicketIds to return value**

```ts
const currentState = activeTicketId ? workflowStates[activeTicketId] ?? null : null;
const loading = activeTicketId ? loadingTickets[activeTicketId] ?? false : false;
const error = activeTicketId ? errors[activeTicketId] ?? null : null;

const runningTicketIds = useMemo(
    () => new Set(Object.entries(loadingTickets).filter(([, v]) => v).map(([k]) => k)),
    [loadingTickets],
);

return {
    // ... existing return values, now derived from activeTicketId ...
    currentState,
    loading,
    error,
    runningTicketIds,
    // ... rest unchanged ...
};
```

- [ ] **Step 8: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -60`
Expected: PASS or errors only in components that need `runningTicketIds` wired up (Task 12).

- [ ] **Step 9: Commit**

```bash
git add src/features/workflow/hooks/use-workflow.ts
git commit -m "feat: convert useWorkflow to per-ticket state for multi-agent concurrency"
```

---

## Task 12: Frontend — Sidebar Running Indicators

**Files:**
- Modify: `src/shared/layout/app-sidebar.tsx:8-17` (props), `src/shared/layout/app-sidebar.tsx:108-136` (ticket rendering)
- Modify: `src/app/App.tsx:219` (pass runningTicketIds prop)

- [ ] **Step 1: Add runningTicketIds prop to AppSidebar**

In `src/shared/layout/app-sidebar.tsx`, add to props:

```ts
interface AppSidebarProps {
    // ... existing props ...
    runningTicketIds?: Set<string>;
}
```

- [ ] **Step 2: Render running indicator in ticket list**

Inside the ticket button (around line 121), add a pulsing dot when the ticket is running:

```tsx
<div className="flex items-center gap-2">
    <span className={`text-[10px] font-mono shrink-0 ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
        {ticket.id.slice(0, 12)}
    </span>
    {runningTicketIds?.has(ticket.id) ? (
        <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald" />
        </span>
    ) : (
        <span className="inline-flex items-center rounded-full bg-emerald-muted text-emerald text-[10px] px-1.5 py-0.5 font-medium">
            in progress
        </span>
    )}
</div>
```

- [ ] **Step 3: Pass runningTicketIds from App.tsx**

In `src/app/App.tsx`, pass the prop from workflow state:

```tsx
<AppSidebar
    // ... existing props ...
    runningTicketIds={workflow.runningTicketIds}
/>
```

- [ ] **Step 4: Run type check and lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout/app-sidebar.tsx src/app/App.tsx
git commit -m "feat: add running indicator badges to sidebar tickets"
```

---

## Task 13: Frontend — Idle Timeout & Memory Unloading

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow.ts` (add AgentSessionEnded listener and timer logic)

- [ ] **Step 1: Add AgentSessionEnded event listener with 10-minute unload timer**

Inside `useWorkflow`, add a new effect that listens for the event and manages timers:

```ts
const unloadTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    events.agentSessionEnded
        .listen((event) => {
            if (cancelled) return;
            const { issue_id } = event.payload;

            // Start 10-minute unload timer
            unloadTimersRef.current[issue_id] = setTimeout(() => {
                // Clear all in-memory state for this ticket
                setWorkflowStates((prev) => {
                    const next = { ...prev };
                    delete next[issue_id];
                    return next;
                });
                setLoadingTickets((prev) => {
                    const next = { ...prev };
                    delete next[issue_id];
                    return next;
                });
                setErrors((prev) => {
                    const next = { ...prev };
                    delete next[issue_id];
                    return next;
                });
                streaming.clearTicketOutputs?.(issue_id);
                delete unloadTimersRef.current[issue_id];
            }, 10 * 60 * 1000); // 10 minutes
        })
        .then((u) => {
            if (cancelled) u();
            else unlisten = u;
        });

    return () => {
        cancelled = true;
        unlisten?.();
        // Clear all timers on unmount
        for (const timer of Object.values(unloadTimersRef.current)) {
            clearTimeout(timer);
        }
    };
}, [streaming]);
```

- [ ] **Step 2: Cancel unload timer when agent restarts**

In `executeStep`, before starting execution, cancel any pending timer:

```ts
// Cancel unload timer if restarting
if (unloadTimersRef.current[issueId]) {
    clearTimeout(unloadTimersRef.current[issueId]);
    delete unloadTimersRef.current[issueId];
}
```

- [ ] **Step 3: Track step-to-ticket mapping and add clearTicketOutputs**

In `src/features/workflow/hooks/use-workflow-streaming.ts`, add a ref to track which steps belong to which ticket, and a function to clear by ticket:

```ts
// Track which stepIds belong to which ticketId
const stepToTicketRef = useRef<Record<string, string>>({});
```

In the `createStreamChannel` callback, after looking up the stepId from `executingStepsRef`, record the mapping:

```ts
const stepId = executingStepsRef.current[chunk.issue_id];
if (!stepId) return;
// Track this step's ticket ownership
stepToTicketRef.current[stepId] = chunk.issue_id;
```

Add the cleanup function:

```ts
const clearTicketOutputs = useCallback((issueId: string) => {
    // Find all stepIds belonging to this ticket
    const stepsToRemove = Object.entries(stepToTicketRef.current)
        .filter(([, ticketId]) => ticketId === issueId)
        .map(([stepId]) => stepId);

    if (stepsToRemove.length === 0) return;

    setStepOutputs((prev) => {
        const next = { ...prev };
        for (const stepId of stepsToRemove) {
            delete next[stepId];
            delete stepToTicketRef.current[stepId];
        }
        return next;
    });
}, []);

return { stepOutputs, getStepOutput, createStreamChannel, streamingReady: true as const, clearTicketOutputs };
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/hooks/use-workflow.ts src/features/workflow/hooks/use-workflow-streaming.ts
git commit -m "feat: add 10-minute idle timeout and memory unloading for completed agents"
```

---

## Task 14: Integration Verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 2: Run Rust checks**

Run: `cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo fmt -- --check`
Expected: PASS

- [ ] **Step 3: Run frontend lint**

Run: `bun run lint && bun run format:check`
Expected: PASS

- [ ] **Step 4: Run unit tests**

Run: `bun run test`
Expected: PASS (existing tests should still work)

- [ ] **Step 5: Smoke test — start two agents manually**

Start `bun run tauri:dev`, open two tickets, start workflows on both. Verify:
- Both agents run (two sidecar processes visible in Activity Monitor)
- Switching between tickets shows accumulated output
- Sidebar shows running indicators for both
- Permission dialogs appear for the correct ticket

- [ ] **Step 6: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration fixups for multi-agent concurrency"
```
