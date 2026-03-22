import { useCallback, useRef, useState } from "react";

export type DebugCategory = "lifecycle" | "event" | "ndjson" | "error";

export interface DebugEntry {
  timestamp: number;
  category: DebugCategory;
  message: string;
}

const MAX_ENTRIES = 500;

export function useDebugLog() {
  const bufferRef = useRef<DebugEntry[]>([]);
  const [, setTick] = useState(0);

  const log = useCallback((category: DebugCategory, message: string) => {
    const entry: DebugEntry = {
      timestamp: Date.now(),
      category,
      message,
    };
    const buffer = bufferRef.current;
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift();
    }
  }, []);

  const getEntries = useCallback(() => bufferRef.current, []);

  const clear = useCallback(() => {
    bufferRef.current = [];
  }, []);

  // Force a re-render to see latest entries in the panel
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  return { log, getEntries, clear, refresh };
}
