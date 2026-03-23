import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import { clearTauriMocks, mockInvoke } from "@/shared/test/mocks/tauri";
import { useConversation } from "@/shared/hooks/use-conversation";

describe("useConversation", () => {
  const projectDir = "/test/project";
  const ticketId = "ticket-001";

  let wrapper: ReturnType<typeof createQueryWrapper>;

  beforeEach(() => {
    clearTauriMocks();
    wrapper = createQueryWrapper();
  });

  it("returns null when ticketId is null", async () => {
    const { result } = renderHook(() => useConversation(projectDir, null), { wrapper });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fetches conversation snapshot for a ticket", async () => {
    const snapshot = {
      schema_version: 1,
      ticket_id: ticketId,
      session_id: "session-1",
      created_at: "2026-03-22T00:00:00Z",
      updated_at: "2026-03-22T01:00:00Z",
      status: "completed",
      events: [
        {
          timestamp: "2026-03-22T00:00:01Z",
          sequence: 1,
          step_id: "understand",
          event_type: "text",
          content: "Hello world",
        },
      ],
      steps: [
        {
          step_id: "understand",
          label: "Understand",
          started_at: "2026-03-22T00:00:00Z",
          completed_at: "2026-03-22T01:00:00Z",
          status: "completed",
          first_sequence: 1,
        },
      ],
      event_count: 1,
    };

    mockInvoke.mockResolvedValueOnce(snapshot);

    const { result } = renderHook(() => useConversation(projectDir, ticketId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    expect(mockInvoke).toHaveBeenCalledWith("conversation_restore", {
      projectDir,
      ticketId,
    });
    expect(result.current.data?.ticket_id).toBe(ticketId);
    expect(result.current.data?.events).toHaveLength(1);
  });

  it("returns null when no conversation exists", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useConversation(projectDir, ticketId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
  });
});
