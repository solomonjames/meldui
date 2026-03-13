import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { BacklogPage } from "@/components/backlog/backlog-page";
import { CreateTicketDialog } from "@/components/backlog/create-ticket-dialog";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { WorkflowShell } from "@/components/workflow/workflow-shell";
import { useClaude } from "@/hooks/use-claude";
import { useBeads } from "@/hooks/use-tasks";
import { useWorkflow } from "@/hooks/use-workflow";
import { useProjectDir } from "@/hooks/use-project-dir";
import type { BeadsIssue } from "@/types";

function App() {
  const { projectDir, folderName, loading: dirLoading, openFolderDialog } = useProjectDir();
  const claude = useClaude();
  const beads = useBeads(projectDir ?? "");
  const workflow = useWorkflow(projectDir ?? "");
  const [activePage, setActivePage] = useState("backlog");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeWorkflowTicket, setActiveWorkflowTicket] = useState<BeadsIssue | null>(null);
  const [workflowDef, setWorkflowDef] = useState<Awaited<ReturnType<typeof workflow.getWorkflow>>>(null);

  useEffect(() => {
    if (!projectDir) return;
    claude.checkStatus();
    beads.checkStatus().then(() => {
      beads.refreshIssues();
    });
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

  const handleStartWorkflow = useCallback(
    async (issue: BeadsIssue) => {
      const state = await getWorkflowState(issue.id);
      if (state) {
        setActiveWorkflowTicket(issue);
        setActivePage("workflow");
      }
    },
    [getWorkflowState]
  );

  const handleAutoStart = useCallback(
    async (issue: BeadsIssue) => {
      let state = await getWorkflowState(issue.id);

      if (!state) {
        const suggestion = await suggestWf(issue.id);
        if (suggestion) {
          await assignWf(issue.id, suggestion.workflow_id);
          state = await getWorkflowState(issue.id);
        }
      }

      if (state) {
        setActiveWorkflowTicket(issue);
        setActivePage("workflow");
      }
    },
    [getWorkflowState, suggestWf, assignWf]
  );

  const { refreshIssues } = beads;

  const handleBackToBoard = useCallback(() => {
    setActiveWorkflowTicket(null);
    setActivePage("backlog");
    refreshIssues();
  }, [refreshIssues]);

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
    async (issue: BeadsIssue) => {
      const state = await getWorkflowState(issue.id);
      if (state) {
        setActiveWorkflowTicket(issue);
        setActivePage("workflow");
      }
    },
    [getWorkflowState]
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
          issues={beads.issues}
          onCreateTicket={() => setCreateDialogOpen(true)}
          folderName={folderName}
          onOpenFolder={openFolderDialog}
          onTicketClick={handleSidebarTicketClick}
        />
      }
      statusBar={
        <StatusBar
          beadsConnected={beads.status?.initialized ?? false}
          branch="main"
          version="v0.1.0"
        />
      }
    >
      {activePage === "workflow" && activeWorkflowTicket && workflow.currentState ? (
        <WorkflowShell
          issue={activeWorkflowTicket}
          projectDir={projectDir}
          workflowState={workflow.currentState}
          workflowDefinition={workflowDef}
          streamOutput={workflow.streamOutput}
          loading={workflow.loading}
          error={workflow.error}
          onExecuteStep={workflow.executeStep}
          onApproveGate={workflow.approveGate}
          onGetDiff={workflow.getDiff}
          onBack={handleBackToBoard}
        />
      ) : (
        <BacklogPage
          issues={beads.issues}
          beadsStatus={beads.status}
          loading={beads.loading}
          error={beads.error}
          onUpdateIssue={beads.updateIssue}
          onCloseIssue={beads.closeIssue}
          onDeleteIssue={beads.deleteIssue}
          onShowIssue={beads.showIssue}
          onAddComment={beads.addComment}
          onRefresh={beads.refreshIssues}
          onInitBeads={beads.initBeads}
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
        onCreateIssue={beads.createIssue}
      />
    </AppLayout>
  );
}

export default App;
