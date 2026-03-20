import { describe, it, expect } from "vitest";
import { generateTicketId, isValidTicketId } from "@/shared/lib/tickets/id";

describe("generateTicketId", () => {
  it("generates an ID with meld- prefix", () => {
    const id = generateTicketId();
    expect(id).toMatch(/^meld-[a-f0-9]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTicketId()));
    expect(ids.size).toBe(100);
  });
});

describe("isValidTicketId", () => {
  it("accepts valid IDs", () => {
    expect(isValidTicketId("meld-abc12345")).toBe(true);
    expect(isValidTicketId("meld-00000000")).toBe(true);
  });

  it("rejects invalid IDs", () => {
    expect(isValidTicketId("")).toBe(false);
    expect(isValidTicketId("abc")).toBe(false);
    expect(isValidTicketId("beads-abc123")).toBe(false);
    expect(isValidTicketId("meld-abc")).toBe(false);
    expect(isValidTicketId("meld-ABCDEFGH")).toBe(false);
  });
});
