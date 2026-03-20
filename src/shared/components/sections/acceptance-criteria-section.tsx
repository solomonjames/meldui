import type { SectionProps } from "@/shared/components/sections/section-registry";
import type { AcceptanceCriteriaContent, AcceptanceCriterion } from "@/shared/types";

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: "\u23f3", color: "text-zinc-400" },
  passed: { icon: "\u2705", color: "text-emerald-500" },
  failed: { icon: "\u274c", color: "text-red-500" },
};

const STATUS_CYCLE: Record<string, AcceptanceCriterion["status"]> = {
  pending: "passed",
  passed: "failed",
  failed: "pending",
};

export function AcceptanceCriteriaSection({ section, onChange }: SectionProps) {
  const content = section.content as AcceptanceCriteriaContent;
  const items = content?.items ?? [];
  const passedCount = items.filter((i) => i.status === "passed").length;

  const cycleStatus = (idx: number) => {
    const updated = [...items];
    const item = updated[idx];
    updated[idx] = { ...item, status: STATUS_CYCLE[item.status] ?? "pending" };
    onChange({ items: updated });
  };

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {passedCount}/{items.length} passed
        </p>
      )}
      {items.map((item, idx) => {
        const statusInfo = STATUS_ICONS[item.status] ?? STATUS_ICONS.pending;
        return (
          <div key={item.id} className="flex gap-3">
            <button
              onClick={() => cycleStatus(idx)}
              className={`text-lg leading-none mt-0.5 shrink-0 cursor-pointer hover:opacity-70 transition-opacity ${statusInfo.color}`}
              title={`Status: ${item.status}. Click to cycle.`}
            >
              {statusInfo.icon}
            </button>
            <div className="flex-1 space-y-0.5 text-sm">
              <div>
                <span className="text-muted-foreground">Given </span>
                <span>{item.given}</span>
              </div>
              <div>
                <span className="text-muted-foreground">When </span>
                <span>{item.when}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Then </span>
                <span>{item.then}</span>
              </div>
              {item.verified_by && (
                <div className="text-xs text-muted-foreground mt-1">
                  Verified by: {item.verified_by}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No acceptance criteria defined</p>
      )}
    </div>
  );
}
