import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Hash, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { WorkflowStartPanel } from "@/app/workflow-start-panel";
import { commands } from "@/bindings";
import { TicketDetailsPanel } from "@/features/tickets/components/ticket-details-panel";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
import { useWorkflowContext } from "@/features/workflow/context";
import { ticketKeys } from "@/shared/lib/query-keys";
import type { Ticket, WorkflowDefinition, WorkflowState, WorkflowSuggestion } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";

interface TicketPageProps {
  ticketId: string;
  projectDir: string;
  allTickets: Ticket[];
  workflows: WorkflowDefinition[];
  onNavigateToBacklog: () => void;
  onUpdateTicket: (
    id: string,
    updates: {
      status?: string;
      priority?: string;
      description?: string;
      notes?: string;
      design?: string;
      acceptance_criteria?: string;
    },
  ) => Promise<void>;
  onShowTicket: (id: string) => Promise<Ticket | null>;
  onAddComment: (id: string, text: string) => Promise<void>;
  onAssignWorkflow: (issueId: string, workflowId: string) => Promise<WorkflowState | null>;
  onSuggestWorkflow: (issueId: string) => Promise<WorkflowSuggestion | null>;
  onUpdateSection: (ticketId: string, sectionId: string, content: unknown) => Promise<void>;
  onStartWorkflow: (ticket: Ticket) => Promise<void>;
  onRefreshTickets: () => Promise<void>;
  onDeleteTicket?: (id: string) => Promise<void>;
}

export function TicketPage({
  ticketId,
  projectDir,
  allTickets,
  workflows,
  onNavigateToBacklog,
  onUpdateTicket,
  onShowTicket,
  onAddComment,
  onUpdateSection,
  onAssignWorkflow,
  onSuggestWorkflow,
  onStartWorkflow,
  onRefreshTickets,
  onDeleteTicket,
}: TicketPageProps) {
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const queryClient = useQueryClient();
  const scrollToStepRef = useRef<(stepId: string) => void>(() => {});

  // Fetch ticket by ID via TanStack Query
  const {
    data: ticket,
    isLoading,
    error,
  } = useQuery({
    queryKey: ticketKeys.detail(projectDir, ticketId),
    queryFn: () => commands.ticketShow(projectDir, ticketId),
    enabled: !!projectDir && !!ticketId,
  });

  // Workflow context (provided by WorkflowProvider in App.tsx)
  const workflowCtx = useWorkflowContext();
  const hasActiveWorkflow = !!workflowCtx.currentState;

  const handleRefreshTicket = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ticketKeys.detail(projectDir, ticketId),
    });
  }, [queryClient, projectDir, ticketId]);

  const handleUpdateSection = useCallback(
    async (tId: string, sectionId: string, content: unknown) => {
      await onUpdateSection(tId, sectionId, content);
      await handleRefreshTicket();
    },
    [onUpdateSection, handleRefreshTicket],
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading ticket...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !ticket) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {error ? `Failed to load ticket: ${error}` : "Ticket not found"}
          </p>
          <Button variant="outline" size="sm" onClick={onNavigateToBacklog}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back to Backlog
          </Button>
        </div>
      </div>
    );
  }

  // Get workflow definition for section defs
  const workflowDef = workflowCtx.currentState?.workflow_id
    ? workflows.find((w) => w.id === workflowCtx.currentState?.workflow_id)
    : undefined;

  return (
    <div className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950">
      {/* Page header */}
      <div className="px-6 py-3 border-b bg-white dark:bg-zinc-900 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onNavigateToBacklog}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-muted-foreground">
          <Hash className="w-3 h-3" />
          {ticket.id}
        </span>
        <h1 className="text-sm font-semibold truncate">{ticket.title}</h1>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden relative">
        <ResizablePanelGroup
          key={detailsCollapsed ? "collapsed" : "expanded"}
          direction="horizontal"
        >
          {/* Left: Main content area */}
          <ResizablePanel defaultSize={detailsCollapsed ? 100 : 70} minSize={30}>
            <div className="h-full overflow-hidden">
              {hasActiveWorkflow ? (
                <WorkflowShell
                  ticket={ticket}
                  projectDir={projectDir}
                  onNavigateToBacklog={onNavigateToBacklog}
                  onRefreshTicket={handleRefreshTicket}
                  scrollToStepRef={scrollToStepRef}
                />
              ) : (
                <WorkflowStartPanel
                  ticket={ticket}
                  workflows={workflows}
                  onAssignWorkflow={onAssignWorkflow}
                  onSuggestWorkflow={onSuggestWorkflow}
                  onStartWorkflow={onStartWorkflow}
                  onRefreshTickets={onRefreshTickets}
                  onUpdateTicket={onUpdateTicket}
                />
              )}
            </div>
          </ResizablePanel>

          {/* Resize handle */}
          {!detailsCollapsed && <ResizableHandle withHandle />}

          {/* Right: Ticket details panel */}
          {!detailsCollapsed && (
            <ResizablePanel defaultSize={30} minSize={15}>
              <TicketDetailsPanel
                ticket={ticket}
                allTickets={allTickets}
                onUpdateTicket={onUpdateTicket}
                onShowTicket={onShowTicket}
                onAddComment={onAddComment}
                onUpdateSection={handleUpdateSection}
                onDeleteTicket={onDeleteTicket}
                sectionDefs={workflowDef?.ticket_sections}
                lastUpdatedSectionId={workflowCtx.lastUpdatedSectionId}
                isCollapsed={false}
                onToggleCollapse={() => setDetailsCollapsed(true)}
                workflowSteps={workflowDef?.steps}
                currentStepId={workflowCtx.currentState?.current_step_id}
                stepHistory={workflowCtx.currentState?.step_history}
                onStepClick={(stepId) => scrollToStepRef.current(stepId)}
              />
            </ResizablePanel>
          )}
        </ResizablePanelGroup>

        {/* Collapsed panel toggle */}
        {detailsCollapsed && (
          <div className="absolute top-0 right-0 z-10">
            <TicketDetailsPanel
              ticket={ticket}
              allTickets={allTickets}
              onUpdateTicket={onUpdateTicket}
              onShowTicket={onShowTicket}
              onAddComment={onAddComment}
              onUpdateSection={handleUpdateSection}
              onDeleteTicket={onDeleteTicket}
              sectionDefs={workflowDef?.ticket_sections}
              lastUpdatedSectionId={workflowCtx.lastUpdatedSectionId}
              isCollapsed={true}
              onToggleCollapse={() => setDetailsCollapsed(false)}
              workflowSteps={workflowDef?.steps}
              currentStepId={workflowCtx.currentState?.current_step_id}
              stepHistory={workflowCtx.currentState?.step_history}
              onStepClick={() => {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}
