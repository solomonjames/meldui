import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockInvoke, clearTauriMocks } from "@/shared/test/mocks/tauri";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import { useTickets } from "@/features/tickets/hooks/use-tickets";

describe("useTickets", () => {
  let wrapper: ReturnType<typeof createQueryWrapper>;

  beforeEach(() => {
    clearTauriMocks();
    wrapper = createQueryWrapper();
  });

  it("fetches ticket list on mount", async () => {
    const tickets = [{ id: "t-1", title: "Test", status: "open", priority: 2 }];
    mockInvoke.mockResolvedValueOnce(tickets);

    const { result } = renderHook(() => useTickets("/project"), { wrapper });

    await waitFor(() => {
      expect(result.current.tickets).toEqual(tickets);
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_list", {
      projectDir: "/project",
      showAll: true,
    });
  });

  it("returns empty array and isLoading while fetching", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useTickets("/project"), { wrapper });

    expect(result.current.tickets).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("createTicket calls invoke and invalidates list", async () => {
    const tickets = [{ id: "t-1", title: "Test", status: "open", priority: 2 }];
    const newTicket = { id: "t-2", title: "New", status: "open", priority: 2 };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve(tickets);
      if (cmd === "ticket_create") return Promise.resolve(newTicket);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.tickets).toEqual(tickets));

    await act(async () => {
      await result.current.createTicket("New", undefined, "task", "2");
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_create", {
      projectDir: "/project",
      title: "New",
      description: undefined,
      ticketType: "task",
      priority: 2,
    });
  });

  it("updateTicket calls invoke with correct args", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve([]);
      if (cmd === "ticket_update") return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateTicket("t-1", { status: "closed" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_update", {
      projectDir: "/project",
      id: "t-1",
      status: "closed",
      priority: undefined,
    });
  });

  it("closeTicket calls invoke with reason", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve([]);
      if (cmd === "ticket_close") return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.closeTicket("t-1", "done");
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_close", {
      projectDir: "/project",
      id: "t-1",
      reason: "done",
    });
  });

  it("deleteTicket calls invoke", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve([]);
      if (cmd === "ticket_delete") return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteTicket("t-1");
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_delete", {
      projectDir: "/project",
      id: "t-1",
    });
  });

  it("showTicket uses fetchQuery", async () => {
    const ticket = { id: "t-1", title: "Test", status: "open", priority: 2 };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve([]);
      if (cmd === "ticket_show") return Promise.resolve(ticket);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let shown: unknown;
    await act(async () => {
      shown = await result.current.showTicket("t-1");
    });

    expect(shown).toEqual(ticket);
    expect(mockInvoke).toHaveBeenCalledWith("ticket_show", {
      projectDir: "/project",
      id: "t-1",
    });
  });

  it("addComment calls invoke with text", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ticket_list") return Promise.resolve([]);
      if (cmd === "ticket_add_comment") return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTickets("/project"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addComment("t-1", "hello");
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket_add_comment", {
      projectDir: "/project",
      id: "t-1",
      text: "hello",
    });
  });

  it("does not fetch when projectDir is empty", () => {
    const { result } = renderHook(() => useTickets(""), { wrapper });

    expect(result.current.tickets).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
