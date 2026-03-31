import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/shared/test/mocks/tauri";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
import type { WorkflowContextValue } from "@/features/workflow/context";
import { WorkflowProvider } from "@/features/workflow/context";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import type { Ticket, WorkflowDefinition } from "@/shared/types";

const mockWorkflowDef: WorkflowDefinition = {
  id: "wf1",
  name: "Test Workflow",
  description: "A test workflow",
  steps: [
    { id: "s1", name: "Understand", description: "Understand the problem", view: "chat" },
    { id: "s2", name: "Implement", description: "Write code", view: "progress" },
    { id: "s3", name: "Review", description: "Review changes", view: "diff_review" },
    { id: "s4", name: "Commit", description: "Commit changes", view: "commit" },
  ],
};

function createMockWorkflow(overrides: Partial<WorkflowContextValue> = {}): WorkflowContextValue {
  return {
    workflows: [mockWorkflowDef],
    currentState: {
      workflow_id: "wf1",
      current_step_id: "s1",
      step_status: "in_progress",
      step_history: [],
    },
    loading: false,
    error: null,
    listenersReady: true,
    stepOutputs: {},
    activeTicketId: "t1",
    setActiveTicketId: vi.fn(),
    pendingPermission: null,
    respondToPermission: vi.fn(),
    notifications: [],
    clearNotification: vi.fn(),
    lastUpdatedSectionId: null,
    autoAdvance: false,
    setAutoAdvance: vi.fn(),
    advanceStep: vi.fn().mockResolvedValue(null),
    setOnRefreshTicket: vi.fn(),
    listWorkflows: vi.fn().mockResolvedValue([mockWorkflowDef]),
    getWorkflow: vi.fn().mockResolvedValue(mockWorkflowDef),
    assignWorkflow: vi.fn().mockResolvedValue(null),
    getWorkflowState: vi.fn().mockResolvedValue(null),
    executeStep: vi.fn().mockResolvedValue(null),
    suggestWorkflow: vi.fn().mockResolvedValue(null),
    getDiff: vi.fn().mockResolvedValue([]),
    getBranchInfo: vi.fn().mockResolvedValue(null),
    executeCommitAction: vi.fn().mockResolvedValue(null),
    cleanupWorktree: vi.fn().mockResolvedValue(undefined),
    getStepOutput: vi.fn().mockResolvedValue(null),
    reviewFindings: [],
    reviewComments: [],
    addReviewComment: vi.fn(),
    deleteReviewComment: vi.fn(),
    submitReview: vi.fn(),
    pendingReviewRequestId: null,
    reviewRoundKey: 0,
    ...overrides,
  };
}

const mockTicket: Ticket = {
  id: "t1",
  title: "Test Ticket",
  description: "A test ticket",
  status: "in_progress",
  priority: "medium",
  issue_type: "task",
  metadata: {},
} as Ticket;

function renderWithProviders(workflow: WorkflowContextValue = createMockWorkflow()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowProvider workflow={workflow}>
        <WorkflowShell
          ticket={mockTicket}
          projectDir="/test"
          onNavigateToBacklog={vi.fn()}
          onRefreshTicket={vi.fn().mockResolvedValue(undefined)}
        />
      </WorkflowProvider>
    </QueryClientProvider>,
  );
}

describe("WorkflowShell tabs", () => {
  beforeEach(() => {
    orchestrationStoreFactory.disposeStore("t1");
    // Populate orchestration store so WorkflowShell reads state from store
    const store = orchestrationStoreFactory.getStore("t1");
    store.getState().setWorkflowState({
      workflow_id: "wf1",
      current_step_id: "s1",
      step_status: "in_progress",
      step_history: [],
    });
    store.getState().setListenersReady(true);
  });

  it("renders Chat, Changes, and Commit tabs", async () => {
    renderWithProviders();
    // Wait for the workflow def to load (useEffect async)
    expect(await screen.findByRole("tab", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /changes/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /commit/i })).toBeInTheDocument();
  });

  it("defaults to Chat tab being active", async () => {
    renderWithProviders();
    const chatTab = await screen.findByRole("tab", { name: /chat/i });
    expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  it("renders CompactWorkflowIndicator in chat tab", async () => {
    renderWithProviders();
    // The indicator renders step dots
    expect(await screen.findByTestId("step-dot-s1")).toBeInTheDocument();
  });
});
