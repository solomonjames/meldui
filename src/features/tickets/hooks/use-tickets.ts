import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings";
import type { Ticket } from "@/shared/lib/tickets";
import { ticketKeys } from "@/shared/lib/query-keys";

export { ticketKeys };

export function useTickets(projectDir: string) {
  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ticketKeys.all(projectDir),
    queryFn: () =>
      commands.ticketList({ projectDir, showAll: true }),
    enabled: !!projectDir,
  });

  const createTicket = useMutation({
    mutationFn: (vars: {
      title: string;
      description?: string;
      ticketType?: string;
      priority?: string;
    }) =>
      commands.ticketCreate({
        projectDir,
        title: vars.title,
        description: vars.description,
        ticketType: vars.ticketType || "task",
        priority: vars.priority ? parseInt(vars.priority, 10) : 2,
      }),
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
      commands.ticketUpdate({
        projectDir,
        id: vars.id,
        title: vars.updates.title,
        status: vars.updates.status,
        priority: vars.updates.priority
          ? parseInt(vars.updates.priority, 10)
          : undefined,
        description: vars.updates.description,
        notes: vars.updates.notes,
        design: vars.updates.design,
        acceptanceCriteria: vars.updates.acceptance_criteria,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const closeTicket = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) =>
      commands.ticketClose({ projectDir, id: vars.id, reason: vars.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const deleteTicket = useMutation({
    mutationFn: (vars: { id: string }) =>
      commands.ticketDelete({ projectDir, id: vars.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const addComment = useMutation({
    mutationFn: (vars: { id: string; text: string }) =>
      commands.ticketAddComment({
        projectDir,
        id: vars.id,
        text: vars.text,
      }),
  });

  const updateSection = useMutation({
    mutationFn: (vars: { ticketId: string; sectionId: string; content: unknown }) =>
      commands.ticketUpdateSection({
        projectDir,
        ticketId: vars.ticketId,
        sectionId: vars.sectionId,
        content: vars.content,
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.detail(projectDir, vars.ticketId) });
    },
  });

  async function showTicket(id: string): Promise<Ticket | null> {
    try {
      return await queryClient.fetchQuery({
        queryKey: ticketKeys.detail(projectDir, id),
        queryFn: () => commands.ticketShow({ projectDir, id }),
      });
    } catch {
      return null;
    }
  }

  return {
    tickets: ticketsQuery.data ?? [],
    isLoading: ticketsQuery.isLoading,
    error: ticketsQuery.error ? String(ticketsQuery.error) : null,
    refreshTickets: () =>
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) }),
    createTicket: async (
      title: string,
      description?: string,
      ticketType?: string,
      priority?: string
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
      }
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
