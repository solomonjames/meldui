import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BeadsIssue, BeadsStatus } from "@/types";

export function useBeads(projectDir: string) {
  const [status, setStatus] = useState<BeadsStatus | null>(null);
  const [issues, setIssues] = useState<BeadsIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<string>("beads_status", { projectDir });
      setStatus(JSON.parse(result));
    } catch (err) {
      setStatus({
        installed: false,
        initialized: false,
        message: `Error: ${err}`,
      });
    }
  }, [projectDir]);

  const initBeads = useCallback(async () => {
    try {
      await invoke<string>("beads_init", { projectDir });
      await checkStatus();
      await refreshIssues();
    } catch (err) {
      setError(`Init failed: ${err}`);
    }
  }, [projectDir, checkStatus]);

  const refreshIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<BeadsIssue[]>("beads_list", {
        projectDir,
        showAll: true,
      });
      setIssues(result);
    } catch (err) {
      setError(`Failed to load issues: ${err}`);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  const createIssue = useCallback(
    async (
      title: string,
      description?: string,
      issueType?: string,
      priority?: string
    ) => {
      try {
        const issue = await invoke<BeadsIssue>("beads_create", {
          projectDir,
          title,
          description: description || undefined,
          issueType: issueType || "task",
          priority: priority || "2",
        });
        await refreshIssues();
        return issue;
      } catch (err) {
        setError(`Create failed: ${err}`);
        return null;
      }
    },
    [projectDir, refreshIssues]
  );

  const updateIssue = useCallback(
    async (
      id: string,
      updates: {
        title?: string;
        status?: string;
        priority?: string;
        description?: string;
      }
    ) => {
      try {
        await invoke("beads_update", {
          projectDir,
          id,
          ...updates,
        });
        await refreshIssues();
      } catch (err) {
        setError(`Update failed: ${err}`);
      }
    },
    [projectDir, refreshIssues]
  );

  const closeIssue = useCallback(
    async (id: string, reason?: string) => {
      try {
        await invoke("beads_close", {
          projectDir,
          id,
          reason,
        });
        await refreshIssues();
      } catch (err) {
        setError(`Close failed: ${err}`);
      }
    },
    [projectDir, refreshIssues]
  );

  const showIssue = useCallback(
    async (id: string): Promise<BeadsIssue | null> => {
      try {
        const result = await invoke<BeadsIssue[]>("beads_show", {
          projectDir,
          id,
        });
        return result[0] ?? null;
      } catch (err) {
        setError(`Show failed: ${err}`);
        return null;
      }
    },
    [projectDir]
  );

  const deleteIssue = useCallback(
    async (id: string) => {
      try {
        await invoke("beads_delete", { projectDir, id });
        await refreshIssues();
      } catch (err) {
        setError(`Delete failed: ${err}`);
      }
    },
    [projectDir, refreshIssues]
  );

  const addComment = useCallback(
    async (id: string, text: string) => {
      try {
        await invoke("beads_add_comment", { projectDir, id, text });
      } catch (err) {
        setError(`Add comment failed: ${err}`);
      }
    },
    [projectDir]
  );

  const getIssuesByStatus = useCallback(
    (filterStatus: string) => {
      return issues.filter((i) => i.status === filterStatus);
    },
    [issues]
  );

  return {
    status,
    issues,
    loading,
    error,
    checkStatus,
    initBeads,
    refreshIssues,
    createIssue,
    updateIssue,
    closeIssue,
    showIssue,
    deleteIssue,
    addComment,
    getIssuesByStatus,
  };
}
