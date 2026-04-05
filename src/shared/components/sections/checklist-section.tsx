import { Plus } from "lucide-react";
import { useState } from "react";
import type { SectionProps } from "@/shared/components/sections/section-registry";
import type { ChecklistContent, ChecklistItem } from "@/shared/types";
import { Button } from "@/shared/ui/button";

export function ChecklistSection({ section, onChange }: SectionProps) {
  const content = section.content as ChecklistContent;
  const items = content?.items ?? [];
  const [newItemText, setNewItemText] = useState("");

  const checkedCount = items.filter((i) => i.checked).length;

  const toggleItem = (idx: number) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], checked: !updated[idx].checked };
    onChange({ items: updated });
  };

  const addItem = () => {
    if (!newItemText.trim()) return;
    const newItem: ChecklistItem = {
      id: `cl-${Date.now()}`,
      text: newItemText.trim(),
      checked: false,
    };
    onChange({ items: [...items, newItem] });
    setNewItemText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {checkedCount}/{items.length}
        </p>
      )}
      <div className="space-y-1">
        {items.map((item, idx) => (
          <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer group">
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => toggleItem(idx)}
              className="rounded border-zinc-300 dark:border-zinc-600 text-emerald-500 focus:ring-emerald-500/40"
            />
            <span className={item.checked ? "line-through text-muted-foreground" : ""}>
              {item.text}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          className="flex-1 rounded border bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          aria-label="Add checklist item"
          placeholder="Add item..."
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={!newItemText.trim()}
          onClick={addItem}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
