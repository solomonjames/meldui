import { AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function AppCrashFallback({ error }: { error: Error }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </div>
  );
}
