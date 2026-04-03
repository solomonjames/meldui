interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded min-w-[24px]">
      {children}
    </kbd>
  );
}

const SHORTCUT_GROUPS = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["G", "D"], label: "Go to Dashboard" },
      { keys: ["G", "S"], label: "Go to Settings" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["C"], label: "Create Ticket" },
      { keys: ["⌘", "K"], label: "Command Palette" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: ["?"], label: "Keyboard shortcuts" },
      { keys: ["Esc"], label: "Close overlay" },
    ],
  },
];

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={() => {}}
        role="presentation"
      />
      <div className="relative bg-background border border-border rounded-lg shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
        </div>
        <div className="px-5 py-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              {group.shortcuts.map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{s.label}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
