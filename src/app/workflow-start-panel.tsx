import { useState, useCallback } from "react";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { WorkflowSelector } from "@/shared/components/workflow-selector";
import type {
  Ticket,
  WorkflowDefinition,
  WorkflowSuggestion,
  WorkflowState,
} from "@/shared/types";

interface WorkflowStartPanelProps {
  ticket: Ticket;
  workflows: WorkflowDefinition[];
  onAssignWorkflow: (issueId: string, workflowId: string) => Promise<WorkflowState | null>;
  onSuggestWorkflow: (issueId: string) => Promise<WorkflowSuggestion | null>;
  onStartWorkflow: (ticket: Ticket) => Promise<void>;
  onRefreshTickets: () => Promise<void>;
  onUpdateTicket: (
    id: string,
    updates: { status?: string }
  ) => Promise<void>;
}

export function WorkflowStartPanel({
  ticket,
  workflows,
  onAssignWorkflow,
  onSuggestWorkflow,
  onStartWorkflow,
  onRefreshTickets,
  onUpdateTicket,
}: WorkflowStartPanelProps) {
  const currentWorkflowId = (ticket.metadata?.workflow as { workflow_id?: string })?.workflow_id;
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | undefined>(currentWorkflowId);
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    if (!selectedWorkflowId) return;
    setStarting(true);
    try {
      await onAssignWorkflow(ticket.id, selectedWorkflowId);
      await onUpdateTicket(ticket.id, { status: "in_progress" });
      await onRefreshTickets();
      await onStartWorkflow(ticket);
    } finally {
      setStarting(false);
    }
  }, [ticket, selectedWorkflowId, onAssignWorkflow, onUpdateTicket, onRefreshTickets, onStartWorkflow]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Start Workflow</h2>
          <p className="text-sm text-muted-foreground">
            Select a workflow to begin working on this ticket.
          </p>
        </div>

        <WorkflowSelector
          selectedWorkflowId={selectedWorkflowId}
          workflows={workflows}
          onSelect={setSelectedWorkflowId}
          onSuggest={async () => {
            return onSuggestWorkflow(ticket.id);
          }}
        />

        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          disabled={!selectedWorkflowId || starting}
          onClick={handleStart}
        >
          {starting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Start Workflow
        </Button>
      </div>
    </div>
  );
}
