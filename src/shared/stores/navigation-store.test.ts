import { describe, it, expect, beforeEach } from "vitest";
import { navigationStore } from "@/shared/stores/navigation-store";

describe("navigationStore", () => {
  beforeEach(() => {
    navigationStore.setState({
      activePage: "backlog",
      activeTicketId: null,
      createDialogOpen: false,
    });
  });

  it("has correct initial state", () => {
    const state = navigationStore.getState();
    expect(state.activePage).toBe("backlog");
    expect(state.activeTicketId).toBe(null);
    expect(state.createDialogOpen).toBe(false);
  });

  it("navigateToTicket sets activePage and activeTicketId", () => {
    navigationStore.getState().navigateToTicket("ticket-1");
    const state = navigationStore.getState();
    expect(state.activePage).toBe("ticket");
    expect(state.activeTicketId).toBe("ticket-1");
  });

  it("navigateToBacklog clears activeTicketId and sets page to backlog", () => {
    navigationStore.getState().navigateToTicket("ticket-1");
    navigationStore.getState().navigateToBacklog();
    const state = navigationStore.getState();
    expect(state.activePage).toBe("backlog");
    expect(state.activeTicketId).toBe(null);
  });

  it("navigateToSettings sets activePage to settings", () => {
    navigationStore.getState().navigateToSettings();
    expect(navigationStore.getState().activePage).toBe("settings");
  });

  it("setCreateDialogOpen toggles dialog state", () => {
    navigationStore.getState().setCreateDialogOpen(true);
    expect(navigationStore.getState().createDialogOpen).toBe(true);
    navigationStore.getState().setCreateDialogOpen(false);
    expect(navigationStore.getState().createDialogOpen).toBe(false);
  });
});
