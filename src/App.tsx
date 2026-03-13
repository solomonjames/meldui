import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { BacklogPage } from "@/components/backlog/backlog-page";
import { CreateTicketDialog } from "@/components/backlog/create-ticket-dialog";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { useClaude } from "@/hooks/use-claude";
import { useBeads } from "@/hooks/use-tasks";
import { useProjectDir } from "@/hooks/use-project-dir";

function App() {
  const { projectDir, folderName, loading: dirLoading, openFolderDialog } = useProjectDir();
  const claude = useClaude();
  const beads = useBeads(projectDir ?? "");
  const [activePage, setActivePage] = useState("backlog");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!projectDir) return;
    claude.checkStatus();
    beads.checkStatus().then(() => {
      beads.refreshIssues();
    });
  }, [projectDir]);

  // C keyboard shortcut to open create dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
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
  }, []);

  if (dirLoading) return null;

  if (!projectDir) {
    return <WelcomeScreen onOpenFolder={openFolderDialog} />;
  }

  return (
    <AppLayout
      sidebar={
        <AppSidebar
          activePage={activePage}
          onNavigate={setActivePage}
          issues={beads.issues}
          onCreateTicket={() => setCreateDialogOpen(true)}
          folderName={folderName}
          onOpenFolder={openFolderDialog}
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
      {activePage === "backlog" && (
        <BacklogPage
          issues={beads.issues}
          beadsStatus={beads.status}
          loading={beads.loading}
          error={beads.error}
          onUpdateIssue={beads.updateIssue}
          onCloseIssue={beads.closeIssue}
          onRefresh={beads.refreshIssues}
          onInitBeads={beads.initBeads}
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
