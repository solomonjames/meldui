import { AppearanceSection } from "@/features/preferences/components/appearance-section";

export function PreferencesApp() {
  return (
    <div className="h-screen bg-background text-foreground p-6">
      <h1 className="text-lg font-semibold mb-6">Preferences</h1>
      <AppearanceSection />
    </div>
  );
}
