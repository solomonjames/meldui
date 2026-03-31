# Zustand Adoption Design

**Date:** 2026-03-31
**Motivation:** Developer ergonomics (B) and future-proofing (C) — simplify the 1,292 LOC workflow hook system and create a cleaner foundation for new features
**Approach:** Incremental store-by-store migration (Approach B)

---

## Store Architecture

### Store Inventory

| Store | Type | Location | Purpose |
|-------|------|----------|---------|
| Navigation | Singleton | `src/shared/stores/navigation-store.ts` | `activePage`, `activeTicketId`, `createDialogOpen` |
| Streaming | Per-ticket | `src/features/workflow/stores/streaming-store.ts` | `stepOutputs`, content blocks, tool activities, thinking content |
| Orchestration | Per-ticket | `src/features/workflow/stores/orchestration-store.ts` | `workflowState`, `loading`, `error`, `listenersReady` |
| Permissions | Per-ticket | `src/features/workflow/stores/permissions-store.ts` | `pendingPermission`, response handler |
| Feedback | Per-ticket | `src/features/workflow/stores/feedback-store.ts` | `pendingFeedback`, response handler |
| Notifications | Per-ticket | `src/features/workflow/stores/notifications-store.ts` | `notifications[]`, `statusText`, `lastUpdatedSectionId` |
| Review | Per-ticket | `src/features/workflow/stores/review-store.ts` | `findings`, `comments`, `pendingRequestId`, `roundKey` |

### Store Factory (Per-Ticket Pattern)

Multi-ticket state is handled via a store-per-ticket factory at `src/shared/stores/create-ticket-store.ts`:

```typescript
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

export function createTicketStoreFactory<T>(
  initializer: (set, get) => T
) {
  const stores = new Map<string, StoreApi<T>>();

  function getStore(ticketId: string): StoreApi<T> {
    if (!stores.has(ticketId)) {
      stores.set(ticketId, createStore<T>()(initializer));
    }
    return stores.get(ticketId)!;
  }

  function useTicketStore<R>(ticketId: string, selector: (s: T) => R): R {
    return useStore(getStore(ticketId), selector);
  }

  function disposeStore(ticketId: string) {
    stores.delete(ticketId);
  }

  return { getStore, useTicketStore, disposeStore };
}
```

- `getStore()` — imperative access for Tauri event handlers and tests
- `useTicketStore()` — React hook with selector-based subscriptions
- `disposeStore()` — cleanup when ticket is unloaded

**Why store-per-ticket instead of keyed maps:**
- Selectors stay flat (`s => s.blocks` vs `s => s.outputs[ticketId]?.blocks`)
- Complete isolation — ticket A's updates never trigger ticket B's subscribers
- Clean disposal — `stores.delete(ticketId)` removes the entire instance
- DevTools show named instances (`streaming:TICKET-123`)

### Middleware Strategy

- `subscribeWithSelector` on the streaming store (enables non-React subscriptions for derived state)
- `devtools` on all stores in development (named per-ticket)
- No `persist` — revisit for backlog preferences later
- No `immer` — state shapes are flat enough for spread updates

### What Stays Outside Zustand

- **TanStack Query** — all `invoke()` server state (ticket data, workflow definitions, settings)
- **Local component state** — form inputs, expand/collapse toggles, drag overlay
- **Agent config** — already using TanStack Query + localStorage

---

## Migration Phases

### Phase 1: Foundation

- Install `zustand`
- Create `createTicketStoreFactory` utility
- Create singleton `navigation-store.ts` (`activePage`, `activeTicketId`, `createDialogOpen`)
- Update `App.tsx`, `AppSidebar`, `TicketPage`, `BacklogPage` to use navigation store
- Remove navigation props/callbacks from component interfaces

**Validation:** App navigates identically, no prop drilling for page/ticket selection.

### Phase 2: Streaming Store

