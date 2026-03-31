import { describe, it, expect, beforeEach } from "vitest";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import type { ReviewFinding } from "@/shared/types";

describe("reviewStore", () => {
  beforeEach(() => {
    reviewStoreFactory.disposeStore("ticket-1");
  });

  it("initializes with empty state", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    const state = store.getState();
    expect(state.findings).toEqual([]);
    expect(state.comments).toEqual([]);
    expect(state.pendingRequestId).toBeNull();
    expect(state.roundKey).toBe(0);
  });

  it("setFindings stores findings and increments roundKey", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    const findings: ReviewFinding[] = [
      {
        id: "f1",
        file_path: "src/foo.ts",
        severity: "warning",
        validity: "undecided",
        title: "Unused variable",
        description: "x is never used",
      },
    ];
    store.getState().setFindings(findings, "req-1");
    const state = store.getState();
    expect(state.findings).toEqual(findings);
    expect(state.pendingRequestId).toBe("req-1");
    expect(state.roundKey).toBe(1);
  });

  it("addComment adds a comment with auto-generated id", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    store.getState().addComment("src/foo.ts", 10, "Fix this", "const y = 1;");
    const comments = store.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].file_path).toBe("src/foo.ts");
    expect(comments[0].line_number).toBe(10);
    expect(comments[0].content).toBe("Fix this");
    expect(comments[0].suggestion).toBe("const y = 1;");
    expect(comments[0].resolved).toBe(false);
    expect(comments[0].id).toMatch(/^comment-/);
  });

  it("deleteComment removes by id", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    store.getState().addComment("src/a.ts", 1, "A");
    store.getState().addComment("src/b.ts", 2, "B");
    const id = store.getState().comments[0].id;
    store.getState().deleteComment(id);
    expect(store.getState().comments).toHaveLength(1);
    expect(store.getState().comments[0].content).toBe("B");
  });

  it("clearAfterApproval clears comments and findings", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    store.getState().setFindings(
      [
        {
          id: "f1",
          file_path: "x",
          severity: "info",
          validity: "undecided",
          title: "t",
          description: "d",
        },
      ],
      "req-1",
    );
    store.getState().addComment("x", 1, "c");
    store.getState().clearAfterApproval();
    expect(store.getState().findings).toEqual([]);
    expect(store.getState().comments).toEqual([]);
    expect(store.getState().pendingRequestId).toBeNull();
  });

  it("clearAfterRequestChanges marks comments resolved and clears findings", () => {
    const store = reviewStoreFactory.getStore("ticket-1");
    store.getState().setFindings(
      [
        {
          id: "f1",
          file_path: "x",
          severity: "info",
          validity: "undecided",
          title: "t",
          description: "d",
        },
      ],
      "req-1",
    );
    store.getState().addComment("x", 1, "c");
    store.getState().clearAfterRequestChanges();
    expect(store.getState().findings).toEqual([]);
    expect(store.getState().comments).toHaveLength(1);
    expect(store.getState().comments[0].resolved).toBe(true);
    expect(store.getState().pendingRequestId).toBeNull();
  });
});
