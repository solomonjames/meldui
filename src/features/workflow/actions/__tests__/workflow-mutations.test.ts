import { beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks, mockInvoke } from "@/shared/test/mocks/tauri";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { executeStep } from "@/features/workflow/actions/workflow-mutations";

describe("executeStep", () => {
  beforeEach(() => {
    clearTauriMocks();
    orchestrationStoreFactory.disposeStore("ticket-1");
    orchestrationStoreFactory.disposeStore("ticket-2");
    permissionsStoreFactory.disposeStore("ticket-1");
    permissionsStoreFactory.disposeStore("ticket-2");
  });

  it("sets queryStartedAt at start and clears on success", async () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workflow_execute_step") {
        // During execution, queryStartedAt should be set
        expect(store.getState().queryStartedAt).not.toBeNull();
        return { response: "done" };
      }
      if (cmd === "workflow_state") {
        return store.getState().workflowState;
      }
      return null;
    });

    await executeStep("/test", "ticket-1", []);

    expect(store.getState().queryStartedAt).toBeNull();
  });

  it("clears queryStartedAt on error", async () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workflow_execute_step") {
        throw new Error("Agent crashed");
      }
      if (cmd === "workflow_state") {
        return store.getState().workflowState;
      }
      return null;
    });

    await executeStep("/test", "ticket-1", []);

    expect(store.getState().queryStartedAt).toBeNull();
    expect(store.getState().error).toContain("Step execution failed");
  });

  // ── autoAdvance → Rust sync ──

  it("syncs autoAdvance=true to Rust before execution", async () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });
    store.getState().setAutoAdvance(true);

    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "workflow_execute_step") return { response: "done" };
      if (cmd === "workflow_state") return store.getState().workflowState;
      return null;
    });

    await executeStep("/test", "ticket-1", []);

    const autoAdvanceCall = calls.find((c) => c.cmd === "set_auto_advance");
    expect(autoAdvanceCall).toBeDefined();
    expect(autoAdvanceCall!.args.enabled).toBe(true);

    // set_auto_advance must happen before workflow_execute_step
    const syncIdx = calls.findIndex((c) => c.cmd === "set_auto_advance");
    const execIdx = calls.findIndex((c) => c.cmd === "workflow_execute_step");
    expect(syncIdx).toBeLessThan(execIdx);
  });

  it("syncs autoAdvance=false to Rust before execution", async () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });
    // autoAdvance defaults to false — don't set it

    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "workflow_execute_step") return { response: "done" };
      if (cmd === "workflow_state") return store.getState().workflowState;
      return null;
    });

    await executeStep("/test", "ticket-1", []);

    const autoAdvanceCall = calls.find((c) => c.cmd === "set_auto_advance");
    expect(autoAdvanceCall).toBeDefined();
    expect(autoAdvanceCall!.args.enabled).toBe(false);
  });

  it("concurrent tickets each sync their own autoAdvance to Rust", async () => {
    const storeA = orchestrationStoreFactory.getStore("ticket-1");
    const storeB = orchestrationStoreFactory.getStore("ticket-2");

    storeA.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });
    storeB.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    storeA.getState().setAutoAdvance(true);
    // storeB.autoAdvance stays false

    const autoAdvanceCalls: Array<{ projectDir: string; enabled: boolean }> = [];
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "set_auto_advance") {
        autoAdvanceCalls.push({
          projectDir: args.projectDir as string,
          enabled: args.enabled as boolean,
        });
        return null;
      }
      if (cmd === "workflow_execute_step") return { response: "done" };
      if (cmd === "workflow_state") return storeA.getState().workflowState;
      return null;
    });

    // Execute ticket A (autoAdvance=true), then ticket B (autoAdvance=false)
    await executeStep("/test", "ticket-1", []);
    await executeStep("/test", "ticket-2", []);

    // Should have two set_auto_advance calls with different values
    expect(autoAdvanceCalls).toHaveLength(2);
    expect(autoAdvanceCalls[0].enabled).toBe(true);
    expect(autoAdvanceCalls[1].enabled).toBe(false);
  });

  // ── queryStartedAt lifecycle ──

  it("maintains independent queryStartedAt for concurrent tickets", async () => {
    const storeA = orchestrationStoreFactory.getStore("ticket-1");
    const storeB = orchestrationStoreFactory.getStore("ticket-2");

    storeA.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });
    storeB.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    // Track when each ticket's queryStartedAt was set
    let ticketAStartTime: number | null = null;
    let ticketBStartTime: number | null = null;

    let resolveA: () => void;
    let resolveB: () => void;
    const promiseA = new Promise<void>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<void>((r) => {
      resolveB = r;
    });

    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "workflow_execute_step") {
        const issueId = args.issueId ?? args.issue_id;
        if (issueId === "ticket-1") {
          ticketAStartTime = storeA.getState().queryStartedAt;
          // ticket-2 should not be affected
          expect(storeB.getState().queryStartedAt).toBeNull();
          resolveA!();
          return { response: "done" };
        }
        if (issueId === "ticket-2") {
          ticketBStartTime = storeB.getState().queryStartedAt;
          resolveB!();
          return { response: "done" };
        }
      }
      if (cmd === "workflow_state") {
        const issueId = args.issueId ?? args.issue_id;
        if (issueId === "ticket-1") return storeA.getState().workflowState;
        if (issueId === "ticket-2") return storeB.getState().workflowState;
      }
      return null;
    });

    // Start both tickets
    const execA = executeStep("/test", "ticket-1", []);
    await promiseA;

    const execB = executeStep("/test", "ticket-2", []);
    await promiseB;

    await Promise.all([execA, execB]);

    // Both should have had independent start times
    expect(ticketAStartTime).not.toBeNull();
    expect(ticketBStartTime).not.toBeNull();

    // Both should be cleared after completion
    expect(storeA.getState().queryStartedAt).toBeNull();
    expect(storeB.getState().queryStartedAt).toBeNull();
  });
});
