import { useEffect, useState, useCallback } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/shared/lib/query-client";
import { useTauriEventInvalidation } from "@/shared/lib/invalidation";
import { AppLayout } from "@/shared/layout/app-layout";
import { AppSidebar } from "@/shared/layout/app-sidebar";
import { StatusBar } from "@/shared/layout/status-bar";
import { BacklogPage } from "@/features/tickets/components/backlog-page";
import { CreateTicketDialog } from "@/features/tickets/components/create-ticket-dialog";
import { WelcomeScreen } from "@/app/welcome-screen";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";
import { WorkflowProvider } from "@/features/workflow/context";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { useTickets } from "@/features/tickets/hooks/use-tickets";
import { useWorkflow } from "@/features/workflow/hooks/use-workflow";
import { useProjectDir } from "@/shared/hooks/use-project-dir";
import { useTheme } from "@/shared/hooks/use-theme";
import { useUpdater } from "@/shared/hooks/use-updater";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";
import { ViewErrorFallback } from "@/shared/components/error/view-error-fallback";
import type { Ticket } from "@/shared/types";

function AppContent() {
  useTheme();
  useUpdater();
  const { projectDir, folderName, loading: dirLoading, openFolderDialog } = useProjectDir();
  const ticketStore = useTickets(projectDir ?? "");
  const workflow = useWorkflow(projectDir ?? "");
  const [activePage, setActivePage] = useState("backlog");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeWorkflowTicket, setActiveWorkflowTicket] = useState<Ticket | null>(null);

  // Centralized event-driven query invalidation
  useTauriEventInvalidation(projectDir ?? "");

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
    ticketStore.refreshTickets();
  }, [ticketStore, setActiveTicketId]);

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
        <ErrorBoundary
          FallbackComponent={ViewErrorFallback}
          resetKeys={[activePage]}
          onError={(error, info) =>
            console.error("[ErrorBoundary:workflow]", error, info.componentStack)
          }
        >
          <WorkflowProvider workflow={workflow}>
            <WorkflowShell
              ticket={activeWorkflowTicket}
              projectDir={projectDir}
              onBack={handleBackToBoard}
              onRefreshTicket={handleRefreshTicket}
            />
          </WorkflowProvider>
        </ErrorBoundary>
      ) : activePage === "settings" ? (
        <ErrorBoundary
          FallbackComponent={ViewErrorFallback}
          resetKeys={[activePage]}
          onError={(error, info) =>
            console.error("[ErrorBoundary:settings]", error, info.componentStack)
          }
        >
          <SettingsPage projectDir={projectDir} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary
          FallbackComponent={ViewErrorFallback}
          resetKeys={[activePage]}
          onError={(error, info) =>
            console.error("[ErrorBoundary:backlog]", error, info.componentStack)
          }
        >
          <BacklogPage
            tickets={ticketStore.tickets}
            loading={ticketStore.isLoading}
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
        </ErrorBoundary>
      )}
      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateTicket={ticketStore.createTicket}
      />
      <Toaster position="top-right" richColors />
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
