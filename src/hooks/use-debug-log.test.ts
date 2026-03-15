import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebugLog } from "./use-debug-log";

describe("useDebugLog", () => {
  it("adds entries to the buffer", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.log("lifecycle", "test message");
    });

    const entries = result.current.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("lifecycle");
    expect(entries[0].message).toBe("test message");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("caps buffer at 500 entries", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      for (let i = 0; i < 510; i++) {
        result.current.log("event", `msg ${i}`);
      }
    });

    const entries = result.current.getEntries();
    expect(entries).toHaveLength(500);
    // First entry should be msg 10 (first 10 were shifted out)
    expect(entries[0].message).toBe("msg 10");
    expect(entries[499].message).toBe("msg 509");
  });

  it("clears the buffer", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.log("error", "err1");
      result.current.log("error", "err2");
    });

    expect(result.current.getEntries()).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.getEntries()).toHaveLength(0);
  });

  it("entries include timestamp and category", () => {
    const { result } = renderHook(() => useDebugLog());
    const before = Date.now();

    act(() => {
      result.current.log("ndjson", "json line");
    });

    const after = Date.now();
    const entry = result.current.getEntries()[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.category).toBe("ndjson");
  });
});
