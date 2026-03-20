import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { clearTauriMocks } from "@/shared/test/mocks/tauri";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
import { WorkflowProvider, type WorkflowContextValue } from "@/features/workflow/context";
import type {
  Ticket,
  WorkflowDefinition,
  WorkflowState,
} from "@/shared/types";

// Mock child components to keep tests focused on the auto-execute logic
vi.mock("./stage-bar", () => ({
  StageBar: () => <div data-testid="stage-bar" />,
}));

vi.mock("./debug-panel", () => ({
  DebugPanel: () => null,
}));

vi.mock("./views/chat-view", () => ({
  ChatView: ({ isExecuting, response, stepStatus }: { isExecuting: boolean; response: string; stepStatus: string }) => (
    <div data-testid="chat-view" data-executing={isExecuting} data-response={response} data-status={stepStatus} />
  ),
}));

vi.mock("./views/review-view", () => ({
  ReviewView: () => <div data-testid="review-view" />,
}));

vi.mock("./views/progress-view", () => ({
  ProgressView: () => <div data-testid="progress-view" />,
}));

vi.mock("./views/diff-review-view", () => ({
  DiffReviewView: () => <div data-testid="diff-review-view" />,
}));

vi.mock("./views/commit-view", () => ({
  CommitView: () => <div data-testid="commit-view" />,
}));

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "ticket-1",
  title: "Test ticket",
  description: "desc",
  status: "open" as const,
  type: "task" as const,
  priority: 2,
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
  ...overrides,
});

const makeWorkflowDef = (): WorkflowDefinition => ({
  id: "wf-1",
  name: "Test Workflow",
  description: "test",
  version: "1.0",
  steps: [
    {
      id: "step-1",
      name: "Understand",
      description: "Chat step",
      instructions: { prompt: "Analyze the ticket" },
      view: "chat",
    },
  ],
});

const makeWorkflowState = (overrides: Partial<WorkflowState> = {}): WorkflowState => ({
  workflow_id: "wf-1",
  current_step_id: "step-1",
  step_status: "pending",
  step_history: [],
  ...overrides,
});

function makeWorkflowContext(overrides: Partial<WorkflowContextValue> = {}): WorkflowContextValue {
  return {
    workflows: [],
    currentState: makeWorkflowState(),
    loading: false,
    error: null,
    listenersReady: true,
    stepOutputs: {},
    activeTicketId: null,
    setActiveTicketId: vi.fn(),
    pendingPermission: null,
    respondToPermission: vi.fn(),
    notifications: [],
    clearNotification: vi.fn(),
    statusText: null,
    lastUpdatedSectionId: null,
    pendingFeedback: null,
    respondToFeedback: vi.fn(),
    setOnRefreshTicket: vi.fn(),
    listWorkflows: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn().mockResolvedValue(makeWorkflowDef()),
    assignWorkflow: vi.fn().mockResolvedValue(null),
    getWorkflowState: vi.fn().mockResolvedValue(null),
    executeStep: vi.fn().mockResolvedValue({ step_id: "step-1", response: "result", workflow_completed: false }),
    suggestWorkflow: vi.fn().mockResolvedValue(null),
    getDiff: vi.fn().mockResolvedValue([]),
    getBranchInfo: vi.fn().mockResolvedValue(null),
    executeCommitAction: vi.fn().mockResolvedValue(null),
    cleanupWorktree: vi.fn().mockResolvedValue(undefined),
    getStepOutput: vi.fn().mockReturnValue(undefined),
    reviewFindings: [],
    reviewComments: [],
    addReviewComment: vi.fn(),
    deleteReviewComment: vi.fn(),
    submitReview: vi.fn(),
    pendingReviewRequestId: null,
    ...overrides,
  };
}

