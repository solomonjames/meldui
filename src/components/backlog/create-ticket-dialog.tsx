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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TYPE_CONFIG, PRIORITY_CONFIG } from "./kanban-card";

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
              <Select value={issueType} onValueChange={setIssueType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_CONFIG).map(([key, config]) => {
                    const Icon = config.icon;
                    return (
                      <SelectItem key={key} value={key}>
                        <span className={`inline-flex items-center gap-2 ${config.color}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <span className={`inline-flex items-center gap-2 ${config.color}`}>
                        {config.label}
                        <span className="text-muted-foreground font-normal">
                          {["Critical", "High", "Medium", "Low", "Minimal"][Number(key)]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
