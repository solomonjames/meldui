import { QueryClientProvider } from "@tanstack/react-query";
import { AppearanceSection } from "@/features/preferences/components/appearance-section";
import { queryClient } from "@/shared/lib/query-client";

export function PreferencesApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen bg-background text-foreground p-6">
        <h1 className="text-lg font-semibold mb-6">Preferences</h1>
        <AppearanceSection />
      </div>
    </QueryClientProvider>
  );
}
