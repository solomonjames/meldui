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
  onAdvanceStep: vi.fn(),
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

  it("does not show manual Run button when pending", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={false}
        stepStatus={"pending" as StepStatus}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.queryByText("Starting execution...")).not.toBeInTheDocument();
    expect(screen.queryByText("Run manually")).not.toBeInTheDocument();
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
});

describe("ChatView step complete card", () => {
  it("shows StepCompleteCard when step is complete and not executing", () => {
    const onAdvanceStep = vi.fn();
    render(
      <ChatView
        {...defaultProps}
        response="Done analyzing"
        isExecuting={false}
        stepStatus={"completed" as StepStatus}
        stepOutput={{
          textContent: "Done",
          toolActivities: [],
          stderrLines: [],
          resultContent: "complete",
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
        onAdvanceStep={onAdvanceStep}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("Step complete")).toBeInTheDocument();
    expect(screen.getByText(/Next Step/)).toBeInTheDocument();
    expect(screen.getByText(/Continue Chatting/)).toBeInTheDocument();
  });

  it("does NOT show StepCompleteCard when still executing", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Working..."
        isExecuting={true}
        stepStatus={"in_progress" as StepStatus}
        onAdvanceStep={vi.fn()}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.queryByText("Step complete")).not.toBeInTheDocument();
  });

  it("does NOT show StepCompleteCard when step has no resultContent", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Some text"
        isExecuting={false}
        stepStatus={"completed" as StepStatus}
        stepOutput={{
          textContent: "Some text",
          toolActivities: [],
          stderrLines: [],
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
        onAdvanceStep={vi.fn()}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.queryByText("Step complete")).not.toBeInTheDocument();
  });
});
