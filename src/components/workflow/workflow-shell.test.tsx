import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { clearTauriMocks, mockInvoke } from "@/test/mocks/tauri";
import { WorkflowShell } from "./workflow-shell";
import type {
  Ticket,
  WorkflowDefinition,
  WorkflowState,
  StepOutputStream,
} from "@/types";

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

describe("WorkflowShell auto-execute", () => {
  let onExecuteStep: ReturnType<typeof vi.fn>;
  let onGetDiff: ReturnType<typeof vi.fn>;
  let onBack: ReturnType<typeof vi.fn>;
  let onRespondToPermission: ReturnType<typeof vi.fn>;
  let onRefreshTicket: ReturnType<typeof vi.fn>;
  let onClearNotification: ReturnType<typeof vi.fn>;
  let onRespondToFeedback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTauriMocks();
    onExecuteStep = vi.fn().mockResolvedValue({
      step_id: "step-1",
      response: "result",
      workflow_completed: false,
    });
    onGetDiff = vi.fn().mockResolvedValue([]);
    onBack = vi.fn();
    onRespondToPermission = vi.fn();
    onRefreshTicket = vi.fn().mockResolvedValue(undefined);
    onClearNotification = vi.fn();
    onRespondToFeedback = vi.fn();
  });

  const defaultProps = () => ({
    ticket: makeTicket(),
    projectDir: "/test",
    workflowState: makeWorkflowState(),
    workflowDefinition: makeWorkflowDef(),
    stepOutputs: {} as Record<string, StepOutputStream>,
    loading: false,
    error: null,
    listenersReady: true,
    pendingPermission: null,
    onRespondToPermission,
    onExecuteStep,
    onGetDiff,
    onBack,
    onRefreshTicket,
    notifications: [],
    onClearNotification,
    statusText: null,
    pendingFeedback: null,
    onRespondToFeedback,
    reviewFindings: [],
    reviewComments: [],
    onAddReviewComment: vi.fn(),
    onDeleteReviewComment: vi.fn(),
    onSubmitReview: vi.fn(),
    reviewDisabled: true,
  });

  const renderShell = (overrides: {
    loading?: boolean;
    listenersReady?: boolean;
    workflowState?: WorkflowState;
    stepOutputs?: Record<string, StepOutputStream>;
  } = {}) =>
    render(
      <WorkflowShell
        {...defaultProps()}
        {...overrides}
      />
    );

  it("auto-executes when pending, not loading, and listeners ready", async () => {
    renderShell();

    await waitFor(() => {
      expect(onExecuteStep).toHaveBeenCalledWith("ticket-1");
    });
  });

  it("does NOT auto-execute when loading is true", async () => {
    renderShell({ loading: true });

    // Give it time to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecuteStep).not.toHaveBeenCalled();
  });

  it("does NOT auto-execute when listenersReady is false", async () => {
    renderShell({ listenersReady: false });

    await new Promise((r) => setTimeout(r, 50));
    expect(onExecuteStep).not.toHaveBeenCalled();
  });

  it("does NOT double-execute (executingRef guard)", async () => {
    const { rerender } = render(
      <WorkflowShell {...defaultProps()} />
    );

    await waitFor(() => {
      expect(onExecuteStep).toHaveBeenCalledTimes(1);
    });

    // Re-render with same props — should NOT trigger again
    rerender(
      <WorkflowShell {...defaultProps()} />
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(onExecuteStep).toHaveBeenCalledTimes(1);
  });

  it("re-attempts when loading transitions from true to false while step is pending", async () => {
    const { rerender } = render(
      <WorkflowShell {...defaultProps()} loading={true} />
    );

    // Should not have fired while loading
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecuteStep).not.toHaveBeenCalled();

    // Now loading becomes false
    rerender(
      <WorkflowShell {...defaultProps()} />
    );

    await waitFor(() => {
      expect(onExecuteStep).toHaveBeenCalledWith("ticket-1");
    });
  });

  it("does NOT auto-execute when step_status is not pending", async () => {
    renderShell({
      workflowState: makeWorkflowState({ step_status: "in_progress" }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(onExecuteStep).not.toHaveBeenCalled();
  });
});

describe("WorkflowShell step transition cleanup", () => {
  let onExecuteStep: ReturnType<typeof vi.fn>;
  let onRefreshTicket: ReturnType<typeof vi.fn>;
  let onRespondToFeedback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTauriMocks();
    onExecuteStep = vi.fn().mockResolvedValue({
      step_id: "step-1",
      response: "result from step 1",
      workflow_completed: false,
    });
    onRefreshTicket = vi.fn().mockResolvedValue(undefined);
    onRespondToFeedback = vi.fn();
  });

  const twoStepDef = (): WorkflowDefinition => ({
    id: "wf-1",
    name: "Test",
    description: "test",
    version: "1.0",
    steps: [
      { id: "step-1", name: "Understand", description: "First", instructions: { prompt: "p1" }, view: "chat" },
      { id: "step-2", name: "Investigate", description: "Second", instructions: { prompt: "p2" }, view: "chat" },
    ],
  });

  const baseProps = () => ({
    ticket: makeTicket(),
    projectDir: "/test",
    workflowDefinition: twoStepDef(),
    stepOutputs: {} as Record<string, StepOutputStream>,
    loading: false,
    error: null,
    listenersReady: true,
    pendingPermission: null,
    onRespondToPermission: vi.fn(),
    onExecuteStep,
    onGetDiff: vi.fn().mockResolvedValue([]),
    onBack: vi.fn(),
    onRefreshTicket,
    notifications: [],
    onClearNotification: vi.fn(),
    statusText: null,
    pendingFeedback: null,
    onRespondToFeedback,
    reviewFindings: [],
    reviewComments: [],
    onAddReviewComment: vi.fn(),
    onDeleteReviewComment: vi.fn(),
    onSubmitReview: vi.fn(),
    reviewDisabled: true,
  });

  it("clears lastResult when step changes so old response doesn't leak", async () => {
    // Start on step-1 with completed status (not pending, so auto-execute won't fire)
    const { rerender } = render(
      <WorkflowShell
        {...baseProps()}
        workflowState={makeWorkflowState({ current_step_id: "step-1", step_status: "completed" })}
      />
    );

    // The ChatView mock exposes response via data-response attribute
    let chatView = screen.getByTestId("chat-view");
    // With no output and no lastResult, response should be empty
    expect(chatView.getAttribute("data-response")).toBe("");

    // Simulate step-1 completing with a result by re-rendering with step-1 output
    rerender(
      <WorkflowShell
        {...baseProps()}
        workflowState={makeWorkflowState({ current_step_id: "step-1", step_status: "completed" })}
        stepOutputs={{ "step-1": { textContent: "Step 1 output", toolActivities: [], stderrLines: [], resultContent: null, thinkingContent: "", lastChunkType: "" } }}
      />
    );

    chatView = screen.getByTestId("chat-view");
    expect(chatView.getAttribute("data-response")).toBe("Step 1 output");

    // Now transition to step-2 (pending) — old output should NOT appear
    rerender(
      <WorkflowShell
        {...baseProps()}
        workflowState={makeWorkflowState({ current_step_id: "step-2", step_status: "pending" })}
        stepOutputs={{ "step-1": { textContent: "Step 1 output", toolActivities: [], stderrLines: [], resultContent: null, thinkingContent: "", lastChunkType: "" } }}
      />
    );

    chatView = screen.getByTestId("chat-view");
    // step-2 has no output yet, and lastResult was cleared
    expect(chatView.getAttribute("data-response")).toBe("");
  });
});

