import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type { WorkflowState } from "@/shared/types";

export interface OrchestrationState {
  workflowState: WorkflowState | null;
  loading: boolean;
  error: string | null;
  listenersReady: boolean;
  setWorkflowState: (state: WorkflowState | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setListenersReady: (ready: boolean) => void;
  clearState: () => void;
}

export const orchestrationStoreFactory = createTicketStoreFactory<OrchestrationState>((set) => ({
  workflowState: null,
  loading: false,
  error: null,
  listenersReady: false,
  setWorkflowState: (state) => set({ workflowState: state }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setListenersReady: (ready) => set({ listenersReady: ready }),
  clearState: () => set({ workflowState: null, loading: false, error: null }),
}));
