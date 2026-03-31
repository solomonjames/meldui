import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectSettings } from "@/bindings";
import { commands } from "@/bindings";

const settingsKeys = {
  project: (projectDir: string) => ["settings", "project", projectDir] as const,
};

export function useSettings(projectDir: string) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: settingsKeys.project(projectDir),
    queryFn: () => commands.settingsGet(projectDir),
    enabled: !!projectDir,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (newSettings: ProjectSettings) => commands.settingsUpdate(projectDir, newSettings),
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
        queryFn: () => commands.settingsGet(projectDir),
      });
      return data ?? null;
    },
    updateSettings: async (newSettings: ProjectSettings) => {
      await updateSettingsMutation.mutateAsync(newSettings);
    },
  };
}