describe("WorkflowShell failed step display", () => {
  let onExecuteStep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTauriMocks();
    onExecuteStep = vi.fn().mockResolvedValue({
      step_id: "step-1",
      response: "",
      workflow_completed: false,
    });
  });

  const failedProps = (reason: string) => ({
    ticket: makeTicket(),
    projectDir: "/test",
    workflowState: makeWorkflowState({ step_status: { failed: reason } as unknown as WorkflowState["step_status"] }),
    workflowDefinition: makeWorkflowDef(),
    stepOutputs: {} as Record<string, StepOutputStream>,
    loading: false,
    error: null,
    listenersReady: true,
    pendingPermission: null,
    onRespondToPermission: vi.fn(),
    onExecuteStep,
    onGetDiff: vi.fn().mockResolvedValue([]),
    onBack: vi.fn(),
    onRefreshTicket: vi.fn().mockResolvedValue(undefined),
    notifications: [],
    onClearNotification: vi.fn(),
    statusText: null,
    pendingFeedback: null,
    onRespondToFeedback: vi.fn(),
    reviewFindings: [],
    reviewComments: [],
    onAddReviewComment: vi.fn(),
    onDeleteReviewComment: vi.fn(),
    onSubmitReview: vi.fn(),
    reviewDisabled: true,
  });

  it("shows Resume button for timeout failures", () => {
    render(
      <WorkflowShell
        {...failedProps("Agent sidecar timed out after 120 seconds of inactivity. The session can be resumed.")}
      />
    );

    expect(screen.getByText("Session interrupted — your progress is saved.")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows Resume button for session-interrupted failures (app restart)", () => {
    render(
      <WorkflowShell
        {...failedProps("Session interrupted — click Resume to continue")}
      />
    );

    expect(screen.getByText("Session interrupted — your progress is saved.")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows Retry button for non-resumable failures", () => {
    render(
      <WorkflowShell
        {...failedProps("Agent sidecar exited with status 1 and no output")}
      />
    );

    expect(screen.getByText(/Step failed:/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls onExecuteStep when Resume is clicked", async () => {
    render(
      <WorkflowShell
        {...failedProps("Session interrupted — click Resume to continue")}
      />
    );

    const resumeBtn = screen.getByText("Resume");
    resumeBtn.click();

    await waitFor(() => {
      expect(onExecuteStep).toHaveBeenCalledWith("ticket-1");
    });
  });
});
