import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectSettings } from "@/lib/sync";

export const settingsKeys = {
  project: (projectDir: string) => ["settings", "project", projectDir] as const,
};

export function useSettings(projectDir: string) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: settingsKeys.project(projectDir),
    queryFn: () => invoke<ProjectSettings>("settings_get", { projectDir }),
    enabled: !!projectDir,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (newSettings: ProjectSettings) =>
      invoke("settings_update", { projectDir, settings: newSettings }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.project(projectDir),
      });
    },
  });

  return {
    settings: settingsQuery.data ?? null,
    loading: settingsQuery.isLoading,
    error: settingsQuery.error ? String(settingsQuery.error) : null,
    loadSettings: async () => {
      const data = await queryClient.fetchQuery({
        queryKey: settingsKeys.project(projectDir),
        queryFn: () => invoke<ProjectSettings>("settings_get", { projectDir }),
      });
      return data ?? null;
    },
    updateSettings: async (newSettings: ProjectSettings) => {
      await updateSettingsMutation.mutateAsync(newSettings);
    },
  };
}
