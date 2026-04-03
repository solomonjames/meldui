import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PRIORITY_CONFIG, TYPE_CONFIG } from "@/features/tickets/constants";
import { Button } from "@/shared/ui/button";
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
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

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
    <>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={() => onOpenChange(false)}
          onKeyDown={() => {}}
          role="presentation"
        />
      )}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-[380px] bg-background border-l border-border z-50 flex flex-col transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-sm font-semibold">New Ticket</h2>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 px-6 py-5 space-y-4 overflow-y-auto">
          <Input
            ref={titleRef}
            placeholder="Ticket title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[100px]"
          />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Type</span>
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
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
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
        </div>
        <div className="px-6 py-4 border-t">
          <Button
            onClick={handleSubmit}
            className="w-full bg-emerald hover:bg-emerald/90 text-white"
            disabled={!title.trim()}
          >
            Create Ticket
          </Button>
        </div>
      </div>
    </>
  );
}
