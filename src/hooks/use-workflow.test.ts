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
      workflow_completed: false,
    });
    // For getWorkflowState call inside executeStep
    mockInvoke.mockResolvedValueOnce({
      workflow_id: "wf-1",
      current_step_id: "step-1",
      step_status: "completed",
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

  // Helper: sets up hook with active ticket, current step, and a blocking
  // executeStep call so that executingStepRef is set for streaming output routing.
  async function setupWithActiveExecution() {
    // Use a controllable mock for invoke
    let resolveExecute!: (value: unknown) => void;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "workflow_execute_step") {
        return new Promise((resolve) => { resolveExecute = resolve; });
      }
      if (cmd === "workflow_state") {
        return Promise.resolve({
          workflow_id: "wf-1",
          current_step_id: "step-1",
          step_status: "in_progress",
          step_history: [],
        });
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useWorkflow("/test/project"));
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => { result.current.setActiveTicketId("issue-1"); });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    // Set current step via getWorkflowState
    await act(async () => { await result.current.getWorkflowState("issue-1"); });

    // Start a blocking executeStep to set executingStepRef
    act(() => { result.current.executeStep("issue-1"); });

    return { result, resolveExecute };
  }

  it("text StreamChunk events accumulate in stepOutputs", async () => {
    const { result } = await setupWithActiveExecution();

    // Emit text chunks while executeStep is active
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
    const { result } = await setupWithActiveExecution();

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
    const { result } = await setupWithActiveExecution();

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

  describe("executingStepRef output routing", () => {
    it("streaming output only routes to step when executeStep is active", async () => {
      // executeStep will block until we resolve it
      let resolveExecute!: (value: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "workflow_execute_step") {
          return new Promise((resolve) => { resolveExecute = resolve; });
        }
        if (cmd === "workflow_state") {
          return Promise.resolve({
            workflow_id: "wf-1",
            current_step_id: "step-1",
            step_status: "in_progress",
            step_history: [],
          });
        }
        return Promise.resolve(null);
      });

      const { result } = renderHook(() => useWorkflow("/test/project"));
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => { result.current.setActiveTicketId("issue-1"); });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Set current step
      await act(async () => { await result.current.getWorkflowState("issue-1"); });

      // Start executeStep (won't resolve yet)
      let stepDone = false;
      act(() => {
        result.current.executeStep("issue-1").then(() => { stepDone = true; });
      });

      // Emit text while executeStep is active — should be captured
      act(() => {
        emitTauriEvent("workflow-step-output", {
          issue_id: "issue-1",
          chunk_type: "text",
          content: "During execution",
        } as StreamChunk);
      });

      await waitFor(() => {
        expect(result.current.stepOutputs["step-1"]?.textContent).toBe("During execution");
      });

      // Resolve executeStep
      await act(async () => {
        resolveExecute({ step_id: "step-1", response: "done", workflow_completed: false });
        // Wait for the promise chain to settle
        await new Promise((r) => setTimeout(r, 10));
      });

      // After executeStep completes, executingStepRef is null.
      // New streaming events should be dropped (no active execution).
      act(() => {
        emitTauriEvent("workflow-step-output", {
          issue_id: "issue-1",
          chunk_type: "text",
          content: " SHOULD NOT APPEAR",
        } as StreamChunk);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(result.current.stepOutputs["step-1"]?.textContent).toBe("During execution");
    });
  });

  describe("executeStep error handling", () => {
    it("clears pendingFeedback and pendingPermission on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("sidecar timed out"));
      // getWorkflowState on error recovery
      mockInvoke.mockResolvedValueOnce({
        workflow_id: "wf-1",
        current_step_id: "step-1",
        step_status: { failed: "sidecar timed out" },
        step_history: [],
      });

      const { result } = renderHook(() => useWorkflow("/test/project"));
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => { result.current.setActiveTicketId("issue-1"); });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Simulate pending feedback being set (as if sidecar requested it before dying)
      act(() => {
        emitTauriEvent("agent-feedback-request", {
          request_id: "fb-1",
          ticket_id: "issue-1",
          summary: "Review this",
        });
      });

      await waitFor(() => {
        expect(result.current.pendingFeedback).not.toBeNull();
      });

      // Now executeStep fails
      await act(async () => {
        await result.current.executeStep("issue-1");
      });

      // pendingFeedback should be cleared
      expect(result.current.pendingFeedback).toBeNull();
      expect(result.current.error).toContain("Step execution failed");
    });
  });

  describe("respondToFeedback broken pipe handling", () => {
    it("clears pendingFeedback and shows session expired on broken pipe", async () => {
      const { result } = renderHook(() => useWorkflow("/test/project"));
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => { result.current.setActiveTicketId("issue-1"); });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Simulate feedback request
      act(() => {
        emitTauriEvent("agent-feedback-request", {
          request_id: "fb-1",
          ticket_id: "issue-1",
          summary: "Review this",
        });
      });

      await waitFor(() => {
        expect(result.current.pendingFeedback).not.toBeNull();
      });

      // Mock broken pipe error when responding
      mockInvoke.mockRejectedValueOnce(
        new Error("Failed to write to sidecar stdin: Broken pipe (os error 32)")
      );

      await act(async () => {
        await result.current.respondToFeedback("fb-1", true);
      });

      // Should clear feedback and show friendly error
      expect(result.current.pendingFeedback).toBeNull();
      expect(result.current.error).toContain("session expired");
    });

    it("shows generic error for non-broken-pipe failures", async () => {
      const { result } = renderHook(() => useWorkflow("/test/project"));
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => { result.current.setActiveTicketId("issue-1"); });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => {
        emitTauriEvent("agent-feedback-request", {
          request_id: "fb-1",
          ticket_id: "issue-1",
          summary: "Review",
        });
      });

      await waitFor(() => expect(result.current.pendingFeedback).not.toBeNull());

      mockInvoke.mockRejectedValueOnce(new Error("Some other error"));

      await act(async () => {
        await result.current.respondToFeedback("fb-1", true);
      });

      expect(result.current.pendingFeedback).toBeNull();
      expect(result.current.error).toContain("Failed to respond to feedback");
    });
  });

  describe("respondToPermission broken pipe handling", () => {
    it("clears pendingPermission and shows session expired on broken pipe", async () => {
      const { result } = renderHook(() => useWorkflow("/test/project"));
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => { result.current.setActiveTicketId("issue-1"); });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Simulate permission request
      act(() => {
        emitTauriEvent("agent-permission-request", {
          request_id: "perm-1",
          tool_name: "Bash",
          input: { command: "rm -rf" },
        });
      });

      await waitFor(() => {
        expect(result.current.pendingPermission).not.toBeNull();
      });

      mockInvoke.mockRejectedValueOnce(
        new Error("Failed to write to sidecar stdin: Broken pipe (os error 32)")
      );

      await act(async () => {
        await result.current.respondToPermission("perm-1", true);
      });

      expect(result.current.pendingPermission).toBeNull();
      expect(result.current.error).toContain("session expired");
    });
  });
});
