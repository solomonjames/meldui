import { useStore } from "zustand";
import { devtools } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";

type StateCreator<T> = (set: StoreApi<T>["setState"], get: StoreApi<T>["getState"]) => T;

export function createTicketStoreFactory<T>(name: string, initializer: StateCreator<T>) {
  const stores = new Map<string, StoreApi<T>>();

  function getStore(ticketId: string): StoreApi<T> {
    let store = stores.get(ticketId);
    if (!store) {
      store = import.meta.env.DEV
        ? createStore<T>()(devtools(initializer, { name: `${name}:${ticketId}` }))
        : createStore<T>()(initializer);
      stores.set(ticketId, store);
    }
    return store;
  }

  function useTicketStore<R>(ticketId: string, selector: (s: T) => R): R {
    return useStore(getStore(ticketId), selector);
  }

  function disposeStore(ticketId: string) {
    stores.delete(ticketId);
  }

  return { getStore, useTicketStore, disposeStore };
}
