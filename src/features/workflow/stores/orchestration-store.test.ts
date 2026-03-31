import { describe, it, expect, beforeEach } from "vitest";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import type { WorkflowState } from "@/shared/types";

describe("orchestrationStore", () => {
  beforeEach(() => {
    orchestrationStoreFactory.disposeStore("ticket-1");
  });

  it("initializes with null state", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    expect(store.getState().workflowState).toBeNull();
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(store.getState().listenersReady).toBe(false);
  });

  it("setWorkflowState updates workflow state", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    const state: WorkflowState = {
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    };
    store.getState().setWorkflowState(state);
    expect(store.getState().workflowState).toEqual(state);
  });

  it("setLoading updates loading flag", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setLoading(true);
    expect(store.getState().loading).toBe(true);
    store.getState().setLoading(false);
    expect(store.getState().loading).toBe(false);
  });

  it("setError updates error message", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setError("Something went wrong");
    expect(store.getState().error).toBe("Something went wrong");
    store.getState().setError(null);
    expect(store.getState().error).toBeNull();
  });

  it("setListenersReady updates ready flag", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setListenersReady(true);
    expect(store.getState().listenersReady).toBe(true);
  });

  it("clearState resets all fields", () => {
    const store = orchestrationStoreFactory.getStore("ticket-1");
    store.getState().setWorkflowState({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "in_progress",
      step_history: [],
    });
    store.getState().setLoading(true);
    store.getState().setError("err");

    store.getState().clearState();

    expect(store.getState().workflowState).toBeNull();
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
  });
});
