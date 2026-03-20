import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ClaudeStatus } from "@/types";

export const claudeKeys = {
  status: () => ["claude", "status"] as const,
};

export function useClaude() {
  const statusQuery = useQuery({
    queryKey: claudeKeys.status(),
    queryFn: async () => {
      const result = await invoke<string>("claude_status");
      return JSON.parse(result) as ClaudeStatus;
    },
  });

  const loginMutation = useMutation({
    mutationFn: () => invoke<string>("claude_login"),
    onSuccess: () => {
      statusQuery.refetch();
    },
  });

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    checkStatus: () => statusQuery.refetch(),
    login: async () => {
      await loginMutation.mutateAsync();
    },
  };
}
