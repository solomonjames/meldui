import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { reviewStoreFactory } from "@/features/workflow/stores/review-store";
import { mockInvoke, clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useWorkflowReview } from "@/features/workflow/hooks/use-workflow-review";

describe("useWorkflowReview", () => {
  const setError = vi.fn<(issueId: string, msg: string) => void>();

  beforeEach(() => {
    clearTauriMocks();
    setError.mockReset();
    reviewStoreFactory.disposeStore("issue-1");
    reviewStoreFactory.disposeStore("issue-OTHER");
  });

  it("reviewReady becomes true after mount", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => {
      expect(result.current.reviewReady).toBe(true);
    });
  });

  it("sets reviewFindings and pendingReviewRequestId when event fires", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [
          {
            id: "f1",
            file_path: "src/foo.ts",
            severity: "warning",
            validity: "real",
            title: "Missing null check",
            description: "Could crash",
          },
        ],
        summary: "1 finding",
      });
    });

    const store = reviewStoreFactory.getStore("issue-1").getState();
    expect(store.findings).toHaveLength(1);
    expect(store.pendingRequestId).toBe("review-1");
  });

  it("increments reviewRoundKey on each agent-review-findings event", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));
    expect(reviewStoreFactory.getStore("issue-1").getState().roundKey).toBe(0);

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [],
        summary: "Round 1",
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().roundKey).toBe(1);

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-2",
        ticket_id: "issue-1",
        findings: [],
        summary: "Round 2",
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().roundKey).toBe(2);
  });

  it("ignores review events for different ticket_id", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-OTHER",
        findings: [
          {
            id: "f1",
            file_path: "src/foo.ts",
            severity: "warning",
            validity: "real",
            title: "Test",
            description: "Test",
          },
        ],
        summary: "1 finding",
      });
    });

    // issue-1 store should be empty
    expect(reviewStoreFactory.getStore("issue-1").getState().findings).toHaveLength(0);
    // issue-OTHER store should have the finding
    expect(reviewStoreFactory.getStore("issue-OTHER").getState().findings).toHaveLength(1);
  });

  it("addReviewComment adds a comment", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this", "const x = 1;");
    });

    const comments = reviewStoreFactory.getStore("issue-1").getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("Fix this");
    expect(comments[0].suggestion).toBe("const x = 1;");
  });

  it("deleteReviewComment removes a comment", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this");
    });

    const commentId = reviewStoreFactory.getStore("issue-1").getState().comments[0].id;

    act(() => {
      result.current.deleteReviewComment(commentId);
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().comments).toHaveLength(0);
  });

  it("submitReview with approve clears all review state", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    // Set up review state
    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [
          {
            id: "f1",
            file_path: "src/foo.ts",
            severity: "info",
            validity: "real",
            title: "Test",
            description: "Test",
          },
        ],
        summary: "1 finding",
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().pendingRequestId).toBe("review-1");

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Comment");
    });

    mockInvoke.mockResolvedValueOnce(undefined);

    const comments = reviewStoreFactory.getStore("issue-1").getState().comments;

    await act(async () => {
      await result.current.submitReview({
        action: "approve",
        summary: "LGTM",
        comments,
        finding_actions: [],
      });
    });

    const state = reviewStoreFactory.getStore("issue-1").getState();
    expect(state.pendingRequestId).toBeNull();
    expect(state.findings).toHaveLength(0);
    expect(state.comments).toHaveLength(0);
  });

  it("submitReview with request_changes marks comments resolved", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [
          {
            id: "f1",
            file_path: "src/foo.ts",
            severity: "warning",
            validity: "real",
            title: "Test",
            description: "Test",
          },
        ],
        summary: "1 finding",
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().pendingRequestId).toBe("review-1");

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this");
    });

    mockInvoke.mockResolvedValueOnce(undefined);

    const comments = reviewStoreFactory.getStore("issue-1").getState().comments;

    await act(async () => {
      await result.current.submitReview({
        action: "request_changes",
        summary: "Needs fixes",
        comments,
        finding_actions: [],
      });
    });

    const state = reviewStoreFactory.getStore("issue-1").getState();
    expect(state.pendingRequestId).toBeNull();
    expect(state.findings).toHaveLength(0);
    // Comments are preserved but marked resolved
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].resolved).toBe(true);
  });

  it("submitReview handles broken pipe error", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [],
        summary: "No findings",
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().pendingRequestId).toBe("review-1");

    mockInvoke.mockRejectedValueOnce(new Error("Broken pipe"));

    await act(async () => {
      await result.current.submitReview({
        action: "approve",
        summary: "LGTM",
        comments: [],
        finding_actions: [],
      });
    });

    expect(reviewStoreFactory.getStore("issue-1").getState().pendingRequestId).toBeNull();
    expect(setError).toHaveBeenCalledWith(
      "issue-1",
      "Agent session expired. Click Resume to continue where you left off.",
    );
  });
});
