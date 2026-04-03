import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/shared/ui/button";

interface EditableMarkdownFieldProps {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export function EditableMarkdownField({
  value,
  onSave,
  placeholder = "No content",
  minHeight = "200px",
}: EditableMarkdownFieldProps) {
  const [editing, setEditing] = useState(false);
  // In edit mode: controlled by localValue (independent of prop)
  // In view mode: controlled by viewOverride (if set) or value prop
  const [localValue, setLocalValue] = useState(value);
  const [viewOverride, setViewOverride] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  // Clear viewOverride once the prop catches up
  if (viewOverride !== null && value === viewOverride) {
    setViewOverride(null);
  }

  const enterEditing = () => {
    setLocalValue(viewOverride ?? value);
    setEditing(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    onSave(newValue);
  };

  const exitEditing = () => {
    // Preserve the last edit so markdown view doesn't flash stale content
    setViewOverride(localValue);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          style={{ minHeight }}
          value={localValue}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Escape") exitEditing();
          }}
          placeholder={placeholder}
        />
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={exitEditing}
          >
            <Check className="w-3.5 h-3.5" />
            Done
          </Button>
        </div>
      </div>
    );
  }

  const displayValue = viewOverride ?? value;

  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive div with complex content
    <div
      role="button"
      tabIndex={0}
      aria-label="Click to edit"
      className="cursor-pointer rounded-lg p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      onClick={enterEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") enterEditing();
      }}
    >
      {displayValue ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayValue}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">{placeholder}</p>
      )}
    </div>
  );
}
