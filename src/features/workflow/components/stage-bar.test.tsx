import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageBar } from "@/features/workflow/components/stage-bar";

const steps = [
  {
    id: "step-1",
    name: "Understand",
    description: "",
    instructions: { prompt: "" },
    view: "chat" as const,
  },
  {
    id: "step-2",
    name: "Implement",
    description: "",
    instructions: { prompt: "" },
    view: "chat" as const,
  },
];

describe("StageBar auto-advance toggle", () => {
  it("renders the auto-advance toggle", () => {
    render(
      <StageBar
        steps={steps}
        currentStepId="step-1"
        stepHistory={[]}
        autoAdvance={false}
        onAutoAdvanceChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("switch", { name: "Auto" })).toBeInTheDocument();
  });

  it("calls onAutoAdvanceChange when toggled", () => {
    const onChange = vi.fn();
    render(
      <StageBar
        steps={steps}
        currentStepId="step-1"
        stepHistory={[]}
        autoAdvance={false}
        onAutoAdvanceChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows checked state when autoAdvance is true", () => {
    render(
      <StageBar
        steps={steps}
        currentStepId="step-1"
        stepHistory={[]}
        autoAdvance={true}
        onAutoAdvanceChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("data-checked");
  });
});
