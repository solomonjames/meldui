import { FindingCard } from "@/shared/components/diff/finding-card";
import type { FindingAction, ReviewFinding } from "@/shared/types";
import { ScrollArea } from "@/shared/ui/scroll-area";

interface FindingsPanelProps {
  findings: ReviewFinding[];
  findingActions: FindingAction[];
  onFindingAction: (findingId: string, action: FindingAction["action"]) => void;
}

export function FindingsPanel({ findings, findingActions, onFindingAction }: FindingsPanelProps) {
  const critical = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  return (
    <div className="w-80 shrink-0 border-l bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Review Findings ({findings.length})
        </h3>
        <div className="flex gap-2 mt-1">
          {critical.length > 0 && (
            <span className="text-[10px] text-red-600 dark:text-red-400">
              {critical.length} critical
            </span>
          )}
          {warnings.length > 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              {warnings.length} warning
            </span>
          )}
          {infos.length > 0 && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400">
              {infos.length} info
            </span>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        {findings.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No findings yet</p>
        ) : (
          <div className="p-3 space-y-2">
            {findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                action={findingActions.find((a) => a.finding_id === finding.id)}
                onAction={onFindingAction}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
