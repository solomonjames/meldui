import { describe, it, expect } from "vitest";
import { validateTicket, isValidStatus, isValidType } from "@/shared/lib/tickets/validation";
import type { Ticket } from "@/shared/lib/tickets/types";

function makeTicket(overrides: Partial<Ticket> = {}): Partial<Ticket> {
  return {
    id: "meld-abc12345",
    title: "Test ticket",
    status: "open",
    priority: 2,
    ticket_type: "task",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    labels: [],
    children_ids: [],
    metadata: {},
    comments: [],
    ...overrides,
  };
}

describe("validateTicket", () => {
  it("returns no errors for a valid ticket", () => {
    expect(validateTicket(makeTicket())).toEqual([]);
  });

  it("requires id", () => {
    const errors = validateTicket(makeTicket({ id: "" }));
    expect(errors).toContainEqual({ field: "id", message: "ID is required" });
  });

  it("requires title", () => {
    const errors = validateTicket(makeTicket({ title: "  " }));
    expect(errors).toContainEqual({ field: "title", message: "Title is required" });
  });

  it("validates status", () => {
    const errors = validateTicket(makeTicket({ status: "invalid" as never }));
    expect(errors.some((e) => e.field === "status")).toBe(true);
  });

  it("validates priority range", () => {
    expect(validateTicket(makeTicket({ priority: -1 })).some((e) => e.field === "priority")).toBe(
      true,
    );
    expect(validateTicket(makeTicket({ priority: 5 })).some((e) => e.field === "priority")).toBe(
      true,
    );
    expect(validateTicket(makeTicket({ priority: 0 }))).toEqual([]);
    expect(validateTicket(makeTicket({ priority: 4 }))).toEqual([]);
  });

  it("validates ticket_type", () => {
    const errors = validateTicket(makeTicket({ ticket_type: "nope" as never }));
    expect(errors.some((e) => e.field === "ticket_type")).toBe(true);
  });
});

describe("isValidStatus", () => {
  it("accepts valid statuses", () => {
    expect(isValidStatus("open")).toBe(true);
    expect(isValidStatus("in_progress")).toBe(true);
    expect(isValidStatus("closed")).toBe(true);
  });

  it("rejects invalid statuses", () => {
    expect(isValidStatus("nope")).toBe(false);
  });
});

describe("isValidType", () => {
  it("accepts valid types", () => {
    expect(isValidType("feature")).toBe(true);
    expect(isValidType("bug")).toBe(true);
  });

  it("rejects invalid types", () => {
    expect(isValidType("story")).toBe(false);
  });
});
