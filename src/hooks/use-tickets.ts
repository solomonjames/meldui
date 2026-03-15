import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Ticket } from "@/lib/tickets";

export function useTickets(projectDir: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Ticket[]>("ticket_list", {
        projectDir,
        showAll: true,
      });
      setTickets(result);
    } catch (err) {
      setError(`Failed to load tickets: ${err}`);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  const createTicket = useCallback(
    async (
      title: string,
      description?: string,
      ticketType?: string,
      priority?: string
    ) => {
      try {
        const ticket = await invoke<Ticket>("ticket_create", {
          projectDir,
          title,
          description: description || undefined,
          ticketType: ticketType || "task",
          priority: priority ? parseInt(priority, 10) : 2,
        });
        await refreshTickets();
        return ticket;
      } catch (err) {
        setError(`Create failed: ${err}`);
        return null;
      }
    },
    [projectDir, refreshTickets]
  );

  const updateTicket = useCallback(
    async (
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
      try {
        await invoke("ticket_update", {
          projectDir,
          id,
          ...updates,
          priority: updates.priority ? parseInt(updates.priority, 10) : undefined,
        });
        await refreshTickets();
      } catch (err) {
        setError(`Update failed: ${err}`);
      }
    },
    [projectDir, refreshTickets]
  );

  const closeTicket = useCallback(
    async (id: string, reason?: string) => {
      try {
        await invoke("ticket_close", {
          projectDir,
          id,
          reason,
        });
        await refreshTickets();
      } catch (err) {
        setError(`Close failed: ${err}`);
      }
    },
    [projectDir, refreshTickets]
  );

  const showTicket = useCallback(
    async (id: string): Promise<Ticket | null> => {
      try {
        return await invoke<Ticket>("ticket_show", {
          projectDir,
          id,
        });
      } catch (err) {
        setError(`Show failed: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  const deleteTicket = useCallback(
    async (id: string) => {
      try {
        await invoke("ticket_delete", { projectDir, id });
        await refreshTickets();
      } catch (err) {
        setError(`Delete failed: ${err}`);
      }
    },
    [projectDir, refreshTickets]
  );

  const addComment = useCallback(
    async (id: string, text: string) => {
      try {
        await invoke("ticket_add_comment", { projectDir, id, text });
      } catch (err) {
        setError(`Add comment failed: ${err}`);
      }
    },
    [projectDir]
  );

  const getTicketsByStatus = useCallback(
    (filterStatus: string) => {
      return tickets.filter((t) => t.status === filterStatus);
    },
    [tickets]
  );

  return {
    tickets,
    loading,
    error,
    refreshTickets,
    createTicket,
    updateTicket,
    closeTicket,
    showTicket,
    deleteTicket,
    addComment,
    getTicketsByStatus,
  };
}
