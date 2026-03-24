import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";

interface ThinkingBlockProps {
  content: string;
  isActive?: boolean;
}

export function ThinkingBlock({ content, isActive = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 border-l-2 border-purple-500/30 rounded-r-lg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-purple-50/50 dark:hover:bg-purple-950/20 rounded-r-lg"
      >
        <Brain className={`w-3.5 h-3.5 text-purple-400 ${isActive ? "animate-pulse" : ""}`} />
        <span className="text-xs text-purple-400 font-medium">Thinking</span>
        <ChevronDown
          className={`w-3 h-3 ml-auto text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}
