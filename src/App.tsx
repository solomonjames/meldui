import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { BacklogPage } from "@/components/backlog/backlog-page";
import { CreateTicketDialog } from "@/components/backlog/create-ticket-dialog";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { WorkflowShell } from "@/components/workflow/workflow-shell";
import { useClaude } from "@/hooks/use-claude";
import { useTickets } from "@/hooks/use-tickets";
import { useWorkflow } from "@/hooks/use-workflow";
import { useProjectDir } from "@/hooks/use-project-dir";
import type { Ticket } from "@/types";

function App() {
  const { projectDir, folderName, loading: dirLoading, openFolderDialog } = useProjectDir();
  const claude = useClaude();
  const ticketStore = useTickets(projectDir ?? "");
  const workflow = useWorkflow(projectDir ?? "");
  const [activePage, setActivePage] = useState("backlog");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeWorkflowTicket, setActiveWorkflowTicket] = useState<Ticket | null>(null);
  const [workflowDef, setWorkflowDef] = useState<Awaited<ReturnType<typeof workflow.getWorkflow>>>(null);

  useEffect(() => {
    if (!projectDir) return;
    claude.checkStatus();
    ticketStore.refreshTickets();
    workflow.listWorkflows();
  }, [projectDir]);

  // Load workflow definition when active ticket changes
  useEffect(() => {
    if (!activeWorkflowTicket || !workflow.currentState) return;
    workflow.getWorkflow(workflow.currentState.workflow_id).then(setWorkflowDef);
  }, [activeWorkflowTicket, workflow.currentState?.workflow_id]);

  // C keyboard shortcut to open create dialog (only when not in workflow view)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !activeWorkflowTicket &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        setCreateDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkflowTicket]);

  const {
    getWorkflowState,
    suggestWorkflow: suggestWf,
    assignWorkflow: assignWf,
  } = workflow;

  const { setActiveTicketId } = workflow;

  const handleStartWorkflow = useCallback(
    async (ticket: Ticket) => {
      const state = await getWorkflowState(ticket.id);
      if (state) {
        setActiveWorkflowTicket(ticket);
        setActiveTicketId(ticket.id);
        setActivePage("workflow");
      }
    },
    [getWorkflowState, setActiveTicketId]
  );

  const handleAutoStart = useCallback(
    async (ticket: Ticket) => {
      let state = await getWorkflowState(ticket.id);

      if (!state) {
        const suggestion = await suggestWf(ticket.id);
        if (suggestion) {
          await assignWf(ticket.id, suggestion.workflow_id);
          state = await getWorkflowState(ticket.id);
        }
      }

      if (state) {
        setActiveWorkflowTicket(ticket);
        setActiveTicketId(ticket.id);
        setActivePage("workflow");
      }
    },
    [getWorkflowState, suggestWf, assignWf, setActiveTicketId]
  );

  const { refreshTickets } = ticketStore;

  const handleRefreshTicket = useCallback(async () => {
    if (!activeWorkflowTicket || !projectDir) return;
    const updated = await ticketStore.showTicket(activeWorkflowTicket.id);
    if (updated) {
      setActiveWorkflowTicket(updated);
    }
  }, [activeWorkflowTicket, projectDir, ticketStore]);

  // Register the refresh callback so MeldUI MCP section_update events trigger it
  useEffect(() => {
    workflow.setOnRefreshTicket(handleRefreshTicket);
  }, [handleRefreshTicket, workflow.setOnRefreshTicket]);

  const handleBackToBoard = useCallback(() => {
    setActiveWorkflowTicket(null);
    setActiveTicketId(null);
    setActivePage("backlog");
    refreshTickets();
  }, [refreshTickets, setActiveTicketId]);

  const handleSidebarNavigate = useCallback(
    (page: string) => {
      if (page === "backlog") {
        handleBackToBoard();
      } else {
        setActivePage(page);
      }
    },
    [handleBackToBoard]
  );

  const handleSidebarTicketClick = useCallback(
    async (ticket: Ticket) => {
      const state = await getWorkflowState(ticket.id);
      if (state) {
        setActiveWorkflowTicket(ticket);
        setActiveTicketId(ticket.id);
        setActivePage("workflow");
      }
    },
    [getWorkflowState, setActiveTicketId]
  );

  if (dirLoading) return null;

  if (!projectDir) {
    return <WelcomeScreen onOpenFolder={openFolderDialog} />;
  }

  return (
    <AppLayout
      sidebar={
        <AppSidebar
          activePage={activePage}
          onNavigate={handleSidebarNavigate}
          tickets={ticketStore.tickets}
          onCreateTicket={() => setCreateDialogOpen(true)}
          folderName={folderName}
          onOpenFolder={openFolderDialog}
          onTicketClick={handleSidebarTicketClick}
          activeTicketId={activeWorkflowTicket?.id}
        />
      }
      statusBar={
        <StatusBar
          branch="main"
          version="v0.1.0"
        />
      }
    >
      {activePage === "workflow" && activeWorkflowTicket && workflow.currentState ? (
        <WorkflowShell
          ticket={activeWorkflowTicket}
          projectDir={projectDir}
          workflowState={workflow.currentState}
          workflowDefinition={workflowDef}
          stepOutputs={workflow.stepOutputs}
          loading={workflow.loading}
          error={workflow.error}
          listenersReady={workflow.listenersReady}
          pendingPermission={workflow.pendingPermission}
          onRespondToPermission={workflow.respondToPermission}
          onExecuteStep={workflow.executeStep}
          onApproveGate={workflow.approveGate}
          onGetDiff={workflow.getDiff}
          onBack={handleBackToBoard}
          onRefreshTicket={handleRefreshTicket}
          notifications={workflow.notifications}
          onClearNotification={workflow.clearNotification}
          statusText={workflow.statusText}
          approvalRequest={workflow.approvalRequest}
        />
      ) : (
        <BacklogPage
          tickets={ticketStore.tickets}
          loading={ticketStore.loading}
          error={ticketStore.error}
          onUpdateTicket={ticketStore.updateTicket}
          onCloseTicket={ticketStore.closeTicket}
          onDeleteTicket={ticketStore.deleteTicket}
          onShowTicket={ticketStore.showTicket}
          onAddComment={ticketStore.addComment}
          onRefresh={ticketStore.refreshTickets}
          onAutoStart={handleAutoStart}
          workflows={workflow.workflows}
          onAssignWorkflow={workflow.assignWorkflow}
          onSuggestWorkflow={workflow.suggestWorkflow}
          onGetWorkflowState={workflow.getWorkflowState}
          onStartWorkflow={handleStartWorkflow}
        />
      )}
      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateTicket={ticketStore.createTicket}
      />
    </AppLayout>
  );
}

export default App;
