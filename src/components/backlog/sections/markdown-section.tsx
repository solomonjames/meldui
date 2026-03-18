import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SectionProps } from "./section-registry";
import type { MarkdownContent } from "@/types";

export function MarkdownSection({ section, onChange }: SectionProps) {
  const content = section.content as MarkdownContent;
  const text = content?.text ?? "";
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(!editing)}
        >
          {editing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          value={text}
          onChange={(e) => onChange({ text: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="No content"
        />
      ) : (
        <div
          className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm cursor-text"
          onDoubleClick={() => setEditing(true)}
        >
          {text ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ) : (
            <span className="text-muted-foreground">No content</span>
          )}
        </div>
      )}
    </div>
  );
}
