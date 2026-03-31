import type { Ticket } from "@/shared/lib/tickets/types";
import type { WorkflowDefinition, WorkflowPhase, WorkflowState } from "@/shared/types";

export type TicketPhase = WorkflowPhase | "backlog" | "done";

export function getTicketPhase(
  ticket: Ticket,
  workflowDefinitions: WorkflowDefinition[],
): TicketPhase {
  if (ticket.status === "closed") {
    return "done";
  }

  const raw = ticket.metadata.workflow;
  if (!raw || typeof raw !== "object" || !("workflow_id" in raw)) {
    return "backlog";
  }
  const workflowState = raw as WorkflowState;

  const definition = workflowDefinitions.find((w) => w.id === workflowState.workflow_id);
  if (!definition) {
    return "backlog";
  }

  if (!workflowState.current_step_id) {
    if (workflowState.step_status === "completed") {
      return "review";
    }
    return "backlog";
  }

  const step = definition.steps.find((s) => s.id === workflowState.current_step_id);
  if (!step?.phase) {
    return "backlog";
  }

  return step.phase;
}
