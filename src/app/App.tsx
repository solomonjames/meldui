import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";
import { TicketPage } from "@/app/ticket-page";
import { WelcomeScreen } from "@/app/welcome-screen";
import { commands, events } from "@/bindings";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { BacklogPage } from "@/features/tickets/components/backlog-page";
import { CreateTicketDialog } from "@/features/tickets/components/create-ticket-dialog";
import { useTickets } from "@/features/tickets/hooks/use-tickets";
import {
  runningTicketIds as runningTicketIdsSet,
  setRunningTicketsListener,
} from "@/features/workflow/actions/workflow-mutations";
import { fetchWorkflowState } from "@/features/workflow/actions/workflow-queries";
import { useWorkflowEventRouting } from "@/features/workflow/hooks/use-workflow-event-routing";
import { disposeTicketStores } from "@/features/workflow/stores/dispose";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import { ViewErrorFallback } from "@/shared/components/error/view-error-fallback";
import { useProjectDir } from "@/shared/hooks/use-project-dir";
import { useTheme } from "@/shared/hooks/use-theme";
import { useUpdater } from "@/shared/hooks/use-updater";
import { AppLayout } from "@/shared/layout/app-layout";
import { AppSidebar } from "@/shared/layout/app-sidebar";
import { StatusBar } from "@/shared/layout/status-bar";
import { useTauriEventInvalidation } from "@/shared/lib/invalidation";
import { queryClient } from "@/shared/lib/query-client";
import { navigationStore, useNavigationStore } from "@/shared/stores/navigation-store";
import type { Ticket, WorkflowDefinition } from "@/shared/types";

function AppContent() {
  useTheme();
  useUpdater();
  const { projectDir, folderName, loading: dirLoading, openFolderDialog } = useProjectDir();
  const ticketStore = useTickets(projectDir ?? "");
  const activePage = useNavigationStore((s) => s.activePage);
  const activeTicketId = useNavigationStore((s) => s.activeTicketId);
  const createDialogOpen = useNavigationStore((s) => s.createDialogOpen);

  // Centralized event-driven query invalidation
  useTauriEventInvalidation(projectDir ?? "");

  // ── Workflows query (was in useWorkflow) ──
  const workflowsQuery = useQuery({
    queryKey: ["workflows", "list", projectDir ?? ""],
    queryFn: () => commands.workflowList(projectDir ?? ""),
    enabled: !!projectDir,
  });
  const workflows: WorkflowDefinition[] = workflowsQuery.data ?? [];

  // ── Running tickets state (driven by action module) ──
  const [runningTicketIds, setRunningTicketIds] = useState<Set<string>>(
    () => new Set(runningTicketIdsSet),
  );
  useEffect(() => {
    setRunningTicketsListener(setRunningTicketIds);
    return () => setRunningTicketsListener(() => {});
  }, []);

  // ── Event routing (was in useWorkflow → useWorkflowEventRouting) ──
  const onRefreshTicketRef = useRef<(() => Promise<void>) | null>(null);
  const { allListenersReady } = useWorkflowEventRouting(activeTicketId, onRefreshTicketRef);

  // Update the active ticket's store when listeners are ready
  useEffect(() => {
    if (activeTicketId) {
      orchestrationStoreFactory
        .getStore(activeTicketId)
        .getState()
        .setListenersReady(allListenersReady);
    }
  }, [activeTicketId, allListenersReady]);

  // ── Idle timeout: unload ticket stores 10 min after agent session ends ──
  const unloadTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    events.agentSessionEnded
      .listen((event) => {
        if (cancelled) return;
        const { issue_id } = event.payload;
        unloadTimersRef.current[issue_id] = setTimeout(
          () => {
            disposeTicketStores(issue_id);
            delete unloadTimersRef.current[issue_id];
          },
          10 * 60 * 1000,
        );
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

    return () => {
      cancelled = true;
      unlisten?.();
      for (const timer of Object.values(unloadTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  // C keyboard shortcut to open create dialog (suppressed on ticket page)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        navigationStore.getState().activePage !== "ticket" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        navigationStore.getState().setCreateDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navigateToTicket = useCallback(
    async (ticketId: string) => {
      if (!projectDir) return;
      navigationStore.getState().navigateToTicket(ticketId);
      // Cancel any pending unload timer
      if (unloadTimersRef.current[ticketId]) {
        clearTimeout(unloadTimersRef.current[ticketId]);
        delete unloadTimersRef.current[ticketId];
      }
      await fetchWorkflowState(projectDir, ticketId);
    },
    [projectDir],
  );

  const handleStartWorkflow = useCallback(
    async (ticket: Ticket) => {
      if (!projectDir) return;
      const state = await fetchWorkflowState(projectDir, ticket.id);
      if (state) {
        navigateToTicket(ticket.id);
      }
    },
    [projectDir, navigateToTicket],
  );

  const handleNavigateToBacklog = useCallback(() => {
    navigationStore.getState().navigateToBacklog();
    ticketStore.refreshTickets();
  }, [ticketStore]);

  const handleSidebarNavigate = useCallback(
    (page: string) => {
      if (page === "backlog") {
        handleNavigateToBacklog();
      } else if (page === "settings") {
        navigationStore.getState().navigateToSettings();
      }
    },
    [handleNavigateToBacklog],
  );

  const handleTicketClick = useCallback(
    async (ticket: Ticket) => {
      await navigateToTicket(ticket.id);
    },
    [navigateToTicket],
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
          <TicketPage
            ticketId={activeTicketId}
            projectDir={projectDir}
            allTickets={ticketStore.tickets}
            workflows={workflows}
            onNavigateToBacklog={handleNavigateToBacklog}
            onUpdateTicket={ticketStore.updateTicket}
            onShowTicket={ticketStore.showTicket}
            onAddComment={ticketStore.addComment}
            onUpdateSection={ticketStore.updateSection}
            onStartWorkflow={handleStartWorkflow}
            onRefreshTickets={ticketStore.refreshTickets}
            onDeleteTicket={ticketStore.deleteTicket}
          />
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
          workflows={workflows}
          onRefresh={ticketStore.refreshTickets}
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
          workflows={workflows}
          onCreateTicket={() => navigationStore.getState().setCreateDialogOpen(true)}
          folderName={folderName}
          onOpenFolder={openFolderDialog}
          onTicketClick={handleTicketClick}
          activeTicketId={activeTicketId}
          runningTicketIds={runningTicketIds}
        />
      }
      statusBar={<StatusBar branch="main" version="v0.1.0" />}
    >
      {renderActivePage()}
      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={(open) => navigationStore.getState().setCreateDialogOpen(open)}
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
