import { Channel } from "@tauri-apps/api/core";
import { streamingStoreFactory } from "@/features/workflow/stores/streaming-store";
import type { StreamChunk } from "@/shared/types";

/**
 * Tracks which step is currently executing per ticket.
 * Actions set this before starting execution and clear it when done.
 * The stream channel reads it to route chunks to the correct step output.
 */
export const executingSteps: Record<string, string | null> = {};

/**
 * Creates a Tauri Channel that routes StreamChunks to the correct
 * per-ticket streaming store based on the currently executing step.
 */
export function createStreamChannel(): Channel<StreamChunk> {
  const channel = new Channel<StreamChunk>();

  channel.onmessage = (chunk: StreamChunk) => {
    const stepId = executingSteps[chunk.issue_id];
    if (!stepId) return;

    const store = streamingStoreFactory.getStore(chunk.issue_id);
    store.getState().handleChunk(stepId, chunk);
  };

  return channel;
}
