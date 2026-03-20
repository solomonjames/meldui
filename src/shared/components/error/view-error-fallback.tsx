import { AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function ViewErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <h2 className="text-lg font-semibold">This view encountered an error</h2>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button variant="outline" onClick={resetErrorBoundary}>
          Try again
        </Button>
      </div>
    </div>
  );
}
