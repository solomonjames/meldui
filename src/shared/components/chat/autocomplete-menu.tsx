import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AutocompleteItem {
  name: string;
  description?: string;
  icon?: LucideIcon;
  accentColor?: string;
}

interface AutocompleteMenuProps {
  items: AutocompleteItem[];
  filter: string;
  onSelect: (item: AutocompleteItem) => void;
  _onClose?: () => void;
  _anchorRef?: React.RefObject<HTMLElement | null>;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function AutocompleteMenu({
  items,
  filter,
  onSelect,
  _onClose,
  _anchorRef,
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
}: AutocompleteMenuProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const isControlled = controlledIndex !== undefined;
  const selectedIndex = isControlled ? controlledIndex : internalIndex;
  const setSelectedIndex = isControlled
    ? (index: number) => onSelectedIndexChange?.(index)
    : setInternalIndex;

  const filtered = items.filter((item) => fuzzyMatch(item.name, filter));

  // biome-ignore lint/correctness/useExhaustiveDependencies: filter is a prop — we reset index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[280px] overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
    >
      {filtered.slice(0, 8).map((item, i) => {
        const Icon = item.icon;
        const isSelected = i === selectedIndex;
        return (
          <button
            type="button"
            key={item.name}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`flex items-center gap-2 w-full px-3 py-2 text-left text-sm ${
              isSelected ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            {Icon && (
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  item.accentColor === "purple" ? "text-purple-400" : "text-muted-foreground"
                }`}
              />
            )}
            <span
              className={`font-mono text-xs ${
                item.accentColor ? `text-${item.accentColor}-400` : "text-foreground"
              }`}
            >
              {item.name}
            </span>
            {item.description && (
              <span className="text-xs text-muted-foreground truncate">{item.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
