import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatView } from "@/features/workflow/components/views/chat-view";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import type { Ticket, StepStatus } from "@/shared/types";

const makeTicket = (): Ticket => ({
  id: "ticket-1",
  title: "Test ticket",
  description: "desc",
  status: "open" as const,
  type: "task" as const,
  priority: 2,
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
});

const defaultProps = {
  ticket: makeTicket(),
  stepName: "Understand",
  onExecute: vi.fn(),
};

describe("ChatView display states", () => {
  it("shows response content when response is non-empty", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Here is the analysis"
        isExecuting={false}
        stepStatus={"completed" as StepStatus}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("Here is the analysis")).toBeInTheDocument();
  });

  it("shows Processing... in activity bar when isExecuting is true and no response", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={true}
        stepStatus={"in_progress" as StepStatus}
      />,
      { wrapper: createQueryWrapper() },
    );

    // Processing state is shown via the ActivityBar component
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("shows manual Run button when pending and not executing", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={false}
        stepStatus={"pending" as StepStatus}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("Starting execution...")).toBeInTheDocument();
    expect(screen.getByText("Run manually")).toBeInTheDocument();
  });

  it("shows Retry button when not executing and has stderr errors", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={false}
        stepStatus={"completed" as StepStatus}
        stepOutput={{
          textContent: "",
          toolActivities: [],
          stderrLines: ["Something went wrong"],
          resultContent: null,
          thinkingContent: "",
          lastChunkType: "",
          contentBlocks: [],
          subagentActivities: [],
          filesChanged: [],
          activeToolName: null,
          activeToolStartTime: null,
          toolUseSummaries: [],
          isCompacting: false,
        }}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("Agent returned an error:")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows FeedbackCard when pendingFeedback is set", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Some response"
        isExecuting={true}
        stepStatus={"in_progress" as StepStatus}
        pendingFeedback={{
          request_id: "feedback-123",
          ticket_id: "ticket-1",
          summary: "Captured problem statement and scope",
        }}
        onRespondToFeedback={vi.fn()}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("Ready for Review")).toBeInTheDocument();
    expect(screen.getByText("Captured problem statement and scope")).toBeInTheDocument();
    expect(screen.getByText("Approve & Continue")).toBeInTheDocument();
    expect(screen.getByText("Give Feedback")).toBeInTheDocument();
  });
});
