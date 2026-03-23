# Chat-First Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all workflow steps into a chat-based timeline with always-available Changes and Commit tabs, moving workflow navigation to the right panel.

**Architecture:** Replace per-step view routing in WorkflowShell with a tab container (Chat | Changes | Commit). The right panel gains Ticket/Workflow tabs and extends to window top. A compact workflow indicator replaces the StageBar. No backend changes.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, Tauri v2

**Spec:** `docs/superpowers/specs/2026-03-23-chat-first-workflow-design.md`

---

## File Structure

### New Files
- `src/features/workflow/components/compact-workflow-indicator.tsx` — Pill-shaped progress dots + step name + count + auto toggle
- `src/features/workflow/components/workflow-tab.tsx` — Vertical step list for right panel, click-to-scroll
- `src/features/workflow/components/changes-tab.tsx` — File diffs, inline comments, review findings (absorbs diff-review-view)
- `src/features/workflow/components/commit-tab.tsx` — Commit message, file list, push/PR actions (absorbs commit-view)

### Modified Files
- `src/app/ticket-page.tsx` — ResizablePanelGroup restructured so right panel extends to window top
- `src/features/tickets/components/ticket-details-panel.tsx` — Gains Ticket/Workflow tab bar
- `src/features/workflow/components/workflow-shell.tsx` — Becomes tab container (Chat | Changes | Commit), removes StageBar and view switch
- `src/features/workflow/components/views/chat-view.tsx` — Absorbs ProgressView streaming, handles both interactive and hands-off steps

### Removed Files (after migration complete)
- `src/features/workflow/components/stage-bar.tsx`
- `src/features/workflow/components/views/progress-view.tsx`
- `src/features/workflow/components/views/review-view.tsx`
- `src/features/workflow/components/views/diff-review-view.tsx`
- `src/features/workflow/components/views/commit-view.tsx`

### Test Files
- `src/features/workflow/components/__tests__/compact-workflow-indicator.test.tsx`
- `src/features/workflow/components/__tests__/workflow-tab.test.tsx`
- `src/features/workflow/components/__tests__/changes-tab.test.tsx`
- `src/features/workflow/components/__tests__/commit-tab.test.tsx`
- `src/features/workflow/components/__tests__/workflow-shell.test.tsx`

---

## Task 1: CompactWorkflowIndicator Component

**Files:**
- Create: `src/features/workflow/components/compact-workflow-indicator.tsx`
- Create: `src/features/workflow/components/__tests__/compact-workflow-indicator.test.tsx`

This is a standalone presentational component with no dependencies on the refactor, so it can be built first.

- [ ] **Step 1: Write the failing test**

```tsx
// compact-workflow-indicator.test.tsx
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
    // First 2 completed (filled)
    expect(dots[0]).toHaveAttribute("data-completed", "true");
    expect(dots[1]).toHaveAttribute("data-completed", "true");
    // Remaining uncompleted
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
    expect(defaultProps.onAutoAdvanceChange).toHaveBeenCalledWith(false);
  });

  it("does not render when no steps provided", () => {
    const { container } = render(
      <CompactWorkflowIndicator {...defaultProps} steps={[]} currentStepId={null} completedStepIds={[]} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --run src/features/workflow/components/__tests__/compact-workflow-indicator.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// compact-workflow-indicator.tsx
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";

interface CompactWorkflowIndicatorProps {
  steps: Array<{ id: string; name: string }>;
  currentStepId: string | null;
  completedStepIds: string[];
  autoAdvance: boolean;
  onAutoAdvanceChange: (value: boolean) => void;
}

export function CompactWorkflowIndicator({
  steps,
  currentStepId,
  completedStepIds,
  autoAdvance,
  onAutoAdvanceChange,
}: CompactWorkflowIndicatorProps) {
  if (steps.length === 0 || !currentStepId) return null;

  const currentIndex = steps.findIndex((s) => s.id === currentStepId);
  const currentStep = steps[currentIndex];
  const completedSet = new Set(completedStepIds);

  return (
    <div className="flex items-center justify-center gap-2.5 rounded-full border border-border bg-muted/50 px-5 py-2">
      <div className="flex items-center gap-1">
        {steps.map((step) => (
          <div
            key={step.id}
            data-testid={`step-dot-${step.id}`}
            data-completed={completedSet.has(step.id) ? "true" : "false"}
            className={`h-2 w-2 rounded-full ${
              completedSet.has(step.id)
                ? "bg-emerald-500"
                : "border-[1.5px] border-muted-foreground/40 bg-muted"
            }`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-foreground">{currentStep?.name}</span>
      <span className="font-mono text-xs text-muted-foreground">
        [{currentIndex + 1}/{steps.length}]
      </span>
      <div className="h-4 w-px bg-border" />
      <Label htmlFor="auto-advance-compact" className="text-xs text-muted-foreground">
        auto
      </Label>
      <Switch
        id="auto-advance-compact"
        checked={autoAdvance}
        onCheckedChange={onAutoAdvanceChange}
        className="data-[state=checked]:bg-emerald-500"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --run src/features/workflow/components/__tests__/compact-workflow-indicator.test.tsx`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/components/compact-workflow-indicator.tsx src/features/workflow/components/__tests__/compact-workflow-indicator.test.tsx
