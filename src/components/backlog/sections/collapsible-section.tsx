import { useState, useEffect, useRef } from "react";
import { ChevronRight, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CollapsibleSectionProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultOpen?: boolean;
  isAgentGenerated?: boolean;
  children?: React.ReactNode;
}

export function CollapsibleSection({
  label,
  value,
  onChange,
  defaultOpen = false,
  isAgentGenerated = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [highlighted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setEditing(false);
    }
  };


  return (
    <div
      className={`space-y-1.5 ${isAgentGenerated ? "border-l-2 border-emerald-500/30 pl-3" : ""} ${highlighted ? "bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg transition-colors duration-1000" : ""}`}
      data-section-label={label}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 group"
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
            {label}
          </h3>
        </button>
        {isOpen && !children && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(!editing)}
          >
            {editing ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Pencil className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>

      {isOpen && (
        children ? (
          <div>{children}</div>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`No ${label.toLowerCase()}`}
          />
        ) : (
          <div
            className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm cursor-text"
            onDoubleClick={() => setEditing(true)}
          >
            {value ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {value}
                </ReactMarkdown>
              </div>
            ) : (
              <span className="text-muted-foreground">
                No {label.toLowerCase()}
              </span>
            )}
          </div>
        )
      )}
    </div>
  );
}
