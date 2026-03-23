import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompactWorkflowIndicator } from "@/features/workflow/components/compact-workflow-indicator";

describe("CompactWorkflowIndicator", () => {
  const defaultProps = {
    steps: [
      { id: "s1", name: "spec-understand" },
      { id: "s2", name: "spec-investigate" },
      { id: "s3", name: "implementation" },
      { id: "s4", name: "verify" },
      { id: "s5", name: "diff-review" },
      { id: "s6", name: "commit" },
    ],
    currentStepId: "s3",
    completedStepIds: ["s1", "s2"],
    autoAdvance: true,
    onAutoAdvanceChange: vi.fn(),
  };

  it("renders progress dots with correct completed/uncompleted state", () => {
    render(<CompactWorkflowIndicator {...defaultProps} />);
    const dots = screen.getAllByTestId(/^step-dot-/);
    expect(dots).toHaveLength(6);
    expect(dots[0]).toHaveAttribute("data-completed", "true");
    expect(dots[1]).toHaveAttribute("data-completed", "true");
    expect(dots[2]).toHaveAttribute("data-completed", "false");
    expect(dots[3]).toHaveAttribute("data-completed", "false");
  });

  it("displays current step name and count", () => {
    render(<CompactWorkflowIndicator {...defaultProps} />);
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("[3/6]")).toBeInTheDocument();
  });

  it("renders auto-advance toggle in correct state", () => {
    render(<CompactWorkflowIndicator {...defaultProps} />);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("calls onAutoAdvanceChange when toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<CompactWorkflowIndicator {...defaultProps} />);
    await user.click(screen.getByRole("switch"));
    expect(defaultProps.onAutoAdvanceChange).toHaveBeenCalled();
    expect(defaultProps.onAutoAdvanceChange.mock.calls[0][0]).toBe(false);
  });

  it("does not render when no steps provided", () => {
    const { container } = render(
      <CompactWorkflowIndicator
        {...defaultProps}
        steps={[]}
        currentStepId={null}
        completedStepIds={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
