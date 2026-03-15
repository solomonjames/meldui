import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectSettings } from "@/lib/sync";

export function useSettings(projectDir: string) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ProjectSettings>("settings_get", { projectDir });
      setSettings(result);
      return result;
    } catch (err) {
      setError(`Failed to load settings: ${err}`);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  const updateSettings = useCallback(
    async (newSettings: ProjectSettings) => {
      try {
        await invoke("settings_update", { projectDir, settings: newSettings });
        setSettings(newSettings);
      } catch (err) {
        setError(`Failed to update settings: ${err}`);
      }
    },
    [projectDir]
  );

  return {
    settings,
    loading,
    error,
    loadSettings,
    updateSettings,
  };
}
