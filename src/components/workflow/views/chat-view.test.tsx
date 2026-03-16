import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatView } from "./chat-view";
import type { Ticket, StepStatus } from "@/types";

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
  onApprove: vi.fn(),
  onExecute: vi.fn(),
};

describe("ChatView display states", () => {
  it("shows response content when response is non-empty", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Here is the analysis"
        isExecuting={false}
        isAwaitingGate={false}
        stepStatus={"completed" as StepStatus}
      />
    );

    expect(screen.getByText("Here is the analysis")).toBeInTheDocument();
  });

  it("shows Processing... when isExecuting is true and no response", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={true}
        isAwaitingGate={false}
        stepStatus={"in_progress" as StepStatus}
      />
    );

    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("shows manual Run button when pending and not executing", () => {
    render(
      <ChatView
        {...defaultProps}
        response=""
        isExecuting={false}
        isAwaitingGate={false}
        stepStatus={"pending" as StepStatus}
      />
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
        isAwaitingGate={false}
        stepStatus={"completed" as StepStatus}
        stepOutput={{
          textContent: "",
          toolActivities: [],
          stderrLines: ["Something went wrong"],
          resultContent: null,
          thinkingContent: "",
          lastChunkType: "",
        }}
      />
    );

    expect(screen.getByText("Agent returned an error:")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows Continue to Next Step button when isAwaitingGate is true", () => {
    render(
      <ChatView
        {...defaultProps}
        response="Some response"
        isExecuting={false}
        isAwaitingGate={true}
        stepStatus={"awaiting_gate" as StepStatus}
      />
    );

    expect(screen.getByText("Continue to Next Step")).toBeInTheDocument();
  });
});
