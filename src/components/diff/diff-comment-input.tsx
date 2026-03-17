import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface DiffCommentInputProps {
  filePath: string;
  lineNumber: number;
  onSubmit: (content: string, suggestion?: string) => void;
  onCancel: () => void;
}

export function DiffCommentInput({ filePath, lineNumber, onSubmit, onCancel }: DiffCommentInputProps) {
  const [content, setContent] = useState("");
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState("");

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSubmit(content.trim(), showSuggestion && suggestion.trim() ? suggestion.trim() : undefined);
    setContent("");
    setSuggestion("");
    setShowSuggestion(false);
  };

  return (
    <div className="ml-[5.25rem] mr-4 my-1.5 border-l-2 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-r-md p-2">
      <p className="text-[10px] text-muted-foreground mb-1">
        {filePath}:{lineNumber}
      </p>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a comment..."
        className="min-h-[60px] text-xs bg-white dark:bg-zinc-900 resize-none"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      {showSuggestion && (
        <Textarea
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          placeholder="Suggested code replacement..."
          className="mt-1 min-h-[40px] text-xs font-mono bg-white dark:bg-zinc-900 resize-none"
        />
      )}
      <div className="flex items-center justify-between mt-1.5">
        <button
          onClick={() => setShowSuggestion(!showSuggestion)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSuggestion ? "Hide suggestion" : "+ Add suggestion"}
        </button>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-6 text-xs px-2">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!content.trim()} className="h-6 text-xs px-2">
            Add Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
