import { useEffect, useRef, useState } from "react";

/**
 * Generic hook for subscribing to a typed tauri-specta event.
 * Uses the ref-based handler pattern to avoid stale closures
 * and the cancelled-flag pattern for safe async cleanup.
 *
 * @returns isReady — true once the listener is attached
 */
export function useTauriEvent<T>(
  event: {
    listen: (cb: (e: { payload: T }) => void) => Promise<() => void>;
  },
  handler: (payload: T) => void
): boolean {
  const [isReady, setIsReady] = useState(false);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const eventRef = useRef(event);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsReady(false);

    eventRef.current
      .listen((e) => {
        if (!cancelled) handlerRef.current(e.payload);
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
          setIsReady(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[useTauriEvent] listen() failed:", err);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isReady;
}
