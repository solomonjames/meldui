import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { BeadsIssue, BeadsStatus } from "@/types";

interface TaskBoardProps {
  issues: BeadsIssue[];
  beadsStatus: BeadsStatus | null;
  loading: boolean;
  error: string | null;
  onCreateIssue: (
    title: string,
    description?: string,
    issueType?: string,
    priority?: string
  ) => Promise<BeadsIssue | null>;
  onUpdateIssue: (
    id: string,
    updates: {
      title?: string;
      status?: string;
      priority?: string;
      description?: string;
    }
  ) => Promise<void>;
  onCloseIssue: (id: string, reason?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onInitBeads: () => Promise<void>;
}

const STATUS_COLUMNS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "closed", label: "Closed" },
];

const TYPE_COLORS: Record<string, string> = {
  feature: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  bug: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  task: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  chore:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  epic: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: {
    label: "P0",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  1: {
    label: "P1",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  2: {
    label: "P2",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  3: {
    label: "P3",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  4: {
    label: "P4",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  },
};

function AddTaskDialog({
  onAdd,
}: {
  onAdd: (
    title: string,
    description: string,
    issueType: string,
    priority: string
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("task");
  const [priority, setPriority] = useState("2");

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), description.trim(), issueType, priority);
    setTitle("");
    setDescription("");
    setIssueType("task");
    setPriority("2");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button size="sm">+ Add Issue</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Issue title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Type</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
              >
                <option value="task">Task</option>
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="chore">Chore</option>
                <option value="epic">Epic</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Priority</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="0">P0 - Critical</option>
                <option value="1">P1 - High</option>
                <option value="2">P2 - Medium</option>
                <option value="3">P3 - Low</option>
                <option value="4">P4 - Minimal</option>
              </select>
            </div>
          </div>
          <Button
            onClick={handleSubmit}
            className="w-full"
            disabled={!title.trim()}
          >
            Create Issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueCard({
  issue,
  onUpdate,
  onClose,
}: {
  issue: BeadsIssue;
  onUpdate: (
    id: string,
    updates: { status?: string; priority?: string }
  ) => Promise<void>;
  onClose: (id: string) => Promise<void>;
}) {
  const priorityInfo = PRIORITY_LABELS[issue.priority] ?? PRIORITY_LABELS[2];

  const nextStatus: Record<string, string | null> = {
    open: "in_progress",
    in_progress: null, // use close
    blocked: "in_progress",
    closed: null,
  };

  return (
    <Card className="mb-2">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {issue.id}
            </span>
            <h4 className="text-sm font-medium leading-tight">{issue.title}</h4>
          </div>
        </div>
        {issue.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {issue.description}
          </p>
        )}
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[issue.issue_type] ?? TYPE_COLORS.task}`}
          >
            {issue.issue_type}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${priorityInfo.color}`}
          >
            {priorityInfo.label}
          </Badge>
          {issue.assignee && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {issue.assignee}
            </Badge>
          )}
          <div className="ml-auto flex gap-1">
            {nextStatus[issue.status] && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={() =>
                  onUpdate(issue.id, {
                    status: nextStatus[issue.status]!,
                  })
                }
              >
                → {nextStatus[issue.status]?.replace("_", " ")}
              </Button>
            )}
            {issue.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={() => onClose(issue.id)}
              >
                → close
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskBoard({
  issues,
  beadsStatus,
  loading,
  error,
  onCreateIssue,
  onUpdateIssue,
  onCloseIssue,
  onRefresh,
  onInitBeads,
}: TaskBoardProps) {
  if (!beadsStatus?.installed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <h3 className="text-lg font-medium">Beads Not Found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          MeldUI uses Beads for issue tracking. Install it from{" "}
          <span className="font-mono text-primary">
            github.com/steveyegge/beads
          </span>
        </p>
      </div>
    );
  }

  if (!beadsStatus?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <h3 className="text-lg font-medium">Beads Not Initialized</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Initialize beads in this project to start tracking issues.
        </p>
        <Button onClick={onInitBeads}>Initialize Beads</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Issues</h2>
          <Badge variant="secondary" className="text-xs">
            beads
          </Badge>
          {loading && (
            <span className="text-xs text-muted-foreground">Loading...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          <AddTaskDialog
            onAdd={(title, description, issueType, priority) =>
              onCreateIssue(title, description, issueType, priority)
            }
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-4 gap-0 h-full">
          {STATUS_COLUMNS.map((col) => {
            const columnIssues = issues.filter((i) => i.status === col.key);
            return (
              <div
                key={col.key}
                className="border-r last:border-r-0 flex flex-col"
              >
                <div className="px-3 py-2 border-b bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {col.label}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {columnIssues.length}
                    </Badge>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-2">
                  {columnIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onUpdate={onUpdateIssue}
                      onClose={onCloseIssue}
                    />
                  ))}
                </ScrollArea>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
