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
  /** True while the supervisor is actively evaluating or replying for this ticket. */
  supervisorActive: boolean;
  /** True while the supervisor is evaluating (typing indicator). */
  supervisorEvaluating: boolean;
  setWorkflowState: (state: WorkflowState | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setListenersReady: (ready: boolean) => void;
  setAutoAdvance: (enabled: boolean) => void;
  setQueryStartedAt: (time: number | null) => void;
  setSupervisorActive: (active: boolean) => void;
  setSupervisorEvaluating: (evaluating: boolean) => void;
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
    supervisorActive: false,
    supervisorEvaluating: false,
    setWorkflowState: (state) => set({ workflowState: state }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setListenersReady: (ready) => set({ listenersReady: ready }),
    setAutoAdvance: (enabled) => set({ autoAdvance: enabled }),
    setQueryStartedAt: (time) => set({ queryStartedAt: time }),
    setSupervisorActive: (active) => set({ supervisorActive: active }),
    setSupervisorEvaluating: (evaluating) => set({ supervisorEvaluating: evaluating }),
    clearState: () =>
      set({
        workflowState: null,
        loading: false,
        error: null,
        queryStartedAt: null,
        supervisorActive: false,
        supervisorEvaluating: false,
      }),
  }),
);
