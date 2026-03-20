import { createContext, useContext } from "react";
import type { useWorkflow } from "@/features/workflow/hooks/use-workflow";

export type WorkflowContextValue = ReturnType<typeof useWorkflow>;

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function WorkflowProvider({
  workflow,
  children,
}: {
  workflow: WorkflowContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkflowContext.Provider value={workflow}>
      {children}
    </WorkflowContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkflowContext(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error("useWorkflowContext must be used within a WorkflowProvider");
  }
  return ctx;
}
