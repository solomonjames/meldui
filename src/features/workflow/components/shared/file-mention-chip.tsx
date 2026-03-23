import { FileText, X } from "lucide-react";

interface FileMentionChipProps {
  path: string;
  onRemove?: () => void;
}

export function FileMentionChip({ path, onRemove }: FileMentionChipProps) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary text-xs font-mono">
      <FileText className="w-3 h-3 text-muted-foreground" />
      {path}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="hover:text-foreground text-muted-foreground"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
