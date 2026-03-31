import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/shared/test/mocks/tauri";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
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

const mockTicket: Ticket = {
  id: "t1",
  title: "Test Ticket",
  description: "A test ticket",
  status: "in_progress",
  priority: "medium",
  issue_type: "task",
  metadata: {},
} as Ticket;

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowShell
        ticket={mockTicket}
        projectDir="/test"
        onNavigateToBacklog={vi.fn()}
        onRefreshTicket={vi.fn().mockResolvedValue(undefined)}
        onExecuteStep={vi.fn().mockResolvedValue(null)}
        onGetDiff={vi.fn().mockResolvedValue([])}
        onAdvanceStep={vi.fn().mockResolvedValue(undefined)}
        onGetBranchInfo={vi.fn().mockResolvedValue(null)}
        onExecuteCommitAction={vi.fn().mockResolvedValue(null)}
        onCleanupWorktree={vi.fn().mockResolvedValue(undefined)}
        onRespondToPermission={vi.fn().mockResolvedValue(undefined)}
        autoAdvance={false}
        onSetAutoAdvance={vi.fn()}
        onAddReviewComment={vi.fn()}
        onDeleteReviewComment={vi.fn()}
        onSubmitReview={vi.fn().mockResolvedValue(undefined)}
        onGetWorkflow={vi.fn().mockResolvedValue(mockWorkflowDef)}
      />
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
