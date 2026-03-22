import { vi } from "vitest";

type EventCallback = (event: { payload: unknown }) => void;

interface MockListener {
  event: string;
  callback: EventCallback;
  unlisten: () => void;
}

const listeners: MockListener[] = [];

/** Emit a Tauri event to all registered listeners. */
export function emitTauriEvent(event: string, payload: unknown) {
  for (const listener of listeners) {
    if (listener.event === event) {
      listener.callback({ payload });
    }
  }
}

/** Mock Channel for testing channel-based streaming */
export class MockChannel<T> {
  onmessage: ((payload: T) => void) | null = null;

  /** Simulate receiving a message (for tests) */
  send(payload: T) {
    this.onmessage?.(payload);
  }
}

/** Clear all mock listeners (call in beforeEach/afterEach). */
export function clearTauriMocks() {
  listeners.length = 0;
  mockInvoke.mockReset();
}

/** Mock for `@tauri-apps/api/core` invoke */
export const mockInvoke = vi.fn();

/** Mock for `@tauri-apps/api/event` listen */
const mockListen = vi.fn(async (event: string, callback: EventCallback) => {
  const unlisten = () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
  const listener: MockListener = { event, callback, unlisten };
  listeners.push(listener);
  return unlisten;
});

// Wire up vi.mock calls
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: MockChannel,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));
