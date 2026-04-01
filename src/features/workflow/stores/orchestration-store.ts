import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type { WorkflowState } from "@/shared/types";

export interface OrchestrationState {
  workflowState: WorkflowState | null;
  loading: boolean;
  error: string | null;
  listenersReady: boolean;
  autoAdvance: boolean;
  /** Timestamp (ms) when the current query started, null when idle. */
  queryStartedAt: number | null;
  setWorkflowState: (state: WorkflowState | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setListenersReady: (ready: boolean) => void;
  setAutoAdvance: (enabled: boolean) => void;
  setQueryStartedAt: (time: number | null) => void;
  clearState: () => void;
}

export const orchestrationStoreFactory = createTicketStoreFactory<OrchestrationState>(
  "orchestration",
  (set) => ({
    workflowState: null,
    loading: false,
    error: null,
    listenersReady: false,
    autoAdvance: false,
    queryStartedAt: null,
    setWorkflowState: (state) => set({ workflowState: state }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setListenersReady: (ready) => set({ listenersReady: ready }),
    setAutoAdvance: (enabled) => set({ autoAdvance: enabled }),
    setQueryStartedAt: (time) => set({ queryStartedAt: time }),
    clearState: () =>
      set({ workflowState: null, loading: false, error: null, queryStartedAt: null }),
  }),
);
