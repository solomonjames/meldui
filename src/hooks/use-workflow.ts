import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
} from "@/types";

export function useWorkflow(projectDir: string) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [currentState, setCurrentState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return {
    workflows,
    currentState,
    loading,
    error,
    listWorkflows,
    getWorkflow,
    assignWorkflow,
    getWorkflowState,
    executeStep,
    approveGate,
  };
}
