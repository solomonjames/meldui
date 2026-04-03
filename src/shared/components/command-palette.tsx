import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  icon: typeof Search;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback(
    (index: number) => {
      const cmd = filtered[index];
      if (cmd) {
        onClose();
        cmd.action();
      }
    },
    [filtered, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        execute(selectedIndex);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered.length, selectedIndex, execute, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={() => {}}
        role="presentation"
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav container */}
      <div
        className="relative bg-background border border-border rounded-lg shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 px-3 border-b">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No commands found</p>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  type="button"
                  key={cmd.id}
                  onClick={() => execute(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  }`}
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1">{cmd.label}</span>
                  {cmd.shortcut && (
                    <span className="text-xs text-muted-foreground font-mono">{cmd.shortcut}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
