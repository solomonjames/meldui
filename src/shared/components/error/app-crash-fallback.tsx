import { AlertTriangle, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";

export function AppCrashFallback({ error }: { error: Error }) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error.stack ?? error.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">Meld hit an unexpected error</h1>
        <p className="text-sm text-muted-foreground">
          Your work has been saved. Reloading should fix this.
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            {copied ? "Copied" : "Copy error details"}
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
