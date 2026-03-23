import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowTab } from "@/shared/components/workflow-tab";

describe("WorkflowTab", () => {
  const steps = [
    { id: "s1", name: "spec-understand", description: "Capture problem" },
    { id: "s2", name: "spec-investigate", description: "Deep investigation" },
    { id: "s3", name: "implementation", description: "TDD implementation" },
  ];

  const stepHistory = [
    {
      step_id: "s1",
      status: "completed" as const,
      started_at: "2026-03-23T10:00:00Z",
      completed_at: "2026-03-23T10:05:00Z",
    },
    {
      step_id: "s2",
      status: "completed" as const,
      started_at: "2026-03-23T10:05:00Z",
      completed_at: "2026-03-23T10:12:00Z",
    },
  ];

  it("renders all steps with correct status icons", () => {
    render(
      <WorkflowTab
        steps={steps}
        currentStepId="s3"
        stepHistory={stepHistory}
        onStepClick={vi.fn()}
      />,
    );
    expect(screen.getByText("spec-understand")).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getAllByTestId("step-completed")).toHaveLength(2);
    expect(screen.getByTestId("step-current")).toBeInTheDocument();
  });

  it("calls onStepClick for completed steps", async () => {
    const onStepClick = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkflowTab
        steps={steps}
        currentStepId="s3"
        stepHistory={stepHistory}
        onStepClick={onStepClick}
      />,
    );
    await user.click(screen.getByText("spec-understand"));
    expect(onStepClick).toHaveBeenCalledWith("s1");
  });

  it("does not call onStepClick for pending steps", async () => {
    const onStepClick = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkflowTab
        steps={steps}
        currentStepId="s2"
        stepHistory={[stepHistory[0]]}
        onStepClick={onStepClick}
      />,
    );
    await user.click(screen.getByText("implementation"));
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it("shows empty state when no workflow", () => {
    render(<WorkflowTab steps={[]} currentStepId={null} stepHistory={[]} onStepClick={vi.fn()} />);
    expect(screen.getByText(/no workflow/i)).toBeInTheDocument();
  });
});
