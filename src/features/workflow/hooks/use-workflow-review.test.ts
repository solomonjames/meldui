import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockInvoke, clearTauriMocks, emitTauriEvent } from "@/shared/test/mocks/tauri";
import { useWorkflowReview } from "@/features/workflow/hooks/use-workflow-review";

describe("useWorkflowReview", () => {
  const setError = vi.fn();

  beforeEach(() => {
    clearTauriMocks();
    setError.mockReset();
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

    await waitFor(() => {
      expect(result.current.reviewFindings).toHaveLength(1);
      expect(result.current.pendingReviewRequestId).toBe("review-1");
    });
  });

  it("increments reviewRoundKey on each agent-review-findings event", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));
    expect(result.current.reviewRoundKey).toBe(0);

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-1",
        ticket_id: "issue-1",
        findings: [],
        summary: "Round 1",
      });
    });

    await waitFor(() => {
      expect(result.current.reviewRoundKey).toBe(1);
    });

    act(() => {
      emitTauriEvent("agent-review-findings-request", {
        request_id: "review-2",
        ticket_id: "issue-1",
        findings: [],
        summary: "Round 2",
      });
    });

    await waitFor(() => {
      expect(result.current.reviewRoundKey).toBe(2);
    });
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

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.reviewFindings).toHaveLength(0);
  });

  it("addReviewComment adds a comment", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this", "const x = 1;");
    });

    expect(result.current.reviewComments).toHaveLength(1);
    expect(result.current.reviewComments[0].content).toBe("Fix this");
    expect(result.current.reviewComments[0].suggestion).toBe("const x = 1;");
  });

  it("deleteReviewComment removes a comment", async () => {
    const { result } = renderHook(() => useWorkflowReview("issue-1", setError));

    await waitFor(() => expect(result.current.reviewReady).toBe(true));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this");
    });

    const commentId = result.current.reviewComments[0].id;

    act(() => {
      result.current.deleteReviewComment(commentId);
    });

    expect(result.current.reviewComments).toHaveLength(0);
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

    await waitFor(() => expect(result.current.pendingReviewRequestId).toBe("review-1"));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Comment");
    });

    mockInvoke.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.submitReview({
        action: "approve",
        summary: "LGTM",
        comments: result.current.reviewComments,
        finding_actions: [],
      });
    });

    expect(result.current.pendingReviewRequestId).toBeNull();
    expect(result.current.reviewFindings).toHaveLength(0);
    expect(result.current.reviewComments).toHaveLength(0);
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

    await waitFor(() => expect(result.current.pendingReviewRequestId).toBe("review-1"));

    act(() => {
      result.current.addReviewComment("src/foo.ts", 10, "Fix this");
    });

    mockInvoke.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.submitReview({
        action: "request_changes",
        summary: "Needs fixes",
        comments: result.current.reviewComments,
        finding_actions: [],
      });
    });

    expect(result.current.pendingReviewRequestId).toBeNull();
    expect(result.current.reviewFindings).toHaveLength(0);
    // Comments are preserved but marked resolved
    expect(result.current.reviewComments).toHaveLength(1);
    expect(result.current.reviewComments[0].resolved).toBe(true);
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

    await waitFor(() => expect(result.current.pendingReviewRequestId).toBe("review-1"));

    mockInvoke.mockRejectedValueOnce(new Error("Broken pipe"));

    await act(async () => {
      await result.current.submitReview({
        action: "approve",
        summary: "LGTM",
        comments: [],
        finding_actions: [],
      });
    });

    expect(result.current.pendingReviewRequestId).toBeNull();
    expect(setError).toHaveBeenCalledWith(
      "Agent session expired. Click Resume to continue where you left off.",
    );
  });
});