describe("WorkflowShell auto-execute", () => {
  let onRefreshTicket: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTauriMocks();
    onRefreshTicket = vi.fn().mockResolvedValue(undefined);
  });

  const renderShell = (contextOverrides: Partial<WorkflowContextValue> = {}) => {
    const ctx = makeWorkflowContext(contextOverrides);
    return {
      ...render(
        <WorkflowProvider workflow={ctx}>
          <WorkflowShell
            ticket={makeTicket()}
            projectDir="/test"
            onBack={vi.fn()}
            onRefreshTicket={onRefreshTicket}
          />
        </WorkflowProvider>
      ),
      ctx,
    };
  };

  it("auto-executes when pending, not loading, and listeners ready", async () => {
    const { ctx } = renderShell();

    await waitFor(() => {
      expect(ctx.executeStep).toHaveBeenCalledWith("ticket-1");
    });
  });

  it("does NOT auto-execute when loading is true", async () => {
    const { ctx } = renderShell({ loading: true });

    // Give it time to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.executeStep).not.toHaveBeenCalled();
  });

  it("does NOT auto-execute when listenersReady is false", async () => {
    const { ctx } = renderShell({ listenersReady: false });

    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.executeStep).not.toHaveBeenCalled();
  });

  it("does NOT double-execute (executingRef guard)", async () => {
    const ctx = makeWorkflowContext();
    const { rerender } = render(
      <WorkflowProvider workflow={ctx}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    await waitFor(() => {
      expect(ctx.executeStep).toHaveBeenCalledTimes(1);
    });

    // Re-render with same props — should NOT trigger again
    rerender(
      <WorkflowProvider workflow={ctx}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.executeStep).toHaveBeenCalledTimes(1);
  });

  it("re-attempts when loading transitions from true to false while step is pending", async () => {
    const ctx = makeWorkflowContext({ loading: true });
    const { rerender } = render(
      <WorkflowProvider workflow={ctx}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    // Should not have fired while loading
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.executeStep).not.toHaveBeenCalled();

    // Now loading becomes false
    const ctx2 = makeWorkflowContext();
    rerender(
      <WorkflowProvider workflow={ctx2}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    await waitFor(() => {
      expect(ctx2.executeStep).toHaveBeenCalledWith("ticket-1");
    });
  });

  it("does NOT auto-execute when step_status is not pending", async () => {
    const { ctx } = renderShell({
      currentState: makeWorkflowState({ step_status: "in_progress" }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.executeStep).not.toHaveBeenCalled();
  });
});

describe("WorkflowShell step transition cleanup", () => {
  let onRefreshTicket: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTauriMocks();
    onRefreshTicket = vi.fn().mockResolvedValue(undefined);
  });

  it("clears lastResult when step changes so old response doesn't leak", async () => {
    const twoStepDef: WorkflowDefinition = {
      id: "wf-1",
      name: "Test",
      description: "test",
      version: "1.0",
      steps: [
        { id: "step-1", name: "Understand", description: "First", instructions: { prompt: "p1" }, view: "chat" },
        { id: "step-2", name: "Investigate", description: "Second", instructions: { prompt: "p2" }, view: "chat" },
      ],
    };

    // Start on step-1 with completed status (not pending, so auto-execute won't fire)
    const ctx1 = makeWorkflowContext({
      currentState: makeWorkflowState({ current_step_id: "step-1", step_status: "completed" }),
      getWorkflow: vi.fn().mockResolvedValue(twoStepDef),
    });
    const { rerender } = render(
      <WorkflowProvider workflow={ctx1}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    // Wait for workflow def to load
    await waitFor(() => {
      expect(screen.getByTestId("chat-view")).toBeInTheDocument();
    });

    // The ChatView mock exposes response via data-response attribute
    let chatView = screen.getByTestId("chat-view");
    // With no output and no lastResult, response should be empty
    expect(chatView.getAttribute("data-response")).toBe("");

    // Simulate step-1 completing with a result by re-rendering with step-1 output
    const ctx2 = makeWorkflowContext({
      currentState: makeWorkflowState({ current_step_id: "step-1", step_status: "completed" }),
      stepOutputs: { "step-1": { textContent: "Step 1 output", toolActivities: [], stderrLines: [], resultContent: null, thinkingContent: "", lastChunkType: "", contentBlocks: [], subagentActivities: [], filesChanged: [], activeToolName: null, activeToolStartTime: null, toolUseSummaries: [], isCompacting: false } },
      getWorkflow: vi.fn().mockResolvedValue(twoStepDef),
    });
    rerender(
      <WorkflowProvider workflow={ctx2}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    chatView = screen.getByTestId("chat-view");
    expect(chatView.getAttribute("data-response")).toBe("Step 1 output");

    // Now transition to step-2 (pending) — old output should NOT appear
    const ctx3 = makeWorkflowContext({
      currentState: makeWorkflowState({ current_step_id: "step-2", step_status: "pending" }),
      stepOutputs: { "step-1": { textContent: "Step 1 output", toolActivities: [], stderrLines: [], resultContent: null, thinkingContent: "", lastChunkType: "", contentBlocks: [], subagentActivities: [], filesChanged: [], activeToolName: null, activeToolStartTime: null, toolUseSummaries: [], isCompacting: false } },
      getWorkflow: vi.fn().mockResolvedValue(twoStepDef),
    });
    rerender(
      <WorkflowProvider workflow={ctx3}>
        <WorkflowShell
          ticket={makeTicket()}
          projectDir="/test"
          onBack={vi.fn()}
          onRefreshTicket={onRefreshTicket}
        />
      </WorkflowProvider>
    );

    chatView = screen.getByTestId("chat-view");
    // step-2 has no output yet, and lastResult was cleared
    expect(chatView.getAttribute("data-response")).toBe("");
  });
});

describe("WorkflowShell failed step display", () => {
  beforeEach(() => {
    clearTauriMocks();
  });

  const renderFailed = (reason: string) => {
    const ctx = makeWorkflowContext({
      currentState: makeWorkflowState({ step_status: { failed: reason } as unknown as WorkflowState["step_status"] }),
      getWorkflow: vi.fn().mockResolvedValue(makeWorkflowDef()),
    });
    return {
      ...render(
        <WorkflowProvider workflow={ctx}>
          <WorkflowShell
            ticket={makeTicket()}
            projectDir="/test"
            onBack={vi.fn()}
            onRefreshTicket={vi.fn().mockResolvedValue(undefined)}
          />
        </WorkflowProvider>
      ),
      ctx,
    };
  };

  it("shows Resume button for timeout failures", async () => {
    renderFailed("Agent sidecar timed out after 120 seconds of inactivity. The session can be resumed.");

    await waitFor(() => {
      expect(screen.getByText("Session interrupted — your progress is saved.")).toBeInTheDocument();
    });
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows Resume button for session-interrupted failures (app restart)", async () => {
    renderFailed("Session interrupted — click Resume to continue");

    await waitFor(() => {
      expect(screen.getByText("Session interrupted — your progress is saved.")).toBeInTheDocument();
    });
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows Retry button for non-resumable failures", async () => {
    renderFailed("Agent sidecar exited with status 1 and no output");

    await waitFor(() => {
      expect(screen.getByText(/Step failed:/)).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls onExecuteStep when Resume is clicked", async () => {
    const { ctx } = renderFailed("Session interrupted — click Resume to continue");

    await waitFor(() => {
      expect(screen.getByText("Resume")).toBeInTheDocument();
    });

    const resumeBtn = screen.getByText("Resume");
    resumeBtn.click();

    await waitFor(() => {
      expect(ctx.executeStep).toHaveBeenCalledWith("ticket-1");
    });
  });
});
