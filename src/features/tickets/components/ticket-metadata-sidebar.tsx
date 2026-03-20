import {
  ArrowUp,
  Calendar,
  User,
  GitPullRequest,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { STATUS_CONFIG, TYPE_CONFIG, PRIORITY_CONFIG } from "@/features/tickets/constants";
import type { Ticket } from "@/shared/types";

function formatDate(dateStr?: string) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

interface TicketMetadataSidebarProps {
  ticket: Ticket;
  workflowSelector?: React.ReactNode;
  onStartWorkflow?: (ticket: Ticket) => void;
  hasWorkflowAssigned?: boolean;
}

export function TicketMetadataSidebar({
  ticket,
  workflowSelector,
  onStartWorkflow,
  hasWorkflowAssigned,
}: TicketMetadataSidebarProps) {
  const statusInfo = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
  const priorityInfo = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG[2];
  const typeInfo = TYPE_CONFIG[ticket.ticket_type] ?? TYPE_CONFIG.task;
  const TypeIcon = typeInfo.icon;

  return (
    <div className="space-y-4 text-sm">
      {/* Status */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Status</span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          {statusInfo.label}
        </span>
      </div>

      {/* Priority */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Priority</span>
        <span className={`inline-flex items-center gap-1 font-medium ${priorityInfo.color}`}>
          <ArrowUp className="w-3 h-3" />
          {priorityInfo.label}
        </span>
      </div>

      {/* Type */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Type</span>
        <span className={`inline-flex items-center gap-1 font-medium ${typeInfo.color}`}>
          <TypeIcon className="w-3 h-3" />
          {ticket.ticket_type}
        </span>
      </div>

      {/* Assignee */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Assignee</span>
        <span className="font-medium">
          {ticket.assignee || <span className="text-muted-foreground">&mdash;</span>}
        </span>
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Labels</span>
        <span className="font-medium">
          {ticket.labels && ticket.labels.length > 0 ? (
            <span className="flex flex-wrap gap-1 justify-end">
              {ticket.labels.map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs"
                >
                  {l}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          )}
        </span>
      </div>

      {/* PR URL */}
      {typeof ticket.metadata?.pr_url === "string" && (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">PR</span>
          <a
            href={ticket.metadata.pr_url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
          >
            <GitPullRequest className="w-3 h-3" />
            Pull Request
          </a>
        </div>
      )}

      {/* Divider */}
      <div className="border-t pt-3 space-y-3">
        {/* Created */}
        {ticket.created_at && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Created
            </span>
            <span>{formatDate(ticket.created_at)}</span>
          </div>
        )}

        {/* Updated */}
        {ticket.updated_at && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Updated</span>
            <span>{formatDate(ticket.updated_at)}</span>
          </div>
        )}

        {/* Created by */}
        {ticket.created_by && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <User className="w-3 h-3" />
              Created by
            </span>
            <span>{ticket.created_by}</span>
          </div>
        )}
      </div>

      {/* Workflow */}
      {workflowSelector && (
        <div className="border-t pt-3 space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workflow
          </span>
          {workflowSelector}
          {hasWorkflowAssigned && onStartWorkflow && (
            <Button
              size="sm"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => onStartWorkflow(ticket)}
            >
              Start Workflow
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
