import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Hash, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { WorkflowStartPanel } from "@/app/workflow-start-panel";
import { commands } from "@/bindings";
import { TicketDetailsPanel } from "@/features/tickets/components/ticket-details-panel";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { ticketKeys } from "@/shared/lib/query-keys";
import type {
  BranchInfo,
  CommitActionResult,
  DiffFile,
  ReviewSubmission,
  StepExecutionResult,
  Ticket,
  WorkflowDefinition,
  WorkflowState,
  WorkflowSuggestion,
} from "@/shared/types";
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
  onExecuteStep: (issueId: string, userMessage?: string) => Promise<StepExecutionResult | null>;
  onGetDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  onAdvanceStep: (issueId: string) => Promise<void>;
  onGetBranchInfo: (dirOverride?: string) => Promise<BranchInfo | null>;
  onExecuteCommitAction: (
    issueId: string,
    action: "commit" | "commit_and_pr",
    commitMessage: string,
  ) => Promise<CommitActionResult | null>;
  onCleanupWorktree: (issueId: string) => Promise<void>;
  onRespondToPermission: (requestId: string, allowed: boolean) => Promise<void>;
  autoAdvance: boolean;
  onSetAutoAdvance: (enabled: boolean) => void;
  onAddReviewComment: (
    filePath: string,
    lineNumber: number,
    content: string,
    suggestion?: string,
  ) => void;
  onDeleteReviewComment: (commentId: string) => void;
  onSubmitReview: (submission: ReviewSubmission) => Promise<void>;
  onGetWorkflow: (workflowId: string) => Promise<WorkflowDefinition | null>;
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
  onExecuteStep,
  onGetDiff,
  onAdvanceStep,
  onGetBranchInfo,
  onExecuteCommitAction,
  onCleanupWorktree,
  onRespondToPermission,
  autoAdvance,
  onSetAutoAdvance,
  onAddReviewComment,
  onDeleteReviewComment,
  onSubmitReview,
  onGetWorkflow,
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

  const workflowState = orchestrationStoreFactory.useTicketStore(ticketId, (s) => s.workflowState);
  const hasActiveWorkflow = !!workflowState;
  const lastUpdatedSectionId = notificationsStoreFactory.useTicketStore(
    ticketId,
    (s) => s.lastUpdatedSectionId,
  );

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
  const workflowDef = workflowState?.workflow_id
    ? workflows.find((w) => w.id === workflowState?.workflow_id)
    : undefined;

  return (
    <div className="flex h-full bg-zinc-50 dark:bg-zinc-950 relative">
      <ResizablePanelGroup key={detailsCollapsed ? "collapsed" : "expanded"} direction="horizontal">
        {/* Left: Header + Main content */}
        <ResizablePanel defaultSize={detailsCollapsed ? 100 : 72} minSize={30}>
          <div className="flex flex-col h-full">
            {/* Page header — left panel only */}
            <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-2.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={onNavigateToBacklog}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground/70">
                <Hash className="w-2.5 h-2.5" />
                {ticket.id}
              </span>
              <h1 className="text-sm font-medium truncate text-foreground/90">{ticket.title}</h1>
            </div>

            {/* Main content area */}
            <div className="flex-1 overflow-hidden">
              {hasActiveWorkflow ? (
                <WorkflowShell
                  ticket={ticket}
                  projectDir={projectDir}
                  onNavigateToBacklog={onNavigateToBacklog}
                  onRefreshTicket={handleRefreshTicket}
                  scrollToStepRef={scrollToStepRef}
                  onExecuteStep={onExecuteStep}
                  onGetDiff={onGetDiff}
                  onAdvanceStep={onAdvanceStep}
                  onGetBranchInfo={onGetBranchInfo}
                  onExecuteCommitAction={onExecuteCommitAction}
                  onCleanupWorktree={onCleanupWorktree}
                  onRespondToPermission={onRespondToPermission}
                  autoAdvance={autoAdvance}
                  onSetAutoAdvance={onSetAutoAdvance}
                  onAddReviewComment={onAddReviewComment}
                  onDeleteReviewComment={onDeleteReviewComment}
                  onSubmitReview={onSubmitReview}
                  onGetWorkflow={onGetWorkflow}
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
          </div>
        </ResizablePanel>

        {/* Resize handle */}
        {!detailsCollapsed && <ResizableHandle withHandle />}

        {/* Right: Ticket details panel — full height */}
        {!detailsCollapsed && (
          <ResizablePanel defaultSize={28} minSize={18}>
            <TicketDetailsPanel
              ticket={ticket}
              allTickets={allTickets}
              onUpdateTicket={onUpdateTicket}
              onShowTicket={onShowTicket}
              onAddComment={onAddComment}
              onUpdateSection={handleUpdateSection}
              onDeleteTicket={onDeleteTicket}
              sectionDefs={workflowDef?.ticket_sections}
              lastUpdatedSectionId={lastUpdatedSectionId}
              isCollapsed={false}
              onToggleCollapse={() => setDetailsCollapsed(true)}
              workflowSteps={workflowDef?.steps}
              currentStepId={workflowState?.current_step_id}
              stepHistory={workflowState?.step_history}
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
            lastUpdatedSectionId={lastUpdatedSectionId}
            isCollapsed={true}
            onToggleCollapse={() => setDetailsCollapsed(false)}
            workflowSteps={workflowDef?.steps}
            currentStepId={workflowState?.current_step_id}
            stepHistory={workflowState?.step_history}
            onStepClick={() => {}}
          />
        </div>
      )}
    </div>
  );
}
