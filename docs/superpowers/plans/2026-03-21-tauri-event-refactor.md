# Tauri Event System Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate high-frequency StreamChunk from Tauri events to Channel API, fix the invalidation race condition, extract a reusable `useTauriEvent` hook, and add debounced cache invalidation for subtask events.

**Architecture:** The Rust backend currently emits all 13 event types via `tauri_specta::Event::emit()`. StreamChunk (the highest-frequency event) will move to Tauri's `Channel<T>` IPC, which is designed for ordered streaming and avoids known high-frequency emit panics. Lower-frequency events stay as events but get a shared hook abstraction and safer cleanup patterns.

**Tech Stack:** Tauri v2 (Rust), React 19, TanStack Query, tauri-specta, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src-tauri/src/agent.rs` | **Modify**: Accept `Channel<StreamChunk>` in `execute_step`, send chunks via channel instead of `.emit()` |
| `src-tauri/src/workflow.rs` | **Modify**: Pass channel through from command to `agent::execute_step` |
| `src-tauri/src/lib.rs` | **Modify**: Add `Channel<StreamChunk>` param to `workflow_execute_step` command |
| `src/shared/hooks/use-tauri-event.ts` | **Create**: Generic hook for safe Tauri event subscription with cancelled-flag cleanup |
| `src/features/workflow/hooks/use-workflow-streaming.ts` | **Modify**: Use `Channel` from `@tauri-apps/api/core` instead of event listener |
| `src/features/workflow/hooks/use-workflow.ts` | **Modify**: Pass channel to `executeStep`, remove `streamingReady` gating |
| `src/features/workflow/hooks/use-workflow-permissions.ts` | **Modify**: Use `useTauriEvent` |
| `src/features/workflow/hooks/use-workflow-feedback.ts` | **Modify**: Use `useTauriEvent` |
| `src/features/workflow/hooks/use-workflow-review.ts` | **Modify**: Use `useTauriEvent` |
| `src/features/workflow/hooks/use-workflow-notifications.ts` | **Modify**: Use `useTauriEvent` |
| `src/shared/lib/invalidation.ts` | **Modify**: Fix race condition, add debounced invalidation |
| `src/bindings.ts` | **Auto-regenerated**: Will update after Rust changes |
| `src/features/workflow/hooks/use-workflow-streaming.test.ts` | **Modify**: Update to test channel-based streaming |
| `src/shared/hooks/use-tauri-event.test.ts` | **Create**: Tests for the generic hook |
| `src/shared/lib/invalidation.test.ts` | **Create**: Tests for debounced invalidation |
| `src/shared/test/mocks/tauri.ts` | **Modify**: Add Channel mock |

---

## Task 1: Extract `useTauriEvent` Generic Hook

This is a prerequisite for other tasks — the pattern is repeated 5+ times across hooks. Extract it first so subsequent refactors can use it.

**Files:**
- Create: `src/shared/hooks/use-tauri-event.ts`
- Create: `src/shared/hooks/use-tauri-event.test.ts`

- [ ] **Step 1: Write the failing test for `useTauriEvent`**

Create `src/shared/hooks/use-tauri-event.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

// Simulate a tauri-specta event object
function makeMockEvent<T>(eventName: string) {
  return {
    listen: (cb: (e: { payload: T }) => void) =>
      import("@tauri-apps/api/event").then((mod) =>
        mod.listen(eventName, cb as (e: { payload: unknown }) => void)
      ),
  };
}

