import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatView } from "@/features/workflow/components/views/chat-view";
import { createQueryWrapper } from "@/shared/test/helpers/query-wrapper";
import type { StepStatus } from "@/shared/types";

const defaultProps = {
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

describe("ChatView next step button", () => {
  it("shows Next Step button when step is completed and onAdvanceStep is provided", () => {
    const onAdvanceStep = vi.fn();
    render(
      <ChatView
        {...defaultProps}
        response="Done analyzing"
        isExecuting={false}
        stepStatus={"completed" as StepStatus}
        onAdvanceStep={onAdvanceStep}
      />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByRole("button", { name: "Advance to next step" })).toBeInTheDocument();
    expect(screen.getByText("Next Step")).toBeInTheDocument();
  });

  it("does NOT show Next Step button when still executing", () => {
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

    expect(screen.queryByRole("button", { name: "Advance to next step" })).not.toBeInTheDocument();
  });

  it("shows Next Step button even when stepOutput has no resultContent", () => {
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

    expect(screen.getByRole("button", { name: "Advance to next step" })).toBeInTheDocument();
  });
});
