import { useMutation, useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import type { ClaudeStatus } from "@/shared/types";

export const claudeKeys = {
  status: () => ["claude", "status"] as const,
};

export function useClaude() {
  const statusQuery = useQuery({
    queryKey: claudeKeys.status(),
    queryFn: () => commands.claudeStatus() as Promise<ClaudeStatus>,
  });

  const loginMutation = useMutation({
    mutationFn: () => commands.claudeLogin(),
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
