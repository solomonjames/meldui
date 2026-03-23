import { useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import type { ConversationSnapshot } from "@/shared/lib/conversations";
import { conversationKeys } from "@/shared/lib/conversations";

export function useConversation(projectDir: string, ticketId: string | null) {
  const query = useQuery({
    queryKey: conversationKeys.ticket(projectDir, ticketId ?? ""),
    queryFn: async () => {
      if (!ticketId) return null;
      const snapshot = await commands.conversationRestore(projectDir, ticketId);
      return snapshot ?? null;
    },
    enabled: !!ticketId,
  });

  return {
    data: (query.data ?? null) as ConversationSnapshot | null,
    isLoading: query.isLoading,
    error: query.error ? String(query.error) : null,
  };
}