git commit -m "feat: add CompactWorkflowIndicator component"
```

---

## Task 2: WorkflowTab Component

**Files:**
- Create: `src/features/workflow/components/workflow-tab.tsx`
- Create: `src/features/workflow/components/__tests__/workflow-tab.test.tsx`

Standalone component showing vertical step list. The `onStepClick` callback will be wired to chat scroll later.

- [ ] **Step 1: Write the failing test**

```tsx
// workflow-tab.test.tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowTab } from "@/features/workflow/components/workflow-tab";

describe("WorkflowTab", () => {
  const steps = [
    { id: "s1", name: "spec-understand", description: "Capture problem" },
    { id: "s2", name: "spec-investigate", description: "Deep investigation" },
    { id: "s3", name: "implementation", description: "TDD implementation" },
  ];

  const stepHistory = [
    { step_id: "s1", status: "completed", started_at: "2026-03-23T10:00:00Z", completed_at: "2026-03-23T10:05:00Z" },
    { step_id: "s2", status: "completed", started_at: "2026-03-23T10:05:00Z", completed_at: "2026-03-23T10:12:00Z" },
  ];

  it("renders all steps with correct status icons", () => {
    render(
      <WorkflowTab
        steps={steps}
        currentStepId="s3"
        stepHistory={stepHistory}
        onStepClick={vi.fn()}
      />
    );
    expect(screen.getByText("spec-understand")).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
    // Completed steps have checkmark
    expect(screen.getAllByTestId("step-completed")).toHaveLength(2);
    // Current step has active indicator
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
      />
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
      />
    );
    await user.click(screen.getByText("implementation"));
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it("shows empty state when no workflow", () => {
    render(
      <WorkflowTab
        steps={[]}
        currentStepId={null}
        stepHistory={[]}
        onStepClick={vi.fn()}
      />
    );
    expect(screen.getByText(/no workflow/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --run src/features/workflow/components/__tests__/workflow-tab.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// workflow-tab.tsx
import { Check, Circle, CircleDot } from "lucide-react";
import type { StepRecord, WorkflowStep } from "@/shared/types";

interface WorkflowTabProps {
  steps: WorkflowStep[];
  currentStepId: string | null;
  stepHistory: StepRecord[];
  onStepClick: (stepId: string) => void;
}

export function WorkflowTab({
  steps,
  currentStepId,
  stepHistory,
  onStepClick,
}: WorkflowTabProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        No workflow assigned
      </div>
    );
  }

  const completedMap = new Map(
    stepHistory.map((h) => [h.step_id, h])
  );

  return (
    <div className="flex flex-col gap-1 p-2">
      {steps.map((step) => {
        const historyEntry = completedMap.get(step.id);
        const isCompleted = !!historyEntry;
        const isCurrent = step.id === currentStepId;
        const isClickable = isCompleted;

        return (
          <button
            type="button"
            key={step.id}
            onClick={() => isClickable && onStepClick(step.id)}
            disabled={!isClickable}
            data-testid={
              isCompleted ? "step-completed" : isCurrent ? "step-current" : "step-pending"
            }
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-left transition-colors ${
              isCurrent
                ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : isCompleted
                  ? "cursor-pointer text-emerald-400 hover:bg-muted/50"
                  : "cursor-default text-muted-foreground/50"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {isCompleted ? (
                <Check className="h-4 w-4" />
              ) : isCurrent ? (
                <CircleDot className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{step.name}</div>
              {step.description && (
                <div className="text-xs text-muted-foreground/70">{step.description}</div>
              )}
              {historyEntry?.completed_at && (
                <div className="mt-0.5 text-xs text-muted-foreground/50">
                  {new Date(historyEntry.completed_at).toLocaleTimeString()}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --run src/features/workflow/components/__tests__/workflow-tab.test.tsx`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/components/workflow-tab.tsx src/features/workflow/components/__tests__/workflow-tab.test.tsx
git commit -m "feat: add WorkflowTab component for right panel"
```

---

## Task 3: Right Panel — Add Ticket/Workflow Tabs

**Files:**
- Modify: `src/features/tickets/components/ticket-details-panel.tsx`
- Modify: `src/app/ticket-page.tsx`

Wire up the WorkflowTab into the right panel with a Ticket/Workflow tab bar. Restructure ticket-page so the right panel extends to the top of the window.

- [ ] **Step 1: Read current files**

Read `src/features/tickets/components/ticket-details-panel.tsx` and `src/app/ticket-page.tsx` to understand the current structure.

- [ ] **Step 2: Add tab state and tab bar to TicketDetailsPanel**

Add a `Tabs` component (from shadcn) wrapping the panel content. The "Ticket" tab renders the existing panel content. The "Workflow" tab renders the new `WorkflowTab` component.

New props needed on `TicketDetailsPanel`:
```tsx
// Add to existing props interface
workflowSteps?: WorkflowStep[];
currentStepId?: string | null;
stepHistory?: StepRecord[];
onStepClick?: (stepId: string) => void;
```

The tab bar sits at the top of the panel. The existing content (metadata, sections, comments) goes inside the "Ticket" tab. The WorkflowTab component goes inside the "Workflow" tab.

- [ ] **Step 3: Restructure ticket-page.tsx layout**

Currently the right panel sits below the StageBar. Change the `ResizablePanelGroup` so both panels start at the same vertical position (top of the content area, below the window title bar).

Pass workflow-related props through from `ticket-page.tsx` to `TicketDetailsPanel`:
- `workflowSteps` from the workflow definition
- `currentStepId` from workflow state
- `stepHistory` from workflow state
- `onStepClick` — initially a no-op, will be wired to chat scroll in Task 6

- [ ] **Step 4: Verify visually**

Run: `bun run dev`
Check that the right panel now shows two tabs (Ticket | Workflow), that the Workflow tab displays the step list, and that the panel extends to the top of the window.

- [ ] **Step 5: Run existing tests and type check**

Run: `bun run test -- --run && npx tsc --noEmit`
Expected: All existing tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/features/tickets/components/ticket-details-panel.tsx src/app/ticket-page.tsx
git commit -m "feat: add Ticket/Workflow tabs to right panel, extend to window top"
```

---

## Task 4: ChangesTab Component

**Files:**
- Create: `src/features/workflow/components/changes-tab.tsx`
- Create: `src/features/workflow/components/__tests__/changes-tab.test.tsx`
- Reference: `src/features/workflow/components/views/diff-review-view.tsx` (source for logic)

Extract the DiffReviewView functionality into a standalone tab component. This component will be mounted as a tab in WorkflowShell (wired in Task 6).

- [ ] **Step 1: Read the current DiffReviewView**

Read `src/features/workflow/components/views/diff-review-view.tsx` to understand all props, state, and rendering logic.

- [ ] **Step 2: Write the failing test**

```tsx
// changes-tab.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangesTab } from "@/features/workflow/components/changes-tab";

describe("ChangesTab", () => {
  const defaultProps = {
    getDiff: vi.fn().mockResolvedValue([]),
    reviewFindings: null,
    reviewComments: [],
    findingActions: [],
    onAddReviewComment: vi.fn(),
    onDeleteReviewComment: vi.fn(),
    onFindingAction: vi.fn(),
    onSubmitReview: vi.fn(),
    reviewDisabled: false,
    ticket: { id: "t1", metadata: {} } as any,
  };

  it("shows empty state when no diff files", () => {
    render(<ChangesTab {...defaultProps} />);
    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it("renders diff files when available", async () => {
    const props = {
      ...defaultProps,
      getDiff: vi.fn().mockResolvedValue([
        { path: "src/auth.ts", status: "modified", hunks: [] },
      ]),
    };
    render(<ChangesTab {...props} />);
    // Wait for diff to load
    expect(await screen.findByText("src/auth.ts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- --run src/features/workflow/components/__tests__/changes-tab.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Write the ChangesTab component**

Adapt the logic from `diff-review-view.tsx`. Key changes:
- Fetches diff on mount and on an interval/refresh (not gated by review step)
- Uses `worktree_path` and `worktree_base_commit` from ticket metadata for diff source
- Shows empty state when no files changed
- Review findings section only renders when `reviewFindings` is non-null
- Reuses the existing `DiffViewer` component from `@/shared/components/diff` (re-exported from `src/shared/components/diff/index.ts`)
- Review findings are rendered inline (there is no separate `ReviewFindingsPanel` component — follow the inline rendering pattern from `diff-review-view.tsx`)

```tsx
// changes-tab.tsx — scaffold
import { useEffect, useState } from "react";
import { DiffViewer } from "@/shared/components/diff";
import type { DiffFile, FindingAction, ReviewComment, ReviewFinding, ReviewSubmission, Ticket } from "@/shared/types";

interface ChangesTabProps {
  getDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  reviewFindings: ReviewFinding[] | null;
  reviewComments: ReviewComment[];
  findingActions: FindingAction[];
  onAddReviewComment: (filePath: string, lineNumber: number, content: string, suggestion?: string) => void;
  onDeleteReviewComment: (commentId: string) => void;
  onFindingAction: (findingId: string, action: FindingAction["action"]) => void;
  onSubmitReview: (submission: ReviewSubmission) => void;
  reviewDisabled: boolean;
  ticket: Ticket;
}

export function ChangesTab({ getDiff, reviewFindings, reviewComments, findingActions, onAddReviewComment, onDeleteReviewComment, onFindingAction, onSubmitReview, reviewDisabled, ticket }: ChangesTabProps) {
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const worktreePath = ticket.metadata?.worktree_path as string | undefined;
    const baseCommit = ticket.metadata?.worktree_base_commit as string | undefined;
    setLoading(true);
    getDiff(worktreePath, baseCommit)
      .then(setDiffFiles)
      .catch(() => setDiffFiles([]))
      .finally(() => setLoading(false));
  }, [getDiff, ticket.metadata?.worktree_path, ticket.metadata?.worktree_base_commit]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading changes...</div>;
  }

  if (diffFiles.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">No changes yet</div>;
  }

  // DiffViewer handles everything: diff display, inline comments, review findings,
  // finding actions, and approve/request-changes buttons internally.
  // Do NOT render separate approve/request-changes buttons outside DiffViewer.
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <DiffViewer
        files={diffFiles}
        comments={reviewComments}
        findings={reviewFindings ?? []}
        findingActions={findingActions}
        onAddComment={onAddReviewComment}
        onDeleteComment={onDeleteReviewComment}
        onFindingAction={onFindingAction}
        onApprove={(summary) => onSubmitReview({ action: "approve", summary, comments: reviewComments, finding_actions: findingActions.map(fa => ({ finding_id: fa.finding_id, action: fa.action })) })}
        onRequestChanges={(summary) => onSubmitReview({ action: "request_changes", summary, comments: reviewComments, finding_actions: findingActions.map(fa => ({ finding_id: fa.finding_id, action: fa.action })) })}
        disabled={reviewDisabled}
      />
    </div>
  );
}
```

**Important:** Read `src/shared/components/diff/diff-viewer.tsx` and `src/features/workflow/components/views/diff-review-view.tsx` to understand the exact prop interfaces. The DiffViewer import path is `@/shared/components/diff` (NOT `@/features/workflow/components/shared/diff-viewer`). Adapt the review findings rendering from the inline pattern in `diff-review-view.tsx`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- --run src/features/workflow/components/__tests__/changes-tab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/components/changes-tab.tsx src/features/workflow/components/__tests__/changes-tab.test.tsx
git commit -m "feat: add ChangesTab component for always-available diffs"
```

---

## Task 5: CommitTab Component

**Files:**
- Create: `src/features/workflow/components/commit-tab.tsx`
- Create: `src/features/workflow/components/__tests__/commit-tab.test.tsx`
- Reference: `src/features/workflow/components/views/commit-view.tsx` (source for logic)

Extract CommitView functionality into a standalone tab component.

- [ ] **Step 1: Read the current CommitView**

Read `src/features/workflow/components/views/commit-view.tsx` (344 lines) to understand all state, handlers, and rendering.

- [ ] **Step 2: Write the failing test**

```tsx
// commit-tab.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitTab } from "@/features/workflow/components/commit-tab";

describe("CommitTab", () => {
  const defaultProps = {
    ticket: { id: "t1", title: "Fix auth bug", metadata: {} } as any,
    getDiff: vi.fn().mockResolvedValue([]),
    getBranchInfo: vi.fn().mockResolvedValue({ branch: "feat/auth", remote: null }),
    executeCommitAction: vi.fn(),
    cleanupWorktree: vi.fn(),
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
      getDiff: vi.fn().mockResolvedValue([
        { path: "src/auth.ts", status: "modified", hunks: [] },
      ]),
    };
    render(<CommitTab {...props} />);
    expect(await screen.findByText("src/auth.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- --run src/features/workflow/components/__tests__/commit-tab.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Write the CommitTab component**

Adapt from `commit-view.tsx` (344 lines). The key structural change: CommitTab fetches its own data on mount rather than receiving it from a step response.

```tsx
// commit-tab.tsx — scaffold
import { useCallback, useEffect, useState } from "react";
import { FileText, GitBranch, GitCommit, Loader2, Plus, Minus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import type { BranchInfo, CommitActionResult, DiffFile, Ticket } from "@/shared/types";

interface CommitTabProps {
  ticket: Ticket;
  /** Agent-generated commit message from the most recent step result, or null */
  agentCommitMessage?: string | null;
  getDiff: (dirOverride?: string, baseCommit?: string) => Promise<DiffFile[]>;
  getBranchInfo: (dirOverride?: string) => Promise<BranchInfo>;
  executeCommitAction: (action: string, message: string, ticketId: string) => Promise<CommitActionResult>;
  cleanupWorktree: (ticketId: string) => Promise<void>;
  onNavigateToBacklog: () => void;
  onRefreshTicket: () => Promise<void>;
}

export function CommitTab({
  ticket, getDiff, getBranchInfo, executeCommitAction,
  agentCommitMessage, cleanupWorktree, onNavigateToBacklog, onRefreshTicket,
}: CommitTabProps) {
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null);
  // Use agent-generated message if available, fall back to ticket title
  const [commitMessage, setCommitMessage] = useState(agentCommitMessage ?? ticket.title ?? "");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<CommitActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch diff and branch info on mount
  useEffect(() => {
    const worktreePath = ticket.metadata?.worktree_path as string | undefined;
    const baseCommit = ticket.metadata?.worktree_base_commit as string | undefined;
    setLoading(true);
    Promise.all([
      getDiff(worktreePath, baseCommit),
      getBranchInfo(worktreePath),
    ])
      .then(([files, branch]) => {
        setDiffFiles(files);
        setBranchInfo(branch);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [getDiff, getBranchInfo, ticket.metadata?.worktree_path, ticket.metadata?.worktree_base_commit]);

  const handleCommit = useCallback(async (action: "commit" | "commit_and_pr") => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await executeCommitAction(action, commitMessage, ticket.id);
      setResult(res);
      await onRefreshTicket();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(false);
    }
  }, [executeCommitAction, commitMessage, ticket.id, onRefreshTicket]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</div>;
  }

  if (diffFiles.length === 0 && !result) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Nothing to commit</div>;
  }

  // Adapt the full rendering from commit-view.tsx:
  // - Stat cards (files changed, additions, deletions)
  // - Commit message textarea
  // - Expandable file list
  // - Action buttons (Commit Only / Create Pull Request)
  // - Success/error states with commit hash, PR URL
  // - Worktree cleanup option
  // Follow commit-view.tsx lines 115-344 for the exact layout
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
      {/* ... adapt full rendering from commit-view.tsx */}
    </div>
  );
}
```

**Key patterns to preserve from `commit-view.tsx`:**
- Stat cards computing `totalAdditions`/`totalDeletions` from `diffFiles` (lines 87-91)
- `commitMessage` textarea with the agent response as default (lines 181-198)
- File list with expandable sections (lines 200-236)
- Commit action handler with loading spinner (lines 93-113)
- Success state showing commit hash + optional PR URL (lines 239-284)
- Worktree cleanup button (lines 286-324)
- Error state with retry (lines 326-342)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- --run src/features/workflow/components/__tests__/commit-tab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/components/commit-tab.tsx src/features/workflow/components/__tests__/commit-tab.test.tsx
git commit -m "feat: add CommitTab component for always-available commits"
```

---

## Task 6: Refactor WorkflowShell — Tab Container + Compact Indicator

**Files:**
- Modify: `src/features/workflow/components/workflow-shell.tsx`
- Create: `src/features/workflow/components/__tests__/workflow-shell.test.tsx`

This is the core integration task. WorkflowShell becomes a tab container rendering Chat | Changes | Commit, with the CompactWorkflowIndicator in the footer.

- [ ] **Step 1: Read workflow-shell.tsx in full**

Read `src/features/workflow/components/workflow-shell.tsx` (399 lines). Note the view switch at lines 250-321, StageBar usage at lines 216 and 331, and auto-advance logic at lines 173-198.

- [ ] **Step 2: Write the failing test**

WorkflowShell has deep dependencies (WorkflowContext, Tauri commands, TanStack Query). Read `src/features/workflow/context.tsx` to understand `WorkflowContextValue` and what needs mocking. Check `src/shared/test/` for existing test helpers (mock providers, etc.).

Create a mock wrapper that provides a minimal `WorkflowContext`:

```tsx
// workflow-shell.test.tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { WorkflowProvider } from "@/features/workflow/context";
import { WorkflowShell } from "@/features/workflow/components/workflow-shell";

// WorkflowContext is NOT exported — only WorkflowProvider and useWorkflowContext are.
// Read context.tsx to understand WorkflowProvider's props and build a mock workflow object.
// WorkflowProvider wraps the useWorkflow() hook, so you need to either:
// (a) Mock the underlying Tauri commands that useWorkflow depends on, or
// (b) Check if WorkflowProvider accepts a `workflow` prop for testing
//
// Minimum required state: currentState, stepOutputs, autoAdvance, setAutoAdvance,
// all mutation fns (executeStep, advanceStep, etc.), all sub-hook returns.
// Check src/shared/test/ for existing mock factories.

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The exact wrapping depends on how WorkflowProvider is structured.
  // If it takes a `value` override prop, use that. Otherwise, mock the
  // Tauri invoke commands it calls internally.
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe("WorkflowShell tabs", () => {
  it("renders Chat, Changes, and Commit tabs", () => {
    renderWithProviders(
      <WorkflowShell
        ticket={{ id: "t1", title: "Test", metadata: {} } as any}
        projectDir="/test"
        onNavigateToBacklog={vi.fn()}
        onRefreshTicket={vi.fn()}
      />
    );
    expect(screen.getByRole("tab", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /changes/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /commit/i })).toBeInTheDocument();
  });

  it("defaults to Chat tab", () => {
    renderWithProviders(
      <WorkflowShell
        ticket={{ id: "t1", title: "Test", metadata: {} } as any}
        projectDir="/test"
        onNavigateToBacklog={vi.fn()}
        onRefreshTicket={vi.fn()}
      />
    );
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute("data-state", "active");
  });
});
```

**Note:** The mock context is intentionally incomplete here — read `context.tsx` for the full `WorkflowContextValue` interface and populate all required fields. The mock also needs to handle the workflow definition query (for steps). Check if there are existing mock factories in `src/shared/test/`.

- [ ] **Step 3: Replace view switch with tab container**

In `workflow-shell.tsx`:

1. **Remove** the `StageBar` import and both render sites (lines 216, 331)
2. **Remove** the `renderView()` function (lines 207-322) and the view switch statement
3. **Add** tab state: `const [activeTab, setActiveTab] = useState<"chat" | "changes" | "commit">("chat")`
4. **Add** the tab bar at the top of the content area:
   ```tsx
   <Tabs value={activeTab} onValueChange={setActiveTab}>
     <TabsList>
       <TabsTrigger value="chat">Chat</TabsTrigger>
       <TabsTrigger value="changes">Changes</TabsTrigger>
       <TabsTrigger value="commit">Commit</TabsTrigger>
     </TabsList>
   </Tabs>
   ```
5. **Render tab content** conditionally:
   - `chat`: Render ChatView (existing, will be enhanced in Task 7)
   - `changes`: Render ChangesTab (from Task 4) — pass `findingActions` state and all review callbacks
   - `commit`: Render CommitTab (from Task 5) — pass `agentCommitMessage` from the latest step result's `response` field (available via `lastResult?.response` in WorkflowShell state). This is how the current CommitView receives its pre-populated commit message.
6. **Add** CompactWorkflowIndicator above the chat input (only visible on chat tab)
7. **Add** `scrollToStep` callback: Accepts a step ID, finds the step divider element in the chat timeline by `data-step-id` attribute, calls `scrollIntoView({ behavior: "smooth" })`. Pass this to `ticket-page.tsx` → `TicketDetailsPanel` → `WorkflowTab` via props.

The auto-execute and auto-advance logic remain unchanged — they operate on the workflow state machine, not the view.

**Step complete card:** The existing `StepCompleteCard` in ChatView (showing "Continue Chatting" / "Next Step" buttons when a step finishes and auto-advance is off) remains unchanged — it already lives in the chat timeline. No new work needed here; just ensure the `onAdvanceStep` callback is still wired through.

**Tab auto-switching for `diff_review` and `commit` steps:** When the current step's view type is `diff_review`, auto-switch `activeTab` to `"changes"`. When it's `"commit"`, auto-switch to `"commit"`. Add a `useEffect` watching the current step's view type:
```tsx
useEffect(() => {
  if (currentStep?.view === "diff_review") setActiveTab("changes");
  else if (currentStep?.view === "commit") setActiveTab("commit");
}, [currentStep?.view]);
```

- [ ] **Step 4: Update test with real assertions**

Update the test to verify:
- Tab bar renders with all three tabs
- Switching tabs changes content
- CompactWorkflowIndicator renders when workflow is active

- [ ] **Step 5: Run tests and type check**

Run: `bun run test -- --run && npx tsc --noEmit`
Expected: All tests pass, no type errors

- [ ] **Step 6: Verify visually**

Run: `bun run dev`
Check: Three tabs visible, switching works, compact indicator shows above chat input, auto-advance still works.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/components/workflow-shell.tsx src/features/workflow/components/__tests__/workflow-shell.test.tsx
git commit -m "feat: replace view switch with Chat/Changes/Commit tabs and compact indicator"
```

---

## Task 7: Unify ChatView — Absorb ProgressView

**Files:**
- Modify: `src/features/workflow/components/views/chat-view.tsx`
- Reference: `src/features/workflow/components/views/progress-view.tsx`

ChatView needs to handle both interactive (chat) and hands-off (progress) steps. The key difference is whether the input is active during execution.

- [ ] **Step 1: Read both ChatView and ProgressView**

Read `src/features/workflow/components/views/chat-view.tsx` (285 lines) and `src/features/workflow/components/views/progress-view.tsx` (184 lines). Identify what ProgressView renders that ChatView doesn't.

- [ ] **Step 2: Add `isInteractive` prop to ChatView**

```tsx
// Add to ChatViewProps
isInteractive: boolean; // true for chat/review steps, false for progress steps
```

When `isInteractive` is false and `isExecuting` is true:
- Hide the chat input textarea
- Still render all content blocks, thinking, permission dialogs, files changed
- Show the input after the step completes (so user can ask follow-ups)

- [ ] **Step 3: Add permission dialog support to ChatView**

ChatView currently doesn't render the `PermissionDialog` component — ProgressView does. Add:

```tsx
// New props
pendingPermission?: PermissionRequest | null;
onRespondToPermission?: (requestId: string, allowed: boolean) => void;
```

Render the permission dialog inline when `pendingPermission` is non-null. Import `PermissionDialog` from `@/features/workflow/components/shared/permission-dialog`.

**Important:** Review ProgressView's permission dialog rendering (lines 98-100 in `progress-view.tsx`) to ensure no queuing, dismissal, or positioning behavior is lost during migration. The permission dialog should appear inline in the chat timeline, above the latest content.

- [ ] **Step 4: Add step divider anchors**

Each step in the conversation history should have a DOM element with `data-step-id={stepId}` for scroll targeting from the WorkflowTab.

Check how `snapshotToBlocks()` and the history rendering work. Add step divider elements at step boundaries in the timeline.

- [ ] **Step 5: Run tests and type check**

Run: `bun run test -- --run && npx tsc --noEmit`
Expected: PASS — existing ChatView tests should still pass (isInteractive defaults to true behavior)

- [ ] **Step 6: Update WorkflowShell to pass new props**

In `workflow-shell.tsx`, when rendering ChatView in the chat tab:
- Pass `isInteractive` based on the step's `view` type (`"chat"` or `"review"` → true, `"progress"` → false)
- Pass `pendingPermission` and `onRespondToPermission` (currently only passed to ProgressView)

- [ ] **Step 7: Verify visually**

Run: `bun run dev`
Test with a workflow that has both `chat` and `progress` steps. Verify:
- Chat steps show input during execution
- Progress steps hide input during execution, show after completion
- Permission dialogs appear inline
- Step dividers visible in timeline

- [ ] **Step 8: Commit**

```bash
git add src/features/workflow/components/views/chat-view.tsx src/features/workflow/components/workflow-shell.tsx
git commit -m "feat: unify ChatView to handle interactive and hands-off steps"
```

---

## Task 8: Wire Up Scroll-to-Step

**Files:**
- Modify: `src/app/ticket-page.tsx`
- Modify: `src/features/tickets/components/ticket-details-panel.tsx`
- Modify: `src/features/workflow/components/workflow-shell.tsx`

Connect the WorkflowTab's `onStepClick` to actually scroll the chat timeline.

- [ ] **Step 1: Add ref-based scroll mechanism in WorkflowShell**

WorkflowShell should expose a `scrollToStep(stepId: string)` function. This finds the element with `[data-step-id="${stepId}"]` in the chat scroll container and calls `scrollIntoView({ behavior: "smooth", block: "start" })`.

Also: if the user clicks a step while on the Changes or Commit tab, switch to the Chat tab first, then scroll.

- [ ] **Step 2: Thread the callback through ticket-page.tsx**

`ticket-page.tsx` needs to pass `scrollToStep` from WorkflowShell to TicketDetailsPanel. Use a ref or callback pattern:

```tsx
const scrollToStepRef = useRef<(stepId: string) => void>(() => {});
// In WorkflowShell, set this ref
// In TicketDetailsPanel, call scrollToStepRef.current(stepId)
```

- [ ] **Step 3: Wire onStepClick in TicketDetailsPanel**

Pass `scrollToStepRef.current` as the `onStepClick` prop to `WorkflowTab` inside `TicketDetailsPanel`.

- [ ] **Step 4: Verify visually**

Run: `bun run dev`
Start a workflow, complete a few steps, then click a completed step in the Workflow tab. Chat should scroll to that step's divider.

- [ ] **Step 5: Commit**

```bash
git add src/app/ticket-page.tsx src/features/tickets/components/ticket-details-panel.tsx src/features/workflow/components/workflow-shell.tsx
git commit -m "feat: wire scroll-to-step from Workflow tab to chat timeline"
```

---

## Task 9: Remove Old Components

**Files:**
- Delete: `src/features/workflow/components/stage-bar.tsx`
- Delete: `src/features/workflow/components/views/progress-view.tsx`
- Delete: `src/features/workflow/components/views/review-view.tsx`
- Delete: `src/features/workflow/components/views/diff-review-view.tsx`
- Delete: `src/features/workflow/components/views/commit-view.tsx`

- [ ] **Step 1: Search for remaining imports**

Use grep to find any remaining imports of `StageBar`, `ProgressView`, `ReviewView`, `DiffReviewView`, or `CommitView` across the codebase. They should all have been removed in prior tasks. If any remain, remove them.

Run: `grep -r "stage-bar\|StageBar\|progress-view\|ProgressView\|review-view\|ReviewView\|diff-review-view\|DiffReviewView\|commit-view\|CommitView" src/ --include="*.tsx" --include="*.ts"`

- [ ] **Step 2: Delete the files**

```bash
rm src/features/workflow/components/stage-bar.tsx
rm src/features/workflow/components/views/progress-view.tsx
rm src/features/workflow/components/views/review-view.tsx
rm src/features/workflow/components/views/diff-review-view.tsx
rm src/features/workflow/components/views/commit-view.tsx
```

- [ ] **Step 3: Run tests and type check**

Run: `bun run test -- --run && npx tsc --noEmit`
Expected: PASS — no remaining references, no type errors

- [ ] **Step 4: Run lint and dead code check**

Run: `bun run lint && bun run knip`
Expected: No lint errors, no new dead code warnings (may have existing ones)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove StageBar, ProgressView, ReviewView (replaced by unified chat)"
```

---

## Task 10: Final Integration Test and Cleanup

**Files:**
- Potentially modify: any files with remaining issues from prior tasks

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `bun run test -- --run`
Expected: PASS

- [ ] **Step 3: Lint and format**

Run: `bun run lint:fix && bun run format`

- [ ] **Step 4: Visual smoke test**

Run: `bun run dev`

Test the following scenarios:
1. Open a ticket with no workflow → Chat tab active, no compact indicator, right panel shows Ticket tab
2. Assign a workflow → Compact indicator appears, Workflow tab populated
3. Execute steps → Chat timeline streams content, step dividers appear
4. Switch to Changes tab mid-execution → Shows current diffs (or empty state)
5. Click a completed step in Workflow tab → Switches to Chat tab and scrolls
6. Switch to Commit tab → Shows commit interface (or empty state)
7. Toggle auto-advance → Works from compact indicator
8. Complete a workflow → All steps show as completed in Workflow tab

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup for chat-first workflow redesign"
```