- Create per-ticket `streaming-store.ts` using the factory
- Refactor `useWorkflowStreaming` to write chunks to the store instead of `useState`
- Keep `useWorkflowStreaming` as a thin event-listener hook that dispatches to the store
- Update view components (`ChatView`, `ProgressView`, `ActivityBar`) to use granular selectors
- Export named selectors: `selectContentBlocks`, `selectActiveToolName`, `selectThinkingContent`, etc.

**Validation:** Streaming works identically. Views only re-render when their specific slice changes.

### Phase 3: Orchestration Store

- Create per-ticket `orchestration-store.ts` (`workflowState`, `loading`, `error`, `listenersReady`)
- Refactor the core `useWorkflow` hook — move state into the store, keep the hook as a thin coordinator for Tauri event listeners
- `WorkflowShell` reads from orchestration store directly

**Validation:** Workflow lifecycle (start, step execution, completion) works identically.

### Phase 4: Permissions, Feedback, Notifications

- Three small per-ticket stores, each following the same pattern
- Refactor `useWorkflowPermissions`, `useWorkflowFeedback`, `useWorkflowNotifications` into thin event-listener hooks that dispatch to stores
- View components read from stores with selectors

**Validation:** Permission dialogs, feedback prompts, and notifications all work identically.

### Phase 5: Review Store

- Per-ticket `review-store.ts` with findings, comments, actions, round tracking
- Refactor `useWorkflowReview`
- `DiffReviewView` reads from review store

**Validation:** Multi-round review flow works identically.

### Phase 6: Cleanup

- Remove `WorkflowProvider` and `WorkflowContext`
- Remove the old `useWorkflow` orchestrator hook
- Remove dead code, update/add tests
- Verify with `bun run knip` for unused exports

**Validation:** All tests pass, no dead code, no context provider in the tree.

---

## File Structure

### New Files

```
src/
  shared/
    stores/
      create-ticket-store.ts    # Factory utility
      navigation-store.ts       # Singleton store
  features/
    workflow/
      stores/
        streaming-store.ts      # Per-ticket factory
        orchestration-store.ts  # Per-ticket factory
        permissions-store.ts    # Per-ticket factory
        feedback-store.ts       # Per-ticket factory
        notifications-store.ts  # Per-ticket factory
        review-store.ts         # Per-ticket factory
```

### Import Rules

Follow existing CLAUDE.md architecture rules:

- `shared/stores/` — importable by anyone (features, app). Contains the factory utility and cross-feature stores (navigation).
- `features/workflow/stores/` — importable by workflow feature components and `app/` only. Other features must NOT import workflow stores directly.
- Cross-feature data still flows through TanStack Query cache or Tauri events, not stores.

---

## Thin Hook Pattern

During migration (phases 2-5), existing hooks become thin event-listener wrappers:

```typescript
// use-workflow-streaming.ts (after phase 2)
export function useWorkflowStreaming(ticketId: string) {
  const store = getStreamingStore(ticketId);

  useEffect(() => {
    // Subscribe to Tauri Channel
    // On each chunk: store.getState().handleChunk(chunk)
    // Cleanup: unsubscribe
  }, [ticketId]);
}
```

These thin hooks manage `useEffect` lifecycle for Tauri event listeners. In phase 6, evaluate whether they're worth keeping as standalone hooks or should be inlined into the components that use them.

---

## Store Lifecycle

Stores are created lazily when a ticket is first accessed via `getStore(ticketId)`. Cleanup happens via a `disposeTicketStores(ticketId)` function exported from a shared module that calls `disposeStore(ticketId)` on every per-ticket store factory (streaming, orchestration, permissions, feedback, notifications, review). This function is called when:

- User navigates away from a ticket and it's no longer in the active set
- Workflow completes and the user returns to backlog

The navigation store (singleton) is responsible for tracking which tickets are "active." When a ticket leaves the active set, the cleanup function is called. This mirrors the current `useWorkflow` pattern where state is cleaned up when `activeTicketId` changes.

---

## Testing Strategy

- Stores are testable without React via `getStore(id).getState()` / `getStore(id).setState()`
- Thin hooks only need to test "does the right store action get called when a Tauri event fires"
- View component tests use `getStore(id).setState(...)` to set up state, then assert rendered output
