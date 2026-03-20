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
import { TicketPage } from "@/app/ticket-page";
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
  const [activePage, setActivePage] = useState<"backlog" | "ticket" | "settings">("backlog");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeTicketId, setActiveTicketIdLocal] = useState<string | null>(null);

  // Centralized event-driven query invalidation
  useTauriEventInvalidation(projectDir ?? "");

  // C keyboard shortcut to open create dialog (suppressed on ticket page)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        activePage !== "ticket" &&
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
  }, [activePage]);

  const {
    getWorkflowState,
    suggestWorkflow: suggestWf,
    assignWorkflow: assignWf,
    setActiveTicketId: setWorkflowActiveTicketId,
  } = workflow;

  const navigateToTicket = useCallback(
    async (ticketId: string) => {
      setActiveTicketIdLocal(ticketId);
      setWorkflowActiveTicketId(ticketId);
      setActivePage("ticket");
      // Fetch workflow state so WorkflowShell renders if a workflow is active
      await getWorkflowState(ticketId);
    },
    [setWorkflowActiveTicketId, getWorkflowState]
  );

  const handleStartWorkflow = useCallback(
    async (ticket: Ticket) => {
      const state = await getWorkflowState(ticket.id);
      if (state) {
        navigateToTicket(ticket.id);
      }
    },
    [getWorkflowState, navigateToTicket]
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

      // Navigate to ticket page regardless — user can start workflow from there
      navigateToTicket(ticket.id);
    },
    [getWorkflowState, suggestWf, assignWf, navigateToTicket]
  );

  // TicketPage handles its own refresh via TanStack Query — register a stable no-op
  const noopRefresh = useCallback(async () => {}, []);
  useEffect(() => {
    workflow.setOnRefreshTicket(noopRefresh);
  }, [workflow.setOnRefreshTicket, noopRefresh]);

  const handleNavigateToBacklog = useCallback(() => {
    setActiveTicketIdLocal(null);
    setWorkflowActiveTicketId(null);
    setActivePage("backlog");
    ticketStore.refreshTickets();
  }, [ticketStore, setWorkflowActiveTicketId]);

  const handleSidebarNavigate = useCallback(
    (page: string) => {
      if (page === "backlog") {
        handleNavigateToBacklog();
      } else if (page === "settings") {
        setActivePage("settings");
      }
    },
    [handleNavigateToBacklog]
  );

  const handleTicketClick = useCallback(
    async (ticket: Ticket) => {
      await navigateToTicket(ticket.id);
    },
    [navigateToTicket]
  );

  if (dirLoading) return null;

  if (!projectDir) {
    return <WelcomeScreen onOpenFolder={openFolderDialog} />;
  }

  function renderActivePage() {
    if (activePage === "ticket" && activeTicketId) {
      return (
        <ErrorBoundary
          FallbackComponent={ViewErrorFallback}
          resetKeys={[activePage, activeTicketId]}
          onError={(error, info) =>
            console.error("[ErrorBoundary:ticket]", error, info.componentStack)
          }
        >
          <WorkflowProvider workflow={workflow}>
            <TicketPage
              ticketId={activeTicketId}
              projectDir={projectDir}
              allTickets={ticketStore.tickets}
              workflows={workflow.workflows}
              onNavigateToBacklog={handleNavigateToBacklog}
              onUpdateTicket={ticketStore.updateTicket}
              onShowTicket={ticketStore.showTicket}
              onAddComment={ticketStore.addComment}
              onUpdateSection={ticketStore.updateSection}
              onAssignWorkflow={workflow.assignWorkflow}
              onSuggestWorkflow={workflow.suggestWorkflow}
              onStartWorkflow={handleStartWorkflow}
              onRefreshTickets={ticketStore.refreshTickets}
            />
          </WorkflowProvider>
        </ErrorBoundary>
      );
    }

    if (activePage === "settings") {
      return (
        <ErrorBoundary
          FallbackComponent={ViewErrorFallback}
          resetKeys={[activePage]}
          onError={(error, info) =>
            console.error("[ErrorBoundary:settings]", error, info.componentStack)
          }
        >
          <SettingsPage projectDir={projectDir} />
        </ErrorBoundary>
      );
    }

    return (
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
          onRefresh={ticketStore.refreshTickets}
          onAutoStart={handleAutoStart}
          onCardClick={handleTicketClick}
        />
      </ErrorBoundary>
    );
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
          onTicketClick={handleTicketClick}
          activeTicketId={activeTicketId}
        />
      }
      statusBar={
        <StatusBar
          branch="main"
          version="v0.1.0"
        />
      }
    >
      {renderActivePage()}
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
