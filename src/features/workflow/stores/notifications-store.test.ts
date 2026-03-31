import { describe, it, expect, beforeEach } from "vitest";
import { notificationsStoreFactory } from "@/features/workflow/stores/notifications-store";

describe("notificationsStore", () => {
  beforeEach(() => {
    notificationsStoreFactory.disposeStore("ticket-1");
  });

  it("initializes with empty state", () => {
    const store = notificationsStoreFactory.getStore("ticket-1");
    const state = store.getState();
    expect(state.notifications).toEqual([]);
    expect(state.statusText).toBeNull();
    expect(state.lastUpdatedSectionId).toBeNull();
  });

  it("addNotification appends to the list", () => {
    const store = notificationsStoreFactory.getStore("ticket-1");
    store.getState().addNotification({
      title: "Done",
      message: "Step completed",
      level: "success",
    });
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().notifications[0].title).toBe("Done");
  });

  it("clearNotification removes by index", () => {
    const store = notificationsStoreFactory.getStore("ticket-1");
    store.getState().addNotification({ title: "A", message: "", level: "info" });
    store.getState().addNotification({ title: "B", message: "", level: "info" });
    store.getState().clearNotification(0);
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().notifications[0].title).toBe("B");
  });

  it("setStatusText updates status", () => {
    const store = notificationsStoreFactory.getStore("ticket-1");
    store.getState().setStatusText("Working on it");
    expect(store.getState().statusText).toBe("Working on it");
  });

  it("setLastUpdatedSectionId updates section tracking", () => {
    const store = notificationsStoreFactory.getStore("ticket-1");
    store.getState().setLastUpdatedSectionId("requirements");
    expect(store.getState().lastUpdatedSectionId).toBe("requirements");
  });
});
