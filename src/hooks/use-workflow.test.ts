import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  mockInvoke,
  clearTauriMocks,
  emitTauriEvent,
} from "@/test/mocks/tauri";
import { useWorkflow } from "./use-workflow";
import type { StreamChunk } from "@/types";

describe("useWorkflow", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  it("listenersReady becomes true after mount", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"));

    await waitFor(() => {
      expect(result.current.listenersReady).toBe(true);
    });
  });

  it("executeStep calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValueOnce({
      step_id: "step-1",
      response: "done",
      awaiting_gate: true,
      workflow_completed: false,
    });
    // For getWorkflowState call inside executeStep
    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "awaiting_gate",
      step_history: [],
    });

    const { result } = renderHook(() => useWorkflow("/test/project"));

    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    await act(async () => {
      await result.current.executeStep("issue-1");
    });

    expect(mockInvoke).toHaveBeenCalledWith("workflow_execute_step", {
      projectDir: "/test/project",
      issueId: "issue-1",
    });
  });

  it("executeStep sets loading and reverts on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("sidecar crashed"));
    // For getWorkflowState on error recovery
    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    const { result } = renderHook(() => useWorkflow("/test/project"));
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    await act(async () => {
      await result.current.executeStep("issue-1");
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain("Step execution failed");
  });

  it("text StreamChunk events accumulate in stepOutputs", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"));

    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    // Set up the active ticket and current step
    act(() => {
      result.current.setActiveTicketId("issue-1");
    });

    // We need to wait for listeners to re-register with new activeTicketId
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    // Manually set currentState so currentStepRef is set
    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    await act(async () => {
      await result.current.getWorkflowState("issue-1");
    });

    // Emit text chunks
    const chunk1: StreamChunk = {
      issue_id: "issue-1",
      chunk_type: "text",
      content: "Hello ",
    };
    const chunk2: StreamChunk = {
      issue_id: "issue-1",
      chunk_type: "text",
      content: "World",
    };

    act(() => {
      emitTauriEvent("workflow-step-output", chunk1);
      emitTauriEvent("workflow-step-output", chunk2);
    });

    await waitFor(() => {
      expect(result.current.stepOutputs["step-1"]?.textContent).toBe(
        "Hello World"
      );
    });
  });

  it("error StreamChunk events are captured in stderrLines", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"));
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => {
      result.current.setActiveTicketId("issue-1");
    });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    await act(async () => {
      await result.current.getWorkflowState("issue-1");
    });

    const errorChunk: StreamChunk = {
      issue_id: "issue-1",
      chunk_type: "error",
      content: "Something went wrong",
    };

    act(() => {
      emitTauriEvent("workflow-step-output", errorChunk);
    });

    await waitFor(() => {
      const output = result.current.stepOutputs["step-1"];
      expect(output?.stderrLines).toContainEqual(
        "[error] Something went wrong"
      );
    });
  });

  it("result StreamChunk events set resultContent", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"));
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => {
      result.current.setActiveTicketId("issue-1");
    });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    await act(async () => {
      await result.current.getWorkflowState("issue-1");
    });

    const resultChunk: StreamChunk = {
      issue_id: "issue-1",
      chunk_type: "result",
      content: "Final result text",
    };

    act(() => {
      emitTauriEvent("workflow-step-output", resultChunk);
    });

    await waitFor(() => {
      expect(result.current.stepOutputs["step-1"]?.resultContent).toBe(
        "Final result text"
      );
    });
  });

  it("events for a different issue_id are filtered out", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"));
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => {
      result.current.setActiveTicketId("issue-1");
    });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "pending",
      step_history: [],
    });

    await act(async () => {
      await result.current.getWorkflowState("issue-1");
    });

    const wrongChunk: StreamChunk = {
      issue_id: "issue-OTHER",
      chunk_type: "text",
      content: "Should be ignored",
    };

    act(() => {
      emitTauriEvent("workflow-step-output", wrongChunk);
    });

    // Small delay to ensure event would have been processed
    await vi.advanceTimersByTimeAsync?.(50).catch(() => {});
    expect(result.current.stepOutputs["step-1"]).toBeUndefined();
  });
});
