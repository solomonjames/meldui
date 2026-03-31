import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { permissionsStoreFactory } from "@/features/workflow/stores/permissions-store";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import {
  mockInvoke,
  clearTauriMocks,
  emitTauriEvent,
  MockChannel,
} from "@/shared/test/mocks/tauri";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import type { StreamChunk } from "@/shared/types";
import { useWorkflow } from "@/features/workflow/hooks/use-workflow";

describe("useWorkflow", () => {
  let wrapper: ReturnType<typeof createQueryWrapper>;

  beforeEach(() => {
    clearTauriMocks();
    wrapper = createQueryWrapper();
    streamingStoreFactory.disposeStore("issue-1");
    streamingStoreFactory.disposeStore("issue-OTHER");
    permissionsStoreFactory.disposeStore("issue-1");
    orchestrationStoreFactory.disposeStore("issue-1");
  });

  it("listenersReady becomes true after mount", async () => {
    const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });

    await waitFor(() => {
      expect(result.current.listenersReady).toBe(true);
    });
  });

  it("executeStep calls invoke with correct args including channel", async () => {
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

    const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });

    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    await act(async () => {
      await result.current.executeStep("issue-1");
    });

    expect(mockInvoke).toHaveBeenCalledWith("workflow_execute_step", {
      projectDir: "/test/project",
      issueId: "issue-1",
      userMessage: null,
      onChunk: expect.any(MockChannel),
    });
  });

  it("executeStep sets loading and reverts on error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "workflow_list") return Promise.resolve([]);
      if (cmd === "workflow_execute_step") return Promise.reject(new Error("sidecar crashed"));
      if (cmd === "workflow_state")
        return Promise.resolve({
          workflow_id: "wf-1",
          current_step_id: "step-1",
          step_status: "pending",
          step_history: [],
        });
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => {
      result.current.setActiveTicketId("issue-1");
    });

    await act(async () => {
      await result.current.executeStep("issue-1");
    });

    expect(orchestrationStoreFactory.getStore("issue-1").getState().loading).toBe(false);
    expect(orchestrationStoreFactory.getStore("issue-1").getState().error).toContain(
      "Step execution failed",
    );
  });

  // Helper: sets up hook with active ticket, current step, and a blocking
  // executeStep call so that executingStepsRef is set for streaming output routing.
  // Returns the captured channel so tests can send chunks through it.
  async function setupWithActiveExecution() {
    let capturedChannel: MockChannel<StreamChunk> | null = null;
    let resolveExecute!: (value: unknown) => void;

    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "workflow_execute_step") {
        capturedChannel = args?.onChunk as MockChannel<StreamChunk>;
        return new Promise((resolve) => {
          resolveExecute = resolve;
        });
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

    const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    act(() => {
      result.current.setActiveTicketId("issue-1");
    });
    await waitFor(() => expect(result.current.listenersReady).toBe(true));

    // Set current step via getWorkflowState
    await act(async () => {
      await result.current.getWorkflowState("issue-1");
    });

    // Start a blocking executeStep to set executingStepsRef
    act(() => {
      result.current.executeStep("issue-1");
    });

    // Wait for the channel to be captured
    await waitFor(() => expect(capturedChannel).not.toBeNull());

    return { result, resolveExecute, getCapturedChannel: () => capturedChannel! };
  }

  it("text StreamChunk events accumulate in stepOutputs via channel", async () => {
    const { getCapturedChannel } = await setupWithActiveExecution();
    const channel = getCapturedChannel();

    act(() => {
      channel.send({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "Hello ",
      });
      channel.send({
        issue_id: "issue-1",
        chunk_type: "text",
        content: "World",
      });
    });

    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.textContent).toBe("Hello World");
  });

  it("error StreamChunk events are captured in stderrLines via channel", async () => {
    const { getCapturedChannel } = await setupWithActiveExecution();
    const channel = getCapturedChannel();

    act(() => {
      channel.send({
        issue_id: "issue-1",
        chunk_type: "error",
        content: "Something went wrong",
      });
    });

    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.stderrLines).toContainEqual("[error] Something went wrong");
  });

  it("result StreamChunk events set resultContent via channel", async () => {
    const { getCapturedChannel } = await setupWithActiveExecution();
    const channel = getCapturedChannel();

    act(() => {
      channel.send({
        issue_id: "issue-1",
        chunk_type: "result",
        content: "Final result text",
      });
    });

    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.resultContent).toBe("Final result text");
  });

  it("chunks for a different issue_id are filtered out via channel", async () => {
    const { getCapturedChannel } = await setupWithActiveExecution();
    const channel = getCapturedChannel();

    act(() => {
      channel.send({
        issue_id: "issue-OTHER",
        chunk_type: "text",
        content: "Should be ignored",
      });
    });

    // issue-1 should have no output for step-1
    const output = streamingStoreFactory.getStore("issue-1").getState().stepOutputs[
      "issue-1:step-1"
    ];
    expect(output?.textContent).toBeFalsy();
  });

  describe("executingStepsRef output routing", () => {
    it("streaming output only routes to step when executeStep is active", async () => {
      const { resolveExecute, getCapturedChannel } = await setupWithActiveExecution();
      const channel = getCapturedChannel();

      // Send chunk while executeStep is active -- should be captured
      act(() => {
        channel.send({
          issue_id: "issue-1",
          chunk_type: "text",
          content: "During execution",
        });
      });

      expect(
        streamingStoreFactory.getStore("issue-1").getState().stepOutputs["issue-1:step-1"]
          ?.textContent,
      ).toBe("During execution");

      // Resolve executeStep
      await act(async () => {
        resolveExecute({ step_id: "step-1", response: "done", workflow_completed: false });
        // Wait for the promise chain to settle
        await new Promise((r) => setTimeout(r, 10));
      });

      // After executeStep completes, executingStepsRef entry is null.
      // New streaming events through the same channel should be dropped (no active execution).
      act(() => {
        channel.send({
          issue_id: "issue-1",
          chunk_type: "text",
          content: " SHOULD NOT APPEAR",
        });
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(
        streamingStoreFactory.getStore("issue-1").getState().stepOutputs["issue-1:step-1"]
          ?.textContent,
      ).toBe("During execution");
    });
  });

  describe("executeStep error handling", () => {
    it("clears pendingPermission on error", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "workflow_list") return Promise.resolve([]);
        if (cmd === "workflow_execute_step") return Promise.reject(new Error("sidecar timed out"));
        if (cmd === "workflow_state")
          return Promise.resolve({
            workflow_id: "wf-1",
            current_step_id: "step-1",
            step_status: { failed: "sidecar timed out" },
            step_history: [],
          });
        return Promise.resolve(null);
      });

      const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => {
        result.current.setActiveTicketId("issue-1");
      });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Simulate pending permission being set (as if sidecar requested it before dying)
      act(() => {
        emitTauriEvent("agent-permission-request", {
          issue_id: "issue-1",
          request_id: "perm-1",
          tool_name: "Bash",
          input: { command: "rm -rf" },
        });
      });

      expect(
        permissionsStoreFactory.getStore("issue-1").getState().pendingPermission,
      ).not.toBeNull();

      // Now executeStep fails
      await act(async () => {
        await result.current.executeStep("issue-1");
      });

      // pendingPermission should be cleared
      expect(permissionsStoreFactory.getStore("issue-1").getState().pendingPermission).toBeNull();
      expect(result.current.error).toContain("Step execution failed");
    });
  });

  describe("respondToPermission broken pipe handling", () => {
    it("clears pendingPermission and shows session expired on broken pipe", async () => {
      const { result } = renderHook(() => useWorkflow("/test/project"), { wrapper });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      act(() => {
        result.current.setActiveTicketId("issue-1");
      });
      await waitFor(() => expect(result.current.listenersReady).toBe(true));

      // Simulate permission request
      act(() => {
        emitTauriEvent("agent-permission-request", {
          issue_id: "issue-1",
          request_id: "perm-1",
          tool_name: "Bash",
          input: { command: "rm -rf" },
        });
      });

      expect(
        permissionsStoreFactory.getStore("issue-1").getState().pendingPermission,
      ).not.toBeNull();

      mockInvoke.mockRejectedValueOnce(
        new Error("Failed to write to sidecar stdin: Broken pipe (os error 32)"),
      );

      await act(async () => {
        await result.current.respondToPermission("perm-1", true);
      });

      expect(permissionsStoreFactory.getStore("issue-1").getState().pendingPermission).toBeNull();
      expect(orchestrationStoreFactory.getStore("issue-1").getState().error).toContain(
        "session expired",
      );
    });
  });
});
