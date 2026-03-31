import { describe, it, expect } from "vitest";
import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";

interface TestState {
  count: number;
  increment: () => void;
}

function createTestFactory() {
  return createTicketStoreFactory<TestState>((set) => ({
    count: 0,
    increment: () => set((s) => ({ count: s.count + 1 })),
  }));
}

describe("createTicketStoreFactory", () => {
  it("getStore creates a store on first access", () => {
    const factory = createTestFactory();
    const store = factory.getStore("ticket-1");
    expect(store.getState().count).toBe(0);
  });

  it("getStore returns the same store for the same ticketId", () => {
    const factory = createTestFactory();
    const a = factory.getStore("ticket-1");
    const b = factory.getStore("ticket-1");
    expect(a).toBe(b);
  });

  it("getStore returns different stores for different ticketIds", () => {
    const factory = createTestFactory();
    const a = factory.getStore("ticket-1");
    const b = factory.getStore("ticket-2");
    expect(a).not.toBe(b);
  });

  it("stores are isolated — mutations on one do not affect another", () => {
    const factory = createTestFactory();
    const a = factory.getStore("ticket-1");
    const b = factory.getStore("ticket-2");

    a.getState().increment();

    expect(a.getState().count).toBe(1);
    expect(b.getState().count).toBe(0);
  });

  it("disposeStore removes the store", () => {
    const factory = createTestFactory();
    const first = factory.getStore("ticket-1");
    first.getState().increment();
    expect(first.getState().count).toBe(1);

    factory.disposeStore("ticket-1");

    const second = factory.getStore("ticket-1");
    expect(second).not.toBe(first);
    expect(second.getState().count).toBe(0);
  });

  it("disposeStore is a no-op for unknown ticketId", () => {
    const factory = createTestFactory();
    expect(() => factory.disposeStore("nonexistent")).not.toThrow();
  });
});
