import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";

export function ViewErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <h2 className="text-lg font-semibold">This view couldn't load</h2>
        <p className="text-sm text-muted-foreground">Try again, or go back to the dashboard.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetErrorBoundary}>
            Try again
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${showDetails ? "rotate-180" : ""}`}
          />
          {showDetails ? "Hide" : "Show"} details
        </button>
        {showDetails && (
          <pre className="text-left text-xs text-muted-foreground bg-zinc-100 dark:bg-zinc-900 rounded-lg p-3 max-h-[200px] overflow-auto w-full whitespace-pre-wrap break-all">
            {error.stack ?? error.message}
          </pre>
        )}
      </div>
    </div>
  );
}
