import { commands } from "@/bindings";
import { orchestrationStoreFactory } from "@/features/workflow/stores/orchestration-store";
import type { BranchInfo, DiffFile } from "@/shared/types";

export async function fetchWorkflowState(projectDir: string, issueId: string) {
  try {
    const state = await commands.workflowState(projectDir, issueId);
    if (state) {
      orchestrationStoreFactory.getStore(issueId).getState().setWorkflowState(state);
    }
    return state;
  } catch (err) {
    orchestrationStoreFactory
      .getStore(issueId)
      .getState()
      .setError(`Failed to get workflow state: ${err}`);
    return null;
  }
}

export async function fetchDiff(
  projectDir: string,
  dirOverride?: string,
  baseCommit?: string,
): Promise<DiffFile[]> {
  try {
    return await commands.workflowGetDiff(dirOverride ?? projectDir, baseCommit ?? null);
  } catch {
    return [];
  }
}

export async function fetchBranchInfo(
  projectDir: string,
  dirOverride?: string,
): Promise<BranchInfo | null> {
  try {
    return await commands.workflowGetBranchInfo(dirOverride ?? projectDir);
  } catch {
    return null;
  }
}
