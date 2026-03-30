import { describe, expect, it } from "vitest";
import { getTicketPhase } from "@/shared/lib/tickets/phase";
import type { Ticket } from "@/shared/lib/tickets/types";
import type { WorkflowDefinition, WorkflowState } from "@/shared/types";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "test-001",
    title: "Test ticket",
    status: "open",
    priority: 2,
    ticket_type: "task",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    labels: [],
    children_ids: [],
    metadata: {},
    comments: [],
    ...overrides,
  };
}

const testWorkflow: WorkflowDefinition = {
  id: "meld-full",
  name: "MELD Full",
  description: "Test workflow",
  version: "1.0",
  steps: [
    {
      id: "spec-understand",
      name: "Spec: Understand",
      description: "",
      instructions: { prompt: "" },
      view: "chat",
      phase: "spec",
    },
    {
      id: "implement",
      name: "Implement",
      description: "",
      instructions: { prompt: "" },
      view: "progress",
      phase: "implementation",
    },
    {
      id: "verify",
      name: "Verify",
      description: "",
      instructions: { prompt: "" },
      view: "chat",
      phase: "review",
    },
  ],
};

const workflowNoPhase: WorkflowDefinition = {
  id: "no-phase",
  name: "No Phase",
  description: "Steps without phase field",
  version: "1.0",
  steps: [
    {
      id: "step-1",
      name: "Step 1",
      description: "",
      instructions: { prompt: "" },
      view: "chat",
    },
  ],
};

describe("getTicketPhase", () => {
  it("returns 'backlog' when ticket has no workflow state", () => {
    const ticket = makeTicket();
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("backlog");
  });

  it("returns step phase when workflow is active with current_step_id", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: "spec-understand",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("spec");
  });

  it("returns 'implementation' for implementation step", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: "implement",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("implementation");
  });

  it("returns 'review' when workflow completed but ticket not closed", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: null,
      step_status: "completed",
      step_history: [
        { step_id: "spec-understand", status: "completed" },
        { step_id: "implement", status: "completed" },
        { step_id: "verify", status: "completed" },
      ],
    };
    const ticket = makeTicket({
      status: "open",
      metadata: { workflow: workflowState },
    });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("review");
  });

  it("returns 'done' when ticket is closed", () => {
    const ticket = makeTicket({ status: "closed" });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("done");
  });

  it("returns 'done' when ticket is closed even with active workflow", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: "implement",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({
      status: "closed",
      metadata: { workflow: workflowState },
    });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("done");
  });

  it("returns 'backlog' when workflow assigned but not started (null step_id, pending status)", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: null,
      step_status: "pending",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("backlog");
  });

  it("returns 'backlog' when metadata.workflow is malformed", () => {
    const ticket = makeTicket({ metadata: { workflow: "not-an-object" } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("backlog");
  });

  it("returns 'backlog' when step has no phase field (graceful fallback)", () => {
    const workflowState: WorkflowState = {
      workflow_id: "no-phase",
      current_step_id: "step-1",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [workflowNoPhase])).toBe("backlog");
  });

  it("returns 'backlog' when workflow_id references unknown workflow", () => {
    const workflowState: WorkflowState = {
      workflow_id: "unknown-workflow",
      current_step_id: "step-1",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("backlog");
  });

  it("returns 'backlog' when current_step_id references unknown step", () => {
    const workflowState: WorkflowState = {
      workflow_id: "meld-full",
      current_step_id: "unknown-step",
      step_status: "in_progress",
      step_history: [],
    };
    const ticket = makeTicket({ metadata: { workflow: workflowState } });
    expect(getTicketPhase(ticket, [testWorkflow])).toBe("backlog");
  });
});
