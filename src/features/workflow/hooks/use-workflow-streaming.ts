import { Channel } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import type { StreamChunk } from "@/shared/types";

// Stable ID used when no ticket is active — ensures hooks are called unconditionally
const EMPTY_TICKET = "__none__";

export function useWorkflowStreaming(
  _activeTicketId: string | null,
  executingStepsRef: React.MutableRefObject<Record<string, string | null>>,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: executingStepsRef is read at call time
  const createStreamChannel = useCallback((): Channel<StreamChunk> => {
    const channel = new Channel<StreamChunk>();

    channel.onmessage = (chunk: StreamChunk) => {
      const stepId = executingStepsRef.current[chunk.issue_id];
      if (!stepId) return;

      const store = streamingStoreFactory.getStore(chunk.issue_id);
      store.getState().handleChunk(stepId, chunk);
    };

    return channel;
  }, []);

  const getStepOutput = useCallback((issueId: string, stepId: string) => {
    return streamingStoreFactory.getStore(issueId).getState().getStepOutput(issueId, stepId);
  }, []);

  const clearTicketOutputs = useCallback((issueId: string) => {
    streamingStoreFactory.getStore(issueId).getState().clearStepOutputs();
  }, []);

  // Reactive store subscription (always called — rules of hooks)
  const storeId = _activeTicketId ?? EMPTY_TICKET;
  const stepOutputs = streamingStoreFactory.useTicketStore(storeId, (s) => s.stepOutputs);

  return {
    stepOutputs: _activeTicketId ? stepOutputs : {},
    getStepOutput,
    createStreamChannel,
    streamingReady: true as const,
    clearTicketOutputs,
  };
}
