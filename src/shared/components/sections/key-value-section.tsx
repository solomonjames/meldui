import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { SectionProps } from "@/shared/components/sections/section-registry";
import type { KeyValueContent, KeyValueEntry } from "@/shared/types";

export function KeyValueSection({ section, onChange }: SectionProps) {
  const content = section.content as KeyValueContent;
  const entries = content?.entries ?? [];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const updateEntry = (idx: number, field: keyof KeyValueEntry, value: string) => {
    const updated = [...entries];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange({ entries: updated });
  };

  const addEntry = () => {
    onChange({ entries: [...entries, { key: "", value: "" }] });
    setEditingIdx(entries.length);
  };

  const removeEntry = (idx: number) => {
    onChange({ entries: entries.filter((_, i) => i !== idx) });
    setEditingIdx(null);
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-1">
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 text-sm group"
            onDoubleClick={() => setEditingIdx(idx)}
          >
            {editingIdx === idx ? (
              <>
                <input
                  className="flex-shrink-0 w-28 rounded border bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  value={entry.key}
                  onChange={(e) => updateEntry(idx, "key", e.target.value)}
                  placeholder="Key"
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingIdx(null); }}
                />
                <input
                  className="flex-1 rounded border bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  value={entry.value}
                  onChange={(e) => updateEntry(idx, "value", e.target.value)}
                  placeholder="Value"
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingIdx(null); }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-red-500"
                  onClick={() => removeEntry(idx)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground font-medium w-28 shrink-0 truncate">
                  {entry.key || "(key)"}
                </span>
                <span className="flex-1 truncate">{entry.value || "(value)"}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs text-muted-foreground"
        onClick={addEntry}
      >
        <Plus className="w-3 h-3 mr-1" />
        Add entry
      </Button>
    </div>
  );
}
