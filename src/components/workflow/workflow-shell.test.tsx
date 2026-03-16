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
