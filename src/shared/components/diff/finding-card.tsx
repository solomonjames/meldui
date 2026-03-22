import { AlertCircle, AlertTriangle, Check, Info, Wrench, X } from "lucide-react";
import type { FindingAction, ReviewFinding } from "@/shared/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

interface FindingCardProps {
  finding: ReviewFinding;
  action?: FindingAction;
  onAction: (findingId: string, action: FindingAction["action"]) => void;
}

const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-900/20",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  info: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
};

const validityConfig = {
  real: { label: "Real", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  noise: { label: "Noise", color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  undecided: {
    label: "Undecided",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

export function FindingCard({ finding, action, onAction }: FindingCardProps) {
  const severity = severityConfig[finding.severity];
  const validity = validityConfig[finding.validity];
  const SeverityIcon = severity.icon;

  return (
    <div className={`rounded-lg border p-3 ${severity.bg}`}>
      <div className="flex items-start gap-2">
        <SeverityIcon className={`w-4 h-4 mt-0.5 shrink-0 ${severity.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium">{finding.id}</span>
            <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${severity.badge}`}>
              {finding.severity}
            </Badge>
            <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${validity.color}`}>
              {validity.label}
            </Badge>
          </div>
          <h4 className="text-xs font-medium mt-1">{finding.title}</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">{finding.description}</p>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
            {finding.file_path}
            {finding.line_number ? `:${finding.line_number}` : ""}
          </p>
          {finding.suggestion && (
            <div className="mt-1.5 rounded bg-zinc-100 dark:bg-zinc-800 p-1.5 font-mono text-[11px]">
              <span className="text-emerald-600 dark:text-emerald-400 font-sans text-[10px] uppercase tracking-wider">
                suggestion
              </span>
              <pre className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                {finding.suggestion}
              </pre>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 mt-2">
            {action ? (
              <span className="text-[10px] text-muted-foreground">
                {action.action === "fix"
                  ? "Requested fix"
                  : action.action === "accept"
                    ? "Accepted"
                    : "Dismissed"}
              </span>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 gap-1"
                  onClick={() => onAction(finding.id, "fix")}
                >
                  <Wrench className="w-3 h-3" /> Request Fix
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 gap-1"
                  onClick={() => onAction(finding.id, "accept")}
                >
                  <Check className="w-3 h-3" /> Accept
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 gap-1 text-muted-foreground"
                  onClick={() => onAction(finding.id, "dismiss")}
                >
                  <X className="w-3 h-3" /> Dismiss
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
