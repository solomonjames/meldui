import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Ticket } from "@/shared/lib/tickets";
import { ticketKeys } from "@/shared/lib/query-keys";

export { ticketKeys };

export function useTickets(projectDir: string) {
  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ticketKeys.all(projectDir),
    queryFn: () =>
      invoke<Ticket[]>("ticket_list", { projectDir, showAll: true }),
    enabled: !!projectDir,
  });

  const createTicket = useMutation({
    mutationFn: (vars: {
      title: string;
      description?: string;
      ticketType?: string;
      priority?: string;
    }) =>
      invoke<Ticket>("ticket_create", {
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
      invoke("ticket_update", {
        projectDir,
        id: vars.id,
        ...vars.updates,
        priority: vars.updates.priority
          ? parseInt(vars.updates.priority, 10)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const closeTicket = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) =>
      invoke("ticket_close", { projectDir, id: vars.id, reason: vars.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const deleteTicket = useMutation({
    mutationFn: (vars: { id: string }) =>
      invoke("ticket_delete", { projectDir, id: vars.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all(projectDir) });
    },
  });

  const addComment = useMutation({
    mutationFn: (vars: { id: string; text: string }) =>
      invoke("ticket_add_comment", {
        projectDir,
        id: vars.id,
        text: vars.text,
      }),
  });

  async function showTicket(id: string): Promise<Ticket | null> {
    try {
      return await queryClient.fetchQuery({
        queryKey: ticketKeys.detail(projectDir, id),
        queryFn: () => invoke<Ticket>("ticket_show", { projectDir, id }),
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
  };
}
