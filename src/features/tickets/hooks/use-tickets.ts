import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { ticketKeys } from "@/shared/lib/query-keys";
import type { Ticket } from "@/shared/lib/tickets";

export { ticketKeys };

export function useTickets(projectDir: string) {
  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ticketKeys.all(projectDir),
    queryFn: () => commands.ticketList(projectDir, null, null, true),
    enabled: !!projectDir,
  });

  const createTicket = useMutation({
    mutationFn: (vars: {
      title: string;
      description?: string;
      ticketType?: string;
      priority?: string;
    }) =>
      commands.ticketCreate(
        projectDir,
        vars.title,
        vars.description ?? null,
        vars.ticketType || "task",
        vars.priority ? parseInt(vars.priority, 10) : 2,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const updateTicket = useMutation({
    mutationFn: (vars: {
      id: string;
      updates: {
        title?: string;
        status?: string;
        priority?: string;
        description?: string;
        notes?: string;
        design?: string;
        acceptance_criteria?: string;
      };
    }) =>
      commands.ticketUpdate(
        projectDir,
        vars.id,
        vars.updates.title ?? null,
        vars.updates.status ?? null,
        vars.updates.priority ? parseInt(vars.updates.priority, 10) : null,
        vars.updates.description ?? null,
        vars.updates.notes ?? null,
        vars.updates.design ?? null,
        vars.updates.acceptance_criteria ?? null,
        null,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const closeTicket = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) =>
      commands.ticketClose(projectDir, vars.id, vars.reason ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const deleteTicket = useMutation({
    mutationFn: (vars: { id: string }) => commands.ticketDelete(projectDir, vars.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const addComment = useMutation({
    mutationFn: (vars: { id: string; text: string }) =>
      commands.ticketAddComment(projectDir, vars.id, vars.text),
  });

  const updateSection = useMutation({
    mutationFn: (vars: { ticketId: string; sectionId: string; content: unknown }) =>
      commands.ticketUpdateSection(
        projectDir,
        vars.ticketId,
        vars.sectionId,
        vars.content as import("@/bindings").JsonValue,
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.detail(projectDir, vars.ticketId) });
    },
  });

  async function showTicket(id: string): Promise<Ticket | null> {
    try {
      return await queryClient.fetchQuery({
        queryKey: ticketKeys.detail(projectDir, id),
        queryFn: () => commands.ticketShow(projectDir, id),
      });
    } catch {
      return null;
    }
  }

  return {
    tickets: ticketsQuery.data ?? [],
    isLoading: ticketsQuery.isLoading,
    error: ticketsQuery.error ? String(ticketsQuery.error) : null,
    refreshTickets: () => queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) }),
    createTicket: async (
      title: string,
      description?: string,
      ticketType?: string,
      priority?: string,
    ) => {
      try {
        return await createTicket.mutateAsync({
          title,
          description,
          ticketType,
          priority,
        });
      } catch {
        return null;
      }
    },
    updateTicket: async (
      id: string,
      updates: {
        title?: string;
        status?: string;
        priority?: string;
        description?: string;
        notes?: string;
        design?: string;
        acceptance_criteria?: string;
      },
    ) => {
      await updateTicket.mutateAsync({ id, updates });
    },
    closeTicket: async (id: string, reason?: string) => {
      await closeTicket.mutateAsync({ id, reason });
    },
    showTicket,
    deleteTicket: async (id: string) => {
      await deleteTicket.mutateAsync({ id });
    },
    addComment: async (id: string, text: string) => {
      await addComment.mutateAsync({ id, text });
    },
    updateSection: async (ticketId: string, sectionId: string, content: unknown) => {
      await updateSection.mutateAsync({ ticketId, sectionId, content });
    },
  };
}
