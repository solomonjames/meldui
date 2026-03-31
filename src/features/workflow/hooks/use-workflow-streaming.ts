import { Channel } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import type { StreamChunk } from "@/shared/types";

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

  // Subscribe to all step outputs across all ticket stores.
  // For backward compatibility, collect stepOutputs from the active ticket.
  // Components should migrate to using streamingStoreFactory.useTicketStore() directly.
  const stepOutputs = _activeTicketId
    ? streamingStoreFactory.getStore(_activeTicketId).getState().stepOutputs
    : {};

  return {
    stepOutputs,
    getStepOutput,
    createStreamChannel,
    streamingReady: true as const,
    clearTicketOutputs,
  };
}
