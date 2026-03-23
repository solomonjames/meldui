import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePen,
  FilePlus,
  type FileText,
  FileX,
  GitBranch,
  GitCommit,
  Loader2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BranchInfo, CommitActionResult, DiffFile, Ticket } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Textarea } from "@/shared/ui/textarea";

interface CommitTabProps {
  ticket: Ticket;
  agentCommitMessage?: string | null;
  onNavigateToBacklog: () => void;
  onGetDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  onGetBranchInfo: (dirOverride?: string) => Promise<BranchInfo | null>;
  onExecuteCommitAction: (
    issueId: string,
    action: "commit" | "commit_and_pr",
    commitMessage: string,
  ) => Promise<CommitActionResult | null>;
  onCleanupWorktree: (issueId: string) => Promise<void>;
  onRefreshTicket: () => Promise<void>;
}

type ActionState =
  | { status: "idle" }
  | { status: "loading"; action: "commit" | "commit_and_pr" }
  | { status: "success"; result: CommitActionResult }
  | { status: "error"; message: string };

const FILE_STATUS_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> =
  {
    added: { icon: FilePlus, label: "Added", color: "text-emerald-600" },
    removed: { icon: FileX, label: "Removed", color: "text-red-500" },
    modified: { icon: FilePen, label: "Modified", color: "text-amber-500" },
  };

export function CommitTab({
  ticket,
  agentCommitMessage,
  onNavigateToBacklog,
  onGetDiff,
  onGetBranchInfo,
  onExecuteCommitAction,
  onCleanupWorktree,
  onRefreshTicket,
}: CommitTabProps) {
  const fallbackMessage = `feat: ${ticket.title.toLowerCase()}`;
  const [userOverride, setUserOverride] = useState<string | null>(null);
  const commitMessage = userOverride ?? (agentCommitMessage || fallbackMessage);

  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState<boolean | null>(null);
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  const [cleanedUp, setCleanedUp] = useState(false);

  const worktreePath = ticket.metadata?.worktree_path as string | undefined;
  const worktreeBaseCommit = ticket.metadata?.worktree_base_commit as string | undefined;

  useEffect(() => {
    onGetDiff(worktreePath, worktreeBaseCommit).then((files) => {
      setDiffFiles(files);
      setFilesExpanded((prev) => prev ?? (files.length > 0 && files.length <= 10));
    });
    onGetBranchInfo(worktreePath).then(setBranchInfo);
  }, [onGetDiff, onGetBranchInfo, worktreePath, worktreeBaseCommit]);

  const totalAdditions = diffFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = diffFiles.reduce((sum, f) => sum + f.deletions, 0);
  const hasChanges = diffFiles.length > 0;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(commitMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [commitMessage]);

  const handleCommitAction = useCallback(
    async (action: "commit" | "commit_and_pr") => {
      setActionState({ status: "loading", action });
      try {
        const result = await onExecuteCommitAction(ticket.id, action, commitMessage);
        if (result) {
          setActionState({ status: "success", result });
          await onRefreshTicket();
        } else {
          setActionState({ status: "error", message: "Action failed — no response from agent" });
        }
      } catch (err) {
        setActionState({ status: "error", message: String(err) });
      }
    },
    [ticket.id, commitMessage, onExecuteCommitAction, onRefreshTicket],
  );

  const handleCleanupWorktree = useCallback(async () => {
    await onCleanupWorktree(ticket.id);
    setCleanedUp(true);
  }, [ticket.id, onCleanupWorktree]);

  const isLoading = actionState.status === "loading";
  const hasWorktree = !!worktreePath;

  if (diffFiles.length === 0 && actionState.status === "idle" && !isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Nothing to commit
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitCommit className="h-5 w-5 text-emerald-500" />
            <div>
              <h3 className="text-sm font-semibold">Commit & Complete</h3>
              <p className="text-xs text-muted-foreground">{ticket.title}</p>
            </div>
          </div>
          {branchInfo && (
            <div className="flex items-center gap-2 text-xs">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono font-medium">{branchInfo.branch}</span>
              {branchInfo.remote_tracking && (
                <span className="text-muted-foreground">&rarr; {branchInfo.remote_tracking}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-3 gap-0 overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-900">
            <StatCard label="Files Changed" value={String(diffFiles.length)} />
            <StatCard
              label="Lines Added"
              value={`+${totalAdditions}`}
              valueColor="text-emerald-500"
              bordered
            />
            <StatCard
              label="Lines Removed"
              value={`-${totalDeletions}`}
              valueColor="text-red-500"
              bordered
            />
          </div>

          {/* Commit Message */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Commit Message
              </h4>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-900">
              <Textarea
                value={commitMessage}
                onChange={(e) => setUserOverride(e.target.value)}
                className="min-h-[120px] resize-y border-0 font-mono text-sm shadow-none focus-visible:ring-0"
                placeholder="feat: describe your changes..."
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              [ai-generated] — edit before committing
            </p>
          </div>

          {/* File List */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFilesExpanded((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {filesExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {diffFiles.length > 0
                ? `${diffFiles.length} file${diffFiles.length !== 1 ? "s" : ""} changed`
                : "No changes detected"}
            </button>
            {filesExpanded && diffFiles.length > 0 && (
              <div className="divide-y rounded-lg border bg-white shadow-sm dark:bg-zinc-900">
                {diffFiles.map((file) => {
                  const config = FILE_STATUS_CONFIG[file.status] ?? FILE_STATUS_CONFIG.modified;
                  const Icon = config.icon;
                  return (
                    <div
                      key={file.path}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                        <span className="truncate font-mono">{file.path}</span>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        {file.additions > 0 && (
                          <span className="font-mono text-emerald-600">+{file.additions}</span>
                        )}
                        {file.deletions > 0 && (
                          <span className="font-mono text-red-500">-{file.deletions}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Success State */}
          {actionState.status === "success" && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {actionState.result.pr_url ? "Pull request created" : "Changes committed"}
              </p>
              {actionState.result.commit_hash && (
                <p className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                  Commit: {actionState.result.commit_hash}
                </p>
              )}
              {actionState.result.pr_url && (
                <a
                  href={actionState.result.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  {actionState.result.pr_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {hasWorktree && !cleanedUp && (
                <div className="border-t border-emerald-200 pt-2 dark:border-emerald-800">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCleanupWorktree}
                    className="text-xs"
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" />
                    Clean up worktree
                  </Button>
                </div>
              )}
              {cleanedUp && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Worktree cleaned up
                </p>
              )}
            </div>
          )}

          {/* Error State */}
          {actionState.status === "error" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-sm text-red-700 dark:text-red-300">{actionState.message}</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center justify-between border-t bg-white px-6 py-4 dark:bg-zinc-900">
        <Button variant="outline" size="sm" onClick={onNavigateToBacklog}>
          Back to Board
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasChanges || isLoading}
            onClick={() => handleCommitAction("commit")}
          >
            {actionState.status === "loading" && actionState.action === "commit" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitCommit className="mr-1.5 h-3.5 w-3.5" />
            )}
            Commit Only
          </Button>
          <Button
            size="sm"
            disabled={!hasChanges || isLoading}
            onClick={() => handleCommitAction("commit_and_pr")}
            className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            {actionState.status === "loading" && actionState.action === "commit_and_pr" && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Create Pull Request
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  bordered,
}: {
  label: string;
  value: string;
  valueColor?: string;
  bordered?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 px-6 py-5 ${bordered ? "border-l" : ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-bold ${valueColor ?? ""}`}>{value}</span>
    </div>
  );
}
