interface StatusBarProps {
  branch?: string;
  version?: string;
}

export function StatusBar({ branch, version }: StatusBarProps) {
  return (
    <div className="h-8 flex items-center px-4 border-t bg-white dark:bg-zinc-900 text-xs text-muted-foreground shrink-0">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald" />
        <span>idle</span>
        {branch && (
          <>
            <span className="text-zinc-300 dark:text-zinc-600">|</span>
            <span className="font-mono">{branch}</span>
          </>
        )}
      </div>
      <div className="ml-auto">{version && <span className="font-mono">{version}</span>}</div>
    </div>
  );
}
