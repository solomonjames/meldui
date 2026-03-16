import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  WorkflowDefinition,
  WorkflowState,
  StepExecutionResult,
  WorkflowSuggestion,
  StreamChunk,
  StepOutputStream,
  ToolActivity,
  DiffFile,
  PermissionRequest,
  SectionUpdateEvent,
  NotificationEvent,
  StepCompleteEvent,
  StatusUpdateEvent,
  FeedbackRequestEvent,
} from "@/types";

function emptyStepOutput(): StepOutputStream {
  return {
    textContent: "",
    toolActivities: [],
    stderrLines: [],
    resultContent: null,
    thinkingContent: "",
    lastChunkType: "",
  };
}

export function useWorkflow(projectDir: string) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [currentState, setCurrentState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepOutputs, setStepOutputs] = useState<Record<string, StepOutputStream>>({});
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackRequestEvent | null>(null);
  const [listenersReady, setListenersReady] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const permissionUnlistenRef = useRef<UnlistenFn | null>(null);
  const melduiUnlistenRefs = useRef<UnlistenFn[]>([]);
  const currentStepRef = useRef<string | null>(null);
  // Tracks which step is actively receiving streaming output from the sidecar.
  // Unlike currentStepRef (which tracks workflow state), this only changes when
  // a new executeStep call starts — preventing late-arriving output from the
  // previous step from leaking into the next step's output.
  const executingStepRef = useRef<string | null>(null);
  const onRefreshTicketRef = useRef<(() => Promise<void>) | null>(null);
  const getWorkflowStateRef = useRef<((issueId: string) => Promise<unknown>) | null>(null);

  // Keep currentStepRef in sync
  useEffect(() => {
    currentStepRef.current = currentState?.current_step_id ?? null;
  }, [currentState?.current_step_id]);

  // Subscribe to streaming events
  useEffect(() => {
    let cancelled = false;
    setListenersReady(false);

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

          // Use executingStepRef to route output to the step that started the
          // sidecar, not the current workflow step (which may have advanced
          // after meldui_step_complete).
          const stepId = executingStepRef.current;
          if (!stepId) return;

          setStepOutputs((prev) => {
            const current = prev[stepId] ?? emptyStepOutput();
            const updated = { ...current };

            switch (chunk.chunk_type) {
              case "text":
                // Insert paragraph break when text resumes after tool use,
                // so each "turn" of agent text renders as a separate block
                if (current.textContent && current.lastChunkType !== "text") {
                  updated.textContent = current.textContent + "\n\n" + chunk.content;
                } else {
                  updated.textContent = current.textContent + chunk.content;
                }
                updated.lastChunkType = "text";
                break;
              case "tool_start": {
                try {
                  const { tool_name, tool_id } = JSON.parse(chunk.content);
                  const activity: ToolActivity = {
                    tool_id,
                    tool_name,
                    input: "",
                    status: "running",
                  };
                  updated.toolActivities = [...current.toolActivities, activity];
                } catch {
                  // ignore malformed tool_start
                }
                updated.lastChunkType = "tool_start";
                break;
              }
              case "tool_input": {
                if (current.toolActivities.length > 0) {
                  const activities = [...current.toolActivities];
                  const last = { ...activities[activities.length - 1] };
                  last.input = last.input + chunk.content;
                  activities[activities.length - 1] = last;
                  updated.toolActivities = activities;
                }
                break;
              }
              case "tool_end": {
                if (current.toolActivities.length > 0) {
                  const activities = [...current.toolActivities];
                  const last = { ...activities[activities.length - 1] };
                  last.status = "complete";
                  activities[activities.length - 1] = last;
                  updated.toolActivities = activities;
                }
                break;
              }
              case "tool_result": {
                try {
                  const { tool_id, content, is_error } = JSON.parse(chunk.content);
                  const activities = [...current.toolActivities];
                  const idx = activities.findIndex((a) => a.tool_id === tool_id);
                  if (idx >= 0) {
                    activities[idx] = { ...activities[idx], result: content, is_error, status: "complete" };
                    updated.toolActivities = activities;
                  }
                } catch {
                  // ignore malformed tool_result
                }
                updated.lastChunkType = "tool_result";
                break;
              }
              case "thinking":
                updated.thinkingContent = current.thinkingContent + chunk.content;
                break;
              case "stderr":
                updated.stderrLines = [...current.stderrLines, chunk.content];
                break;
              case "result":
                updated.resultContent = chunk.content;
                break;
              case "error":
                updated.stderrLines = [...current.stderrLines, `[error] ${chunk.content}`];
                break;
              default:
                return prev;
            }

            return { ...prev, [stepId]: updated };
          });
        }
      );

      if (!cancelled) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }

      // Listen for permission requests from the agent
      const permUnlisten = await listen<PermissionRequest>(
        "agent-permission-request",
        (event) => {
          if (!cancelled) {
            setPendingPermission(event.payload);
          }
        }
      );

      if (!cancelled) {
        permissionUnlistenRef.current = permUnlisten;
      } else {
        permUnlisten();
      }

      // Listen for MeldUI MCP events
      const melduiUnlistens: UnlistenFn[] = [];

      const sectionUnlisten = await listen<SectionUpdateEvent>(
        "meldui-section-update",
        (event) => {
          if (cancelled) return;
          // Trigger ticket refresh so the ticket context panel updates live
          if (activeTicketId && event.payload.ticket_id === activeTicketId) {
            onRefreshTicketRef.current?.();
          }
        }
      );
      melduiUnlistens.push(sectionUnlisten);

      const notifyUnlisten = await listen<NotificationEvent>(
        "meldui-notification",
        (event) => {
          if (!cancelled) {
            setNotifications((prev) => [...prev, event.payload]);
          }
        }
      );
      melduiUnlistens.push(notifyUnlisten);

      const stepCompleteUnlisten = await listen<StepCompleteEvent>(
        "meldui-step-complete",
        (event) => {
          if (cancelled) return;
          if (activeTicketId && event.payload.ticket_id === activeTicketId) {
            // Refresh workflow state — this triggers re-render and gate/advance logic
            getWorkflowStateRef.current?.(activeTicketId);
          }
        }
      );
      melduiUnlistens.push(stepCompleteUnlisten);

      const statusUnlisten = await listen<StatusUpdateEvent>(
        "meldui-status-update",
        (event) => {
          if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
            setStatusText(event.payload.status_text);
          }
        }
      );
      melduiUnlistens.push(statusUnlisten);

      const feedbackUnlisten = await listen<FeedbackRequestEvent>(
        "agent-feedback-request",
        (event) => {
          if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
            setPendingFeedback(event.payload);
          }
        }
      );
      melduiUnlistens.push(feedbackUnlisten);

      if (!cancelled) {
        melduiUnlistenRefs.current = melduiUnlistens;
        setListenersReady(true);
      } else {
        melduiUnlistens.forEach((fn) => fn());
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (permissionUnlistenRef.current) {
        permissionUnlistenRef.current();
        permissionUnlistenRef.current = null;
      }
      melduiUnlistenRefs.current.forEach((fn) => fn());
      melduiUnlistenRefs.current = [];
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

  // Keep ref in sync so event listeners can call getWorkflowState without
  // needing it in the useEffect dependency array (avoids TDZ errors)
  getWorkflowStateRef.current = getWorkflowState;

  const executeStep = useCallback(
    async (issueId: string) => {
      try {
        setLoading(true);
        setError(null);
        // Lock the executing step so streaming output goes to the right place
        executingStepRef.current = currentStepRef.current;
        // Issue 5: optimistic isExecuting update
        setCurrentState((prev) =>
          prev ? { ...prev, step_status: "in_progress" } : prev
        );
        const result = await invoke<StepExecutionResult>(
          "workflow_execute_step",
          { projectDir, issueId }
        );

        // Unlock executing step — sidecar is done
        executingStepRef.current = null;

        // Refresh state to pick up latest workflow state
        await getWorkflowState(issueId);

        return result;
      } catch (err) {
        executingStepRef.current = null;
        // Clear stale pending states — the sidecar is dead
        setPendingFeedback(null);
        setPendingPermission(null);
        setError(`Step execution failed: ${err}`);
        // Refresh state to pick up the failed status
        await getWorkflowState(issueId);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir, getWorkflowState]
  );

  const respondToFeedback = useCallback(
    async (requestId: string, approved: boolean, feedback?: string) => {
      try {
        await invoke("agent_feedback_respond", { requestId, approved, feedback });
        setPendingFeedback(null);
      } catch (err) {
        // Clear stale feedback — the sidecar is likely dead (broken pipe)
        setPendingFeedback(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to respond to feedback: ${err}`);
        }
      }
    },
    []
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

  const respondToPermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      try {
        await invoke("agent_permission_respond", { requestId, allowed });
        setPendingPermission(null);
      } catch (err) {
        setPendingPermission(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to respond to permission: ${err}`);
        }
      }
    },
    []
  );

  const getDiff = useCallback(async () => {
    try {
      return await invoke<DiffFile[]>("workflow_get_diff", { projectDir });
    } catch (err) {
      setError(`Failed to get diff: ${err}`);
      return [];
    }
  }, [projectDir]);

  const getStepOutput = useCallback(
    (stepId: string): StepOutputStream | undefined => {
      return stepOutputs[stepId];
    },
    [stepOutputs]
  );

  const clearNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setOnRefreshTicket = useCallback((fn: () => Promise<void>) => {
    onRefreshTicketRef.current = fn;
  }, []);

  return {
    workflows,
    currentState,
    loading,
    error,
    listenersReady,
    stepOutputs,
    activeTicketId,
    setActiveTicketId,
    pendingPermission,
    respondToPermission,
    notifications,
    clearNotification,
    statusText,
    pendingFeedback,
    respondToFeedback,
    setOnRefreshTicket,
    listWorkflows,
    getWorkflow,
    assignWorkflow,
    getWorkflowState,
    executeStep,
    suggestWorkflow,
    getDiff,
    getStepOutput,
  };
}
