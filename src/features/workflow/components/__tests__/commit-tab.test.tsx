import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitTab } from "@/features/workflow/components/commit-tab";
import type { Ticket } from "@/shared/types";

describe("CommitTab", () => {
  const defaultProps = {
    ticket: { id: "t1", title: "Fix auth bug", metadata: {} } as Ticket,
    onGetDiff: vi.fn().mockResolvedValue([]),
    onGetBranchInfo: vi.fn().mockResolvedValue({ branch: "feat/auth", remote_tracking: null }),
    onExecuteCommitAction: vi.fn(),
    onCleanupWorktree: vi.fn(),
    onNavigateToBacklog: vi.fn(),
    onRefreshTicket: vi.fn(),
  };

  it("shows empty state when no changes", async () => {
    render(<CommitTab {...defaultProps} />);
    expect(await screen.findByText(/nothing to commit/i)).toBeInTheDocument();
  });

  it("renders commit interface when changes exist", async () => {
    const props = {
      ...defaultProps,
      onGetDiff: vi
        .fn()
        .mockResolvedValue([
          { path: "src/auth.ts", status: "modified", additions: 5, deletions: 2, hunks: [] },
        ]),
    };
    render(<CommitTab {...props} />);
    expect(await screen.findByText("src/auth.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit only/i })).toBeInTheDocument();
  });
});
