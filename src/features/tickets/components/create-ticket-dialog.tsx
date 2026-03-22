import { useState } from "react";
import { PRIORITY_CONFIG, TYPE_CONFIG } from "@/features/tickets/constants";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const SEVERITY_NAMES = ["Critical", "High", "Medium", "Low", "Minimal"] as const;

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTicket: (
    title: string,
    description?: string,
    ticketType?: string,
    priority?: string,
  ) => Promise<unknown>;
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreateTicket,
}: CreateTicketDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ticketType, setTicketType] = useState("task");
  const [priority, setPriority] = useState("2");

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await onCreateTicket(title.trim(), description.trim() || undefined, ticketType, priority);
    setTitle("");
    setDescription("");
    setTicketType("task");
    setPriority("2");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Ticket title"
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
              <span className="text-sm font-medium mb-1 block">Type</span>
              <Select
                value={ticketType}
                onValueChange={(v) => v && setTicketType(v)}
                items={Object.keys(TYPE_CONFIG).map((key) => ({
                  value: key,
                  label: key.charAt(0).toUpperCase() + key.slice(1),
                }))}
              >
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
              <span className="text-sm font-medium mb-1 block">Priority</span>
              <Select
                value={priority}
                onValueChange={(v) => v && setPriority(v)}
                items={Object.entries(PRIORITY_CONFIG).map(([key, config]) => ({
                  value: key,
                  label: `${config.label} ${SEVERITY_NAMES[Number(key)]}`,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <span className={`inline-flex items-center gap-2 ${config.color}`}>
                        {config.label}
                        <span className="text-muted-foreground font-normal">
                          {SEVERITY_NAMES[Number(key)]}
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
            Create Ticket
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
