import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { AgentConfig } from "@/shared/types";

const AGENT_CONFIG_KEY = ["agent", "config"] as const;

const DEFAULT_CONFIG: AgentConfig = {
  model: "claude-opus-4-6",
  availableModels: [
    "claude-opus-4-6-1m",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ],
  tools: [],
  slashCommands: [],
  skills: [],
  mcpServers: [],
  thinking: { type: "adaptive" },
  effort: "high",
  fastMode: false,
};

export function useAgentConfig() {
  const queryClient = useQueryClient();

  const { data: config = DEFAULT_CONFIG } = useQuery({
    queryKey: AGENT_CONFIG_KEY,
    queryFn: () => queryClient.getQueryData<AgentConfig>(AGENT_CONFIG_KEY) ?? DEFAULT_CONFIG,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Listen for AgentInitMetadata Tauri event (tauri-specta: PascalCase → kebab-case)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{
      model: string;
      available_models: string[];
      tools: string[];
      slash_commands: string[];
      skills: string[];
      mcp_servers: Array<{ name: string; status: string }>;
    }>("agent-init-metadata", (event) => {
      if (cancelled) return;
      const metadata = event.payload;
      queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, (prev) => ({
        ...(prev ?? DEFAULT_CONFIG),
        model: metadata.model,
        availableModels: metadata.available_models,
        tools: metadata.tools,
        slashCommands: metadata.slash_commands,
        skills: metadata.skills,
        mcpServers: metadata.mcp_servers,
      }));
    })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[useAgentConfig] listen() failed:", err);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  const setModel = useMutation({
    mutationFn: (model: string) => invoke("agent_set_model", { model }),
    onSuccess: (_, model) => {
      queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, (prev) => ({
        ...(prev ?? DEFAULT_CONFIG),
        model,
      }));
    },
  });

  const setThinking = useMutation({
    mutationFn: (params: { type: "adaptive" | "enabled" | "disabled"; budgetTokens?: number }) =>
      invoke("agent_set_thinking", {
        thinkingType: params.type,
        budgetTokens: params.budgetTokens ?? null,
      }),
    onSuccess: (_, params) => {
      queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, (prev) => ({
        ...(prev ?? DEFAULT_CONFIG),
        thinking: params,
      }));
    },
  });

  const setEffort = useMutation({
    mutationFn: (effort: "low" | "medium" | "high" | "max") =>
      invoke("agent_set_effort", { effort }),
    onSuccess: (_, effort) => {
      queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, (prev) => ({
        ...(prev ?? DEFAULT_CONFIG),
        effort,
      }));
    },
  });

  const setFastMode = useMutation({
    mutationFn: (enabled: boolean) => invoke("agent_set_fast_mode", { enabled }),
    onSuccess: (_, enabled) => {
      queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, (prev) => ({
        ...(prev ?? DEFAULT_CONFIG),
        fastMode: enabled,
      }));
    },
  });

  return {
    config,
    setModel: setModel.mutate,
    setThinking: setThinking.mutate,
    setEffort: setEffort.mutate,
    setFastMode: setFastMode.mutate,
  };
}
