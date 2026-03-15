import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Ticket } from "@/lib/tickets";

export function useSync(projectDir: string) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pullFromExternal = useCallback(async (): Promise<Ticket[]> => {
    setSyncing(true);
    setError(null);
    try {
      const result = await invoke<Ticket[]>("sync_pull_all", { projectDir });
      setLastSync(new Date().toISOString());
      return result;
    } catch (err) {
      setError(`Sync pull failed: ${err}`);
      return [];
    } finally {
      setSyncing(false);
    }
  }, [projectDir]);

  const pushTicket = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        return await invoke<string>("sync_push_ticket", { projectDir, id });
      } catch (err) {
        setError(`Sync push failed: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  return {
    syncing,
    lastSync,
    error,
    pullFromExternal,
    pushTicket,
  };
}