describe("useTauriEvent", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("returns isReady=true after listener is attached", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<string>("test-event");
    const { result } = renderHook(() => useTauriEvent(event, handler));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("calls handler when event is emitted", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<{ value: string }>("test-event");
    const { result } = renderHook(() => useTauriEvent(event, handler));

    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      emitTauriEvent("test-event", { value: "hello" });
    });

    expect(handler).toHaveBeenCalledWith({ value: "hello" });
  });

  it("always calls the latest handler (no stale closure)", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const event = makeMockEvent<string>("test-event");

    const { result, rerender } = renderHook(
      ({ handler }) => useTauriEvent(event, handler),
      { initialProps: { handler: handler1 } }
    );

    await waitFor(() => expect(result.current).toBe(true));

    // Swap handler
    rerender({ handler: handler2 });

    act(() => {
      emitTauriEvent("test-event", "payload");
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith("payload");
  });

  it("cleans up listener on unmount", async () => {
    const handler = vi.fn();
    const event = makeMockEvent<string>("test-event");
    const { result, unmount } = renderHook(() => useTauriEvent(event, handler));

    await waitFor(() => expect(result.current).toBe(true));

    unmount();

    act(() => {
      emitTauriEvent("test-event", "after-unmount");
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/shared/hooks/use-tauri-event.test.ts`
Expected: FAIL — module `use-tauri-event` does not exist

- [ ] **Step 3: Implement `useTauriEvent`**

Create `src/shared/hooks/use-tauri-event.ts`:

```typescript
import { useEffect, useRef, useState } from "react";

/**
 * Generic hook for subscribing to a typed tauri-specta event.
 * Uses the ref-based handler pattern to avoid stale closures
 * and the cancelled-flag pattern for safe async cleanup.
 *
 * @returns isReady — true once the listener is attached
 */
export function useTauriEvent<T>(
  event: {
    listen: (cb: (e: { payload: T }) => void) => Promise<() => void>;
  },
  handler: (payload: T) => void
): boolean {
  const [isReady, setIsReady] = useState(false);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    setIsReady(false);

    event
      .listen((e) => {
        if (!cancelled) handlerRef.current(e.payload);
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);

  return isReady;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/shared/hooks/use-tauri-event.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/hooks/use-tauri-event.ts src/shared/hooks/use-tauri-event.test.ts
git commit -m "feat: extract generic useTauriEvent hook with ref-based handler pattern"
```

---

## Task 2: Migrate Workflow Sub-Hooks to `useTauriEvent`

Replace the manual `useEffect` + `cancelled` + `unlistenRef` boilerplate in 4 hooks with `useTauriEvent`. This does NOT touch streaming (that gets the Channel migration in Task 4).

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-permissions.ts`
- Modify: `src/features/workflow/hooks/use-workflow-feedback.ts`
- Modify: `src/features/workflow/hooks/use-workflow-review.ts`
- Modify: `src/features/workflow/hooks/use-workflow-notifications.ts`

- [ ] **Step 1: Run existing hook tests to confirm baseline passes**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/features/workflow/hooks/`
Expected: All existing tests PASS

- [ ] **Step 2: Refactor `use-workflow-permissions.ts`**

Replace the manual `useEffect`/`unlistenRef`/`cancelled` pattern with:

```typescript
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

// Inside the hook, replace the useEffect block + state with:
const permissionsReady = useTauriEvent(
  events.agentPermissionRequest,
  (payload) => {
    setPendingPermission({
      request_id: payload.request_id,
      tool_name: payload.tool_name,
      input: typeof payload.input === "string"
        ? payload.input
        : JSON.stringify(payload.input, null, 2),
    });
  }
);
```

Remove: `unlistenRef`, the manual `useEffect` for event subscription, the `permissionsReady` state variable.

- [ ] **Step 3: Refactor `use-workflow-feedback.ts`**

Same pattern — replace manual event subscription with `useTauriEvent`. The handler should filter by `activeTicketId`:

```typescript
const feedbackReady = useTauriEvent(
  events.agentFeedbackRequest,
  (payload) => {
    if (activeTicketId && payload.ticket_id !== activeTicketId) return;
    setPendingFeedback({
      ticket_id: payload.ticket_id,
      summary: payload.summary,
    });
  }
);
```

Note: `activeTicketId` is accessed via ref inside the handler (it's already a ref-based pattern through `useTauriEvent`'s `handlerRef`), so no stale closure issues.

- [ ] **Step 4: Refactor `use-workflow-review.ts`**

Same pattern:

```typescript
const reviewReady = useTauriEvent(
  events.agentReviewFindingsRequest,
  (payload) => {
    setPendingReviewRequestId(payload.request_id);
    setReviewFindings(/* parse payload.findings */);
  }
);
```

- [ ] **Step 5: Refactor `use-workflow-notifications.ts`**

This hook listens to 4 events. Use `useTauriEvent` for each:

```typescript
const sectionReady = useTauriEvent(events.sectionUpdateEvent, (payload) => { /* ... */ });
const notificationReady = useTauriEvent(events.notificationEvent, (payload) => { /* ... */ });
const stepCompleteReady = useTauriEvent(events.stepCompleteEvent, (payload) => { /* ... */ });
const statusReady = useTauriEvent(events.statusUpdateEvent, (payload) => { /* ... */ });

const notificationsReady = sectionReady && notificationReady && stepCompleteReady && statusReady;
```

If this hook also listens to `prUrlReportedEvent`, add a 5th `useTauriEvent` call.

- [ ] **Step 6: Run all workflow hook tests**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/features/workflow/hooks/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-permissions.ts \
        src/features/workflow/hooks/use-workflow-feedback.ts \
        src/features/workflow/hooks/use-workflow-review.ts \
        src/features/workflow/hooks/use-workflow-notifications.ts
git commit -m "refactor: migrate workflow sub-hooks to useTauriEvent"
```

---

## Task 3: Fix Invalidation Race Condition + Add Debouncing

The current `invalidation.ts` uses `.then(u => unlisteners.push(u))` which has a race condition — cleanup can run before promises resolve. Also, subtask events trigger 3 separate `invalidateQueries` calls when the agent creates subtasks rapidly.

**Files:**
- Modify: `src/shared/lib/invalidation.ts`
- Create: `src/shared/lib/invalidation.test.ts`

- [ ] **Step 1: Write failing test for debounced invalidation**

Create `src/shared/lib/invalidation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useTauriEventInvalidation } from "@/shared/lib/invalidation";
import React from "react";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe("useTauriEventInvalidation", () => {
  beforeEach(() => {
    clearTauriMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid subtask events into a single invalidation", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useTauriEventInvalidation("/project"), { wrapper });

    // Wait for listeners to attach
    await vi.advanceTimersByTimeAsync(0);

    // Fire 3 rapid subtask events
    act(() => {
      emitTauriEvent("subtask-created", { subtask_id: "s1", parent_id: "p1" });
      emitTauriEvent("subtask-created", { subtask_id: "s2", parent_id: "p1" });
      emitTauriEvent("subtask-closed", { subtask_id: "s3", parent_id: "p1" });
    });

    // Before debounce window: no invalidation yet
    expect(invalidateSpy).not.toHaveBeenCalled();

    // After debounce window: single invalidation
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Should have consolidated into fewer calls than 3
    expect(invalidateSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/shared/lib/invalidation.test.ts`
Expected: FAIL — current implementation fires invalidation immediately (no debouncing)

- [ ] **Step 3: Rewrite `invalidation.ts` with `useTauriEvent` and debouncing**

Replace the full content of `src/shared/lib/invalidation.ts`:

```typescript
import { useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "@/bindings";
import { ticketKeys } from "@/shared/lib/query-keys";
import { useTauriEvent } from "@/shared/hooks/use-tauri-event";

/**
 * Centralized Tauri event -> TanStack Query invalidation.
 * Install once in App.tsx.
 *
 * Uses useTauriEvent for safe async cleanup (no race condition).
 * Debounces subtask events to avoid N sequential refetches.
 */
export function useTauriEventInvalidation(projectDir: string) {
  const queryClient = useQueryClient();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const debouncedInvalidateAll = useCallback(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    }, 100);
  }, [queryClient, projectDir]);

  // Subtask events -> debounced full ticket list refetch
  useTauriEvent(events.subtaskCreated, debouncedInvalidateAll);
  useTauriEvent(events.subtaskUpdated, debouncedInvalidateAll);
  useTauriEvent(events.subtaskClosed, debouncedInvalidateAll);

  // Section update -> targeted ticket detail refetch
  useTauriEvent(events.sectionUpdateEvent, (payload) => {
    if (payload.ticket_id) {
      queryClient.invalidateQueries({
        queryKey: ticketKeys.detail(projectDir, payload.ticket_id),
      });
    }
  });

  // Step complete -> targeted workflow state refetch
  useTauriEvent(events.stepCompleteEvent, (payload) => {
    if (payload.ticket_id) {
      queryClient.invalidateQueries({
        queryKey: ["workflows", "state", projectDir, payload.ticket_id],
      });
    }
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/shared/lib/invalidation.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check no regressions**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/lib/invalidation.ts src/shared/lib/invalidation.test.ts
git commit -m "fix: replace race-prone .then() pattern with useTauriEvent, add debounced subtask invalidation"
```

---

## Task 4: Migrate StreamChunk to Tauri Channel API (Rust Side)

This is the highest-impact change. StreamChunk is emitted per-token/per-tool during agent execution — hundreds to thousands of events per step. The Tauri event system has known panic bugs at high emit rates (Issues #10987, #8177) and memory leaks (#12724). The Channel API is Tauri's recommended solution for streaming.

**Files:**
- Modify: `src-tauri/src/lib.rs` (command signature)
- Modify: `src-tauri/src/workflow.rs` (pass channel through)
- Modify: `src-tauri/src/agent.rs` (send via channel instead of `.emit()`)

### Background: How `Channel<T>` Works

Tauri's `Channel<T>` is a typed IPC channel passed as a command parameter. The frontend creates a `Channel` object, passes it to `invoke()`, and the Rust side sends messages through it. Messages are ordered and delivered directly to the caller — no global broadcast, no EventRegistry lock.

```rust
// Rust: receives channel as command parameter
#[tauri::command]
async fn my_command(on_event: Channel<MyPayload>) -> Result<(), String> {
    on_event.send(MyPayload { ... }).map_err(|e| e.to_string())?;
    Ok(())
}
```

```typescript
// Frontend: creates channel and passes to invoke
const channel = new Channel<MyPayload>();
channel.onmessage = (payload) => { /* handle */ };
await invoke("my_command", { onEvent: channel });
```

**Important:** `Channel<T>` requires `T: Serialize + Clone`. The existing `StreamChunk` struct already satisfies this. `Channel` is in `tauri::ipc::Channel`.

### Specta Compatibility

`tauri-specta` supports `Channel<T>` in command signatures. The generated bindings will automatically accept a `Channel<StreamChunk>` parameter. Verify after regeneration that `src/bindings.ts` includes the channel parameter in the `workflowExecuteStep` command signature.

- [ ] **Step 1: Add `Channel` import and modify `workflow_execute_step` command in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `workflow_execute_step` command (around line 322):

Current:
```rust
async fn workflow_execute_step(
    project_dir: String,
    issue_id: String,
    app: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    workflow::execute_step(&project_dir, &issue_id, app).await
}
```

Change to:
```rust
async fn workflow_execute_step(
    project_dir: String,
    issue_id: String,
    on_chunk: tauri::ipc::Channel<claude::StreamChunk>,
    app: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    workflow::execute_step(&project_dir, &issue_id, on_chunk, app).await
}
```

- [ ] **Step 2: Thread channel through `workflow::execute_step`**

In `src-tauri/src/workflow.rs`, find `pub async fn execute_step` (around line 647). Add the channel parameter:

```rust
pub async fn execute_step(
    project_dir: &str,
    ticket_id: &str,
    on_chunk: tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
```

Find where it calls `agent::execute_step(...)` and pass `on_chunk` through. The exact call site is where `project_dir`, `issue_id`, `prompt`, `session_id`, etc. are passed. Add `on_chunk` as a new parameter.

- [ ] **Step 3: Modify `agent::execute_step` to accept and use channel**

In `src-tauri/src/agent.rs`, change the function signature (line 473):

```rust
pub async fn execute_step(
    project_dir: &str,
    issue_id: &str,
    prompt: &str,
    session_id: Option<&str>,
    allowed_tools: Option<Vec<String>>,
    on_chunk: &tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: &tauri::AppHandle,
    tickets_dir_override: Option<&str>,
    canonical_project_dir: Option<&str>,
) -> Result<(String, String), String> {
```

- [ ] **Step 4: Update `dispatch_message_to_tauri` to use channel for StreamChunk**

In `src-tauri/src/agent.rs`, change `dispatch_message_to_tauri` (line 1055) to accept the channel:

```rust
fn dispatch_message_to_tauri(
    msg_type: &str,
    params: &serde_json::Value,
    issue_id: &str,
    on_chunk: &tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: &tauri::AppHandle,
    canonical_project_dir: &str,
) {
```

Replace every `StreamChunk { ... }.emit(app_handle)` call inside this function with `on_chunk.send(StreamChunk { ... }).ok()`. There are ~10 such calls for message types: `session`, `text`, `tool_start`, `tool_input`, `tool_end`, `tool_result`, `thinking`, `result`, `error`.

Non-StreamChunk events (`SectionUpdateEvent`, `NotificationEvent`, etc.) continue using `.emit(app_handle)` unchanged.

- [ ] **Step 5: Update direct StreamChunk emits in the read loop**

Also in `agent.rs`, there are StreamChunk emits outside `dispatch_message_to_tauri`:
- `queryComplete` handler (~line 836): Change `.emit(app_handle)` to `on_chunk.send(...)`.
- `queryError` handler (~line 851): Same change.
- stderr task (~line 687): This runs in a separate `tokio::spawn`. Clone the channel (or pass an `Arc`) so the stderr task can use it. `Channel<T>` implements `Clone`.
- Timeout handler (~line 975): Change `.emit(app_handle)` to `on_chunk.send(...)`.

For the stderr spawned task, clone the channel before spawning:

```rust
let stderr_chunk_channel = on_chunk.clone();
let stderr_handle = tokio::spawn(async move {
    // ...
    let _ = stderr_chunk_channel.send(StreamChunk { ... });
    // ...
});
```

Note: Verify that `tauri::ipc::Channel<T>` is `Send + 'static` (it is — it's designed for this). If the compiler complains, wrap in `Arc`.

- [ ] **Step 6: Update all callers of `dispatch_message_to_tauri`**

There's one call site in the read loop (~line 819). Add `on_chunk` to the call:

```rust
dispatch_message_to_tauri(
    msg_type,
    &params,
    issue_id,
    on_chunk,
    app_handle,
    canonical_project_dir.unwrap_or(project_dir),
);
```

- [ ] **Step 7: Verify Rust compiles**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon/src-tauri && cargo check`
Expected: No errors. If there are lifetime or borrow issues with Channel, check if it needs to be passed as `&Channel` or cloned.

- [ ] **Step 8: Commit Rust changes**

```bash
git add src-tauri/src/lib.rs src-tauri/src/workflow.rs src-tauri/src/agent.rs
git commit -m "feat: migrate StreamChunk from events to Channel API for safe high-frequency streaming"
```

---

## Task 5: Migrate StreamChunk to Channel API (Frontend Side)

**Files:**
- Modify: `src/features/workflow/hooks/use-workflow-streaming.ts`
- Modify: `src/features/workflow/hooks/use-workflow.ts`
- Modify: `src/shared/test/mocks/tauri.ts`
- Modify: `src/features/workflow/hooks/use-workflow-streaming.test.ts`

### Background: Frontend Channel API

```typescript
import { Channel } from "@tauri-apps/api/core";

const channel = new Channel<StreamChunk>();
channel.onmessage = (chunk) => {
  // Process chunk — ordered, no event system overhead
};

// Pass to command
await commands.workflowExecuteStep(projectDir, issueId, channel);
```

The channel is created per-invocation and passed directly to the command. No global listeners, no cleanup needed — the channel is scoped to the command call.

- [ ] **Step 1: Update tauri mock to support Channel**

In `src/shared/test/mocks/tauri.ts`, add a mock Channel class:

```typescript
/** Mock Channel for testing channel-based streaming */
export class MockChannel<T> {
  onmessage: ((payload: T) => void) | null = null;

  /** Simulate receiving a message (for tests) */
  send(payload: T) {
    this.onmessage?.(payload);
  }
}
```

Also add a mock for `@tauri-apps/api/core` Channel:

```typescript
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: MockChannel,
}));
```

- [ ] **Step 2: Rewrite `use-workflow-streaming.ts` to create a channel**

The streaming hook no longer subscribes to events. Instead, it creates a `Channel<StreamChunk>` that the `executeStep` caller passes to the command.

Key change: `useWorkflowStreaming` returns a `createStreamChannel()` function instead of managing a global event listener. The `executeStep` function in `use-workflow.ts` calls `createStreamChannel()` to get a channel, then passes it to the Tauri command.

```typescript
import { useState, useCallback, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import type {
  StepOutputStream,
  ToolActivity,
  ContentBlock,
  SubagentActivity,
  StreamChunk,
} from "@/shared/types";

// ... keep updateToolInBlocks and emptyStepOutput unchanged ...

export function useWorkflowStreaming(
  activeTicketId: string | null,
  executingStepRef: React.MutableRefObject<string | null>
) {
  const [stepOutputs, setStepOutputs] = useState<Record<string, StepOutputStream>>({});

  const createStreamChannel = useCallback((): Channel<StreamChunk> => {
    const channel = new Channel<StreamChunk>();

    channel.onmessage = (chunk) => {
      // Only process chunks for the active ticket
      if (activeTicketId && chunk.issue_id !== activeTicketId) return;

      const stepId = executingStepRef.current;
      if (!stepId) return;

      setStepOutputs((prev) => {
        const current = prev[stepId] ?? emptyStepOutput();
        const updated = { ...current };

        // IMPORTANT: Copy the ENTIRE switch(chunk.chunk_type) block from the
        // current implementation (all ~240 lines of case handlers: text, tool_start,
        // tool_input, tool_end, tool_result, tool_progress, subagent_start,
        // subagent_progress, subagent_complete, files_changed, tool_use_summary,
        // compacting, thinking, stderr, result, error).
        // The logic is identical — only the delivery mechanism changed.

        return { ...prev, [stepId]: updated };
      });
    };

    return channel;
  }, [activeTicketId]);

  const getStepOutput = useCallback(
    (stepId: string): StepOutputStream | undefined => stepOutputs[stepId],
    [stepOutputs]
  );

  // No streamingReady needed — channel is created synchronously
  return { stepOutputs, getStepOutput, createStreamChannel, streamingReady: true };
}
```

Note: `streamingReady` is always `true` now because there's no async listener setup. The channel is created synchronously when `executeStep` is called. Keep `streamingReady` in the return type for backward compatibility with `use-workflow.ts`'s `listenersReady` check.

- [ ] **Step 3: Update `use-workflow.ts` to pass channel to command**

In `use-workflow.ts`, find the `executeStep` function. Currently it calls:
```typescript
await commands.workflowExecuteStep(projectDir, activeTicketId);
```

Change to:
```typescript
const channel = streaming.createStreamChannel();
await commands.workflowExecuteStep(projectDir, activeTicketId, channel);
```

Import `Channel` type if needed. The `streaming` object comes from `useWorkflowStreaming(...)`.

Also update the `listenersReady` check — remove `streaming.streamingReady` from it (or keep it since it's always true now, harmless either way).

- [ ] **Step 4: Regenerate bindings**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run tauri:dev`

Wait for it to start, then stop it (Ctrl+C). This regenerates `src/bindings.ts` with the new `workflowExecuteStep` signature that includes the channel parameter.

Verify in `src/bindings.ts` that the command now accepts 3 args: `projectDir`, `issueId`, and a channel.

- [ ] **Step 5: Update streaming tests**

Rewrite `src/features/workflow/hooks/use-workflow-streaming.test.ts` to test channel-based streaming:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { clearTauriMocks } from "@/shared/test/mocks/tauri";
import { useWorkflowStreaming } from "@/features/workflow/hooks/use-workflow-streaming";
import type { StreamChunk } from "@/shared/types";

describe("useWorkflowStreaming", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("streamingReady is always true (no async setup)", () => {
    const executingStepRef = { current: null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );
    expect(result.current.streamingReady).toBe(true);
  });

  it("createStreamChannel returns a channel that processes chunks", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello ",
      } as StreamChunk);
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "World",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]?.textContent).toBe("Hello World");
  });

  it("ignores chunks for a different issue_id", () => {
    const executingStepRef = { current: "step-1" as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-OTHER",
        chunk_type: "text",
        content: "Ignored",
      } as StreamChunk);
    });

    expect(result.current.stepOutputs["step-1"]).toBeUndefined();
  });

  it("ignores chunks when executingStepRef is null", () => {
    const executingStepRef = { current: null as string | null };
    const { result } = renderHook(() =>
      useWorkflowStreaming("issue-1", executingStepRef)
    );

    const channel = result.current.createStreamChannel();

    act(() => {
      channel.onmessage!({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Dropped",
      } as StreamChunk);
    });

    expect(Object.keys(result.current.stepOutputs)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test -- src/features/workflow/hooks/`
Expected: All tests PASS

- [ ] **Step 7: Remove `StreamChunk` from event registration**

In `src-tauri/src/lib.rs`, remove `StreamChunk` from `collect_events![...]` — it's no longer emitted as an event. Also remove `tauri_specta::Event` from `StreamChunk`'s derive list in `claude.rs` (keep `specta::Type` since it's needed for the Channel). Regenerate bindings afterward.

- [ ] **Step 8: Run full test suite**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run test`
Expected: All tests PASS

- [ ] **Step 9: Type-check both frontend and Rust**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && npx tsc --noEmit && cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/features/workflow/hooks/use-workflow-streaming.ts \
        src/features/workflow/hooks/use-workflow-streaming.test.ts \
        src/features/workflow/hooks/use-workflow.ts \
        src/shared/test/mocks/tauri.ts \
        src/bindings.ts
git commit -m "feat: frontend channel-based streaming, remove event listener for StreamChunk"
```

---

## Task 6: Smoke Test the Full Flow

This is a manual verification step. The channel migration changes how data flows from Rust to React for the most critical path in the app.

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/jamessolomon/conductor/workspaces/meldui/saskatoon && bun run tauri:dev`

- [ ] **Step 2: Open a project and trigger an agent workflow step**

Select a project directory, open a ticket with a workflow, and execute a step. Verify:
- Text streams in real-time (no lag vs before)
- Tool cards appear and update (tool_start, tool_input, tool_end, tool_result)
- Thinking content accumulates
- Step completes and result is shown
- No console errors related to events or channels

- [ ] **Step 3: Verify other events still work**

During the same step execution, verify:
- Permission dialog appears if agent uses a dangerous tool
- Status text updates in the status bar
- Notifications appear
- Subtask creation/updates reflect in the kanban board
- Section updates trigger ticket detail refresh

- [ ] **Step 4: Test ticket switching during execution**

Start a step on ticket A, switch to ticket B while it's running. Verify:
- Streaming output stays on ticket A's step
- No cross-talk between tickets

- [ ] **Step 5: Commit any fixes**

If any issues were found and fixed during smoke testing:

```bash
git add <fixed-files>
git commit -m "fix: address issues found during channel migration smoke test"
```
