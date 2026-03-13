import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
  WorkflowSuggestion,
  StreamChunk,
  DiffFile,
} from "@/types";

export function useWorkflow(projectDir: string) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [currentState, setCurrentState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamOutput, setStreamOutput] = useState("");
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Subscribe to streaming events
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      // Clean up previous listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const unlisten = await listen<StreamChunk>(
        "workflow-step-output",
        (event) => {
          if (cancelled) return;
          const chunk = event.payload;
          // Only process chunks for the active ticket
          if (activeTicketId && chunk.issue_id !== activeTicketId) return;
          if (chunk.chunk_type === "text") {
            setStreamOutput((prev) => prev + chunk.content);
          } else if (chunk.chunk_type === "result") {
            setStreamOutput(chunk.content);
          }
        }
      );

      if (!cancelled) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [activeTicketId]);

  const listWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<WorkflowDefinition[]>("workflow_list", {
        projectDir,
      });
      setWorkflows(result);
      return result;
    } catch (err) {
      setError(`Failed to list workflows: ${err}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  const getWorkflow = useCallback(
    async (workflowId: string) => {
      try {
        return await invoke<WorkflowDefinition>("workflow_get", {
          projectDir,
          workflowId,
        });
      } catch (err) {
        setError(`Failed to get workflow: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  const assignWorkflow = useCallback(
    async (issueId: string, workflowId: string) => {
      try {
        setLoading(true);
        const state = await invoke<WorkflowState>("workflow_assign", {
          projectDir,
          issueId,
          workflowId,
        });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to assign workflow: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const getWorkflowState = useCallback(
    async (issueId: string) => {
      try {
        const state = await invoke<WorkflowState | null>("workflow_state", {
          projectDir,
          issueId,
        });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to get workflow state: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  const executeStep = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);
        setStreamOutput(""); // Clear previous output
        const result = await invoke<StepExecutionResult>(
          "workflow_execute_step",
          { projectDir, issueId }
        );
        // Refresh state after execution
        await getWorkflowState(issueId);
        return result;
      } catch (err) {
        setError(`Step execution failed: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir, getWorkflowState]
  );

  const approveGate = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setStreamOutput(""); // Clear output for next step
        const state = await invoke<WorkflowState>("workflow_advance", {
          projectDir,
          issueId,
        });
        setCurrentState(state);
        return state;
      } catch (err) {
        setError(`Failed to advance workflow: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const suggestWorkflow = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);
        const suggestion = await invoke<WorkflowSuggestion>(
          "workflow_suggest",
          { projectDir, issueId }
        );
        return suggestion;
      } catch {
        setError(`Unable to suggest workflow — please select manually`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const getDiff = useCallback(async () => {
    try {
      return await invoke<DiffFile[]>("workflow_get_diff", { projectDir });
    } catch (err) {
      setError(`Failed to get diff: ${err}`);
      return [];
    }
  }, [projectDir]);

  const clearStreamOutput = useCallback(() => {
    setStreamOutput("");
  }, []);

  return {
    workflows,
    currentState,
    loading,
    error,
    streamOutput,
    activeTicketId,
    setActiveTicketId,
    listWorkflows,
    getWorkflow,
    assignWorkflow,
    getWorkflowState,
    executeStep,
    approveGate,
    suggestWorkflow,
    getDiff,
    clearStreamOutput,
  };
}
