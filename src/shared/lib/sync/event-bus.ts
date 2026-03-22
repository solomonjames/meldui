type SyncEventType =
  | "ticket:created"
  | "ticket:updated"
  | "ticket:closed"
  | "ticket:deleted"
  | "sync:started"
  | "sync:completed"
  | "sync:error";

type SyncEventHandler = (data: unknown) => void;

class SyncEventBus extends EventTarget {
  emit(type: SyncEventType, data?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: data }));
  }

  on(type: SyncEventType, handler: SyncEventHandler): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent).detail);
    };
    this.addEventListener(type, listener);
    return () => this.removeEventListener(type, listener);
  }
}

export const syncEventBus = new SyncEventBus();
