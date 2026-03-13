import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateIssue: (
    title: string,
    description?: string,
    issueType?: string,
    priority?: string
  ) => Promise<unknown>;
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreateIssue,
}: CreateTicketDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("task");
  const [priority, setPriority] = useState("2");

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await onCreateIssue(title.trim(), description.trim() || undefined, issueType, priority);
    setTitle("");
    setDescription("");
    setIssueType("task");
    setPriority("2");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            className="w-full bg-emerald hover:bg-emerald/90 text-white"
            disabled={!title.trim()}
          >
            Create Issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
