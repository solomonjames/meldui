import { useState } from "react";

interface ThinkingSectionProps {
  content: string;
}

export function ThinkingSection({ content }: ThinkingSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        Thinking ({content.length} chars)
      </button>
      {expanded && (
        <pre className="text-xs text-muted-foreground/60 mt-1 whitespace-pre-wrap max-h-64 overflow-y-auto pl-5 border-l-2 border-zinc-200 dark:border-zinc-700">
          {content}
        </pre>
      )}
    </div>
  );
}
