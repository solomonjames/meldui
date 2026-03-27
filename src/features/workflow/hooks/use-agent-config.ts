import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { commands, events } from "@/bindings";
import type { AgentConfig } from "@/shared/types";

const AGENT_CONFIG_KEY = ["agent", "config"] as const;
const STORAGE_KEY = "meldui:agent-config";

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

function loadPersistedConfig(): AgentConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // Corrupt data — fall through to default
  }
  return DEFAULT_CONFIG;
}

function persistConfig(config: AgentConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

export function useAgentConfig(activeTicketId: string | null = null) {
  const queryClient = useQueryClient();

  const { data: config = DEFAULT_CONFIG } = useQuery({
    queryKey: AGENT_CONFIG_KEY,
    queryFn: () => queryClient.getQueryData<AgentConfig>(AGENT_CONFIG_KEY) ?? loadPersistedConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Listen for AgentInitMetadata Tauri event (tauri-specta: PascalCase → kebab-case)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    events.agentInitMetadata
      .listen((event) => {
        if (cancelled) return;
        const metadata = event.payload;
        const updated: AgentConfig = {
          ...(queryClient.getQueryData<AgentConfig>(AGENT_CONFIG_KEY) ?? DEFAULT_CONFIG),
          model: metadata.model,
          availableModels: metadata.available_models,
          tools: metadata.tools,
          slashCommands: metadata.slash_commands,
          skills: metadata.skills,
          mcpServers: metadata.mcp_servers,
        };
        queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, updated);
        persistConfig(updated);
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

  const updateConfig = (patch: Partial<AgentConfig>) => {
    const updated = {
      ...(queryClient.getQueryData<AgentConfig>(AGENT_CONFIG_KEY) ?? DEFAULT_CONFIG),
      ...patch,
    };
    queryClient.setQueryData<AgentConfig>(AGENT_CONFIG_KEY, updated);
    persistConfig(updated);
  };

  const setModel = useMutation({
    mutationFn: (model: string) =>
      activeTicketId
        ? commands.agentSetModel(activeTicketId, model).catch(() => {})
        : Promise.resolve(),
    onMutate: (model) => updateConfig({ model }),
  });

  const setThinking = useMutation({
    mutationFn: (params: { type: "adaptive" | "enabled" | "disabled"; budgetTokens?: number }) =>
      activeTicketId
        ? commands
            .agentSetThinking(activeTicketId, params.type, params.budgetTokens ?? null)
            .catch(() => {})
        : Promise.resolve(),
    onMutate: (params) => updateConfig({ thinking: params }),
  });

  const setEffort = useMutation({
    mutationFn: (effort: "low" | "medium" | "high" | "max") =>
      activeTicketId
        ? commands.agentSetEffort(activeTicketId, effort).catch(() => {})
        : Promise.resolve(),
    onMutate: (effort) => updateConfig({ effort }),
  });

  const setFastMode = useMutation({
    mutationFn: (enabled: boolean) =>
      activeTicketId
        ? commands.agentSetFastMode(activeTicketId, enabled).catch(() => {})
        : Promise.resolve(),
    onMutate: (enabled) => updateConfig({ fastMode: enabled }),
  });

  return {
    config,
    setModel: setModel.mutate,
    setThinking: setThinking.mutate,
    setEffort: setEffort.mutate,
    setFastMode: setFastMode.mutate,
  };
}
