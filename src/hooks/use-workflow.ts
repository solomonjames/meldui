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
  ContentBlock,
  SubagentActivity,
  DiffFile,
  BranchInfo,
  CommitActionResult,
  PermissionRequest,
  SectionUpdateEvent,
  NotificationEvent,
  StepCompleteEvent,
  StatusUpdateEvent,
  FeedbackRequestEvent,
  ReviewFinding,
  ReviewComment,
  ReviewSubmission,
} from "@/types";

/** Update a ToolActivity inside contentBlocks by tool_id */
function updateToolInBlocks(
  blocks: ContentBlock[],
  toolId: string,
  updater: (a: ToolActivity) => ToolActivity
): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "tool_group") return block;
    const idx = block.activities.findIndex((a) => a.tool_id === toolId);
    if (idx < 0) return block;
    const activities = [...block.activities];
    activities[idx] = updater(activities[idx]);
    return { ...block, activities };
  });
}

function emptyStepOutput(): StepOutputStream {
  return {
    textContent: "",
    toolActivities: [],
    stderrLines: [],
    resultContent: null,
    thinkingContent: "",
    lastChunkType: "",
    contentBlocks: [],
    subagentActivities: [],
    filesChanged: [],
    activeToolName: null,
    activeToolStartTime: null,
    toolUseSummaries: [],
    isCompacting: false,
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
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [pendingReviewRequestId, setPendingReviewRequestId] = useState<string | null>(null);
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
              case "text": {
                // Insert paragraph break when text resumes after tool use
                if (current.textContent && current.lastChunkType !== "text") {
                  updated.textContent = current.textContent + "\n\n" + chunk.content;
                } else {
                  updated.textContent = current.textContent + chunk.content;
                }
                // Build contentBlocks: append to last text block or create new one
                const blocks = [...current.contentBlocks];
                const lastBlock = blocks[blocks.length - 1];
                if (lastBlock && lastBlock.type === "text") {
                  blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + chunk.content };
                } else {
                  blocks.push({ type: "text", content: chunk.content });
                }
                updated.contentBlocks = blocks;
                updated.lastChunkType = "text";
                break;
              }
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
                  updated.activeToolName = tool_name;
                  updated.activeToolStartTime = Date.now();

                  // Build contentBlocks: add to current tool_group or start new one
                  const blocks = [...current.contentBlocks];
                  const lastBlock = blocks[blocks.length - 1];
                  if (lastBlock && lastBlock.type === "tool_group") {
                    blocks[blocks.length - 1] = {
                      ...lastBlock,
                      activities: [...lastBlock.activities, activity],
                    };
                  } else {
                    blocks.push({ type: "tool_group", activities: [activity] });
                  }
                  updated.contentBlocks = blocks;
                } catch {
                  // ignore malformed tool_start
                }
                updated.lastChunkType = "tool_start";
                break;
              }
              case "tool_input": {
                // Match by tool_id from sidecar NDJSON
                try {
                  const { tool_id, content: inputContent } = JSON.parse(chunk.content);
                  if (tool_id) {
                    const activities = [...current.toolActivities];
                    const idx = activities.findIndex((a) => a.tool_id === tool_id);
                    if (idx >= 0) {
                      activities[idx] = { ...activities[idx], input: activities[idx].input + inputContent };
                      updated.toolActivities = activities;
                      // Update in contentBlocks too
                      updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                        ...a, input: a.input + inputContent,
                      }));
                    }
                  }
                } catch {
                  // Fallback: append to last activity (legacy behavior)
                  if (current.toolActivities.length > 0) {
                    const activities = [...current.toolActivities];
                    const last = { ...activities[activities.length - 1] };
                    last.input = last.input + chunk.content;
                    activities[activities.length - 1] = last;
                    updated.toolActivities = activities;
                  }
                }
                break;
              }
              case "tool_end": {
                let matched = false;
                try {
                  const { tool_id } = JSON.parse(chunk.content);
                  if (tool_id) {
                    const activities = [...current.toolActivities];
                    const idx = activities.findIndex((a) => a.tool_id === tool_id);
                    if (idx >= 0) {
                      activities[idx] = { ...activities[idx], status: "complete" };
                      updated.toolActivities = activities;
                      updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                        ...a, status: "complete",
                      }));
                      matched = true;
                    }
                  }
                } catch {
                  // Fallback
                }
                if (!matched && current.toolActivities.length > 0) {
                  const activities = [...current.toolActivities];
                  const last = { ...activities[activities.length - 1] };
                  last.status = "complete";
                  activities[activities.length - 1] = last;
                  updated.toolActivities = activities;
                }
                updated.activeToolName = null;
                updated.activeToolStartTime = null;
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
                    updated.contentBlocks = updateToolInBlocks(current.contentBlocks, tool_id, (a) => ({
                      ...a, result: content, is_error, status: "complete" as const,
                    }));
                  }
                } catch {
                  // ignore malformed tool_result
                }
                updated.lastChunkType = "tool_result";
                break;
              }
              case "tool_progress": {
                try {
                  const { tool_name } = JSON.parse(chunk.content);
                  updated.activeToolName = tool_name;
                } catch {
                  // ignore
                }
                break;
              }
              case "subagent_start": {
                try {
                  const { task_id, tool_use_id, description } = JSON.parse(chunk.content);
                  const subagent: SubagentActivity = {
                    task_id,
                    tool_use_id,
                    description,
                    status: "running",
                  };
                  updated.subagentActivities = [...current.subagentActivities, subagent];
                  const blocks = [...current.contentBlocks];
                  blocks.push({ type: "subagent", activity: subagent });
                  updated.contentBlocks = blocks;
                } catch {
                  // ignore
                }
                break;
              }
              case "subagent_progress": {
                try {
                  const { task_id, summary, last_tool_name, usage } = JSON.parse(chunk.content);
                  updated.subagentActivities = current.subagentActivities.map((s) =>
                    s.task_id === task_id
                      ? { ...s, summary, last_tool_name, usage }
                      : s
                  );
                  updated.contentBlocks = current.contentBlocks.map((b) =>
                    b.type === "subagent" && b.activity.task_id === task_id
                      ? { ...b, activity: { ...b.activity, summary, last_tool_name, usage } }
                      : b
                  );
                } catch {
                  // ignore
                }
                break;
              }
              case "subagent_complete": {
                try {
                  const { task_id, status, summary, usage } = JSON.parse(chunk.content);
                  updated.subagentActivities = current.subagentActivities.map((s) =>
                    s.task_id === task_id
                      ? { ...s, status, summary, usage }
                      : s
                  );
                  updated.contentBlocks = current.contentBlocks.map((b) =>
                    b.type === "subagent" && b.activity.task_id === task_id
                      ? { ...b, activity: { ...b.activity, status, summary, usage } }
                      : b
                  );
                } catch {
                  // ignore
                }
                break;
              }
              case "files_changed": {
                try {
                  const { files } = JSON.parse(chunk.content);
                  if (Array.isArray(files)) {
                    const existing = new Set(current.filesChanged.map((f) => f.filename));
                    const newFiles = files
                      .filter((f: { filename: string }) => !existing.has(f.filename))
                      .map((f: { filename: string }) => ({ filename: f.filename }));
                    updated.filesChanged = [...current.filesChanged, ...newFiles];
                  }
                } catch {
                  // ignore
                }
                break;
              }
              case "tool_use_summary": {
                try {
                  const { summary, tool_ids } = JSON.parse(chunk.content);
                  updated.toolUseSummaries = [...current.toolUseSummaries, { summary, toolIds: tool_ids ?? [] }];
                  // Best-effort: find matching tool_group and set summaryText
                  if (Array.isArray(tool_ids) && tool_ids.length > 0) {
                    updated.contentBlocks = current.contentBlocks.map((b) => {
                      if (b.type !== "tool_group") return b;
                      const hasMatch = b.activities.some((a) => tool_ids.includes(a.tool_id));
                      return hasMatch ? { ...b, summaryText: summary } : b;
                    });
                  }
                } catch {
                  // ignore
                }
                break;
              }
              case "compacting": {
                updated.isCompacting = chunk.content === "true";
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

      const reviewUnlisten = await listen<{
        request_id: string;
        ticket_id: string;
        findings: ReviewFinding[];
        summary: string;
      }>(
        "agent-review-findings",
        (event) => {
          if (!cancelled && activeTicketId && event.payload.ticket_id === activeTicketId) {
            setReviewFindings(event.payload.findings);
            setPendingReviewRequestId(event.payload.request_id);
          }
        }
      );
      melduiUnlistens.push(reviewUnlisten);

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

        // Initialize typed sections if the workflow defines them
        if (currentState?.workflow_id) {
          const wf = workflows.find((w) => w.id === currentState.workflow_id);
          if (wf?.ticket_sections && wf.ticket_sections.length > 0) {
            try {
              await invoke("ticket_initialize_sections", {
                projectDir,
                ticketId: issueId,
                sectionDefs: wf.ticket_sections,
              });
            } catch {
              // Non-fatal — sections may already exist
            }
          }
        }

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
    [projectDir, getWorkflowState, currentState?.workflow_id, workflows]
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

  const addReviewComment = useCallback(
    (filePath: string, lineNumber: number, content: string, suggestion?: string) => {
      const comment: ReviewComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file_path: filePath,
        line_number: lineNumber,
        content,
        suggestion,
        resolved: false,
      };
      setReviewComments((prev) => [...prev, comment]);
    },
    []
  );

  const deleteReviewComment = useCallback((commentId: string) => {
    setReviewComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  const submitReview = useCallback(
    async (submission: ReviewSubmission) => {
      if (!pendingReviewRequestId) return;
      try {
        await invoke("agent_review_respond", {
          requestId: pendingReviewRequestId,
          submission,
        });
        setPendingReviewRequestId(null);

        // Mark existing comments as resolved for next round
        if (submission.action === "request_changes") {
          setReviewComments((prev) =>
            prev.map((c) => ({ ...c, resolved: true }))
          );
          setReviewFindings([]);
        } else {
          // Approved — clear all review state
          setReviewComments([]);
          setReviewFindings([]);
        }
      } catch (err) {
        setPendingReviewRequestId(null);
        const errStr = String(err);
        if (errStr.includes("Broken pipe") || errStr.includes("not available")) {
          setError("Agent session expired. Click Resume to continue where you left off.");
        } else {
          setError(`Failed to submit review: ${err}`);
        }
      }
    },
    [pendingReviewRequestId]
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

  const getDiff = useCallback(async (dirOverride?: string, baseCommit?: string) => {
    try {
      return await invoke<DiffFile[]>("workflow_get_diff", {
        projectDir: dirOverride ?? projectDir,
        baseCommit: baseCommit ?? null,
      });
    } catch (err) {
      setError(`Failed to get diff: ${err}`);
      return [];
    }
  }, [projectDir]);

  const getBranchInfo = useCallback(async (dirOverride?: string) => {
    try {
      return await invoke<BranchInfo>("workflow_get_branch_info", { projectDir: dirOverride ?? projectDir });
    } catch (err) {
      setError(`Failed to get branch info: ${err}`);
      return null;
    }
  }, [projectDir]);

  const executeCommitAction = useCallback(
    async (issueId: string, action: "commit" | "commit_and_pr", commitMessage: string) => {
      try {
        setLoading(true);
        setError(null);
        return await invoke<CommitActionResult>("workflow_execute_commit_action", {
          projectDir,
          issueId,
          action,
          commitMessage,
        });
      } catch (err) {
        setError(`Commit action failed: ${err}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectDir]
  );

  const cleanupWorktree = useCallback(
    async (issueId: string) => {
      try {
        await invoke("workflow_cleanup_worktree", { projectDir, issueId });
      } catch (err) {
        setError(`Failed to cleanup worktree: ${err}`);
      }
    },
    [projectDir]
  );

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
    getBranchInfo,
    executeCommitAction,
    cleanupWorktree,
    getStepOutput,
    reviewFindings,
    reviewComments,
    addReviewComment,
    deleteReviewComment,
    submitReview,
    pendingReviewRequestId,
  };
}
