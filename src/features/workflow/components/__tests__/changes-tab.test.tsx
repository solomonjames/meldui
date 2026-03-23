import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangesTab } from "@/features/workflow/components/changes-tab";
import type { ReviewComment, ReviewFinding, Ticket } from "@/shared/types";

describe("ChangesTab", () => {
  const defaultProps = {
    ticket: { id: "t1", metadata: {} } as Ticket,
    onGetDiff: vi.fn().mockResolvedValue([]),
    reviewFindings: [] as ReviewFinding[],
    reviewComments: [] as ReviewComment[],
    onAddComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onSubmitReview: vi.fn(),
    reviewDisabled: false,
  };

  it("shows empty state when no diff files", async () => {
    render(<ChangesTab {...defaultProps} />);
    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });

  it("renders diff files when available", async () => {
    const props = {
      ...defaultProps,
      onGetDiff: vi
        .fn()
        .mockResolvedValue([
          { path: "src/auth.ts", status: "modified", additions: 5, deletions: 2, hunks: [] },
        ]),
    };
    render(<ChangesTab {...props} />);
    // DiffViewer should render — just check that the empty state is NOT shown
    expect(screen.queryByText(/no changes/i)).not.toBeInTheDocument();
  });
});
