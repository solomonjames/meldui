import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityBar } from "@/features/workflow/components/shared/activity-bar";
import { emptyStepOutput } from "@/features/workflow/stores/streaming-store";

describe("ActivityBar timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 0:00 when queryStartedAt is null", () => {
    render(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={true}
        queryStartedAt={null}
        stepName="Implement"
      />,
    );
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("shows elapsed time based on queryStartedAt", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { rerender } = render(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={true}
        queryStartedAt={now - 65_000} // 65 seconds ago
        stepName="Implement"
      />,
    );

    // Should show 1:05
    expect(screen.getByText("1:05")).toBeInTheDocument();

    // Advance timer by 5 seconds
    vi.advanceTimersByTime(5000);
    rerender(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={true}
        queryStartedAt={now - 65_000}
        stepName="Implement"
      />,
    );
    expect(screen.getByText("1:10")).toBeInTheDocument();
  });

  it("resets when queryStartedAt changes (simulating ticket switch)", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Ticket A started 2 minutes ago
    const { rerender } = render(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={true}
        queryStartedAt={now - 120_000}
        stepName="Implement"
      />,
    );
    expect(screen.getByText("2:00")).toBeInTheDocument();

    // Switch to ticket B which started 10 seconds ago
    rerender(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={true}
        queryStartedAt={now - 10_000}
        stepName="Research"
      />,
    );
    expect(screen.getByText("0:10")).toBeInTheDocument();
  });

  it("is hidden when not executing", () => {
    const { container } = render(
      <ActivityBar
        stepOutput={emptyStepOutput()}
        isExecuting={false}
        queryStartedAt={null}
        stepName="Implement"
      />,
    );
    // Should render the hidden placeholder div
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("h-0");
    expect(div.className).toContain("opacity-0");
  });

  it("is hidden when result is available", () => {
    const output = emptyStepOutput();
    output.resultContent = "done";

    const { container } = render(
      <ActivityBar
        stepOutput={output}
        isExecuting={true}
        queryStartedAt={Date.now()}
        stepName="Implement"
      />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("h-0");
  });
});
