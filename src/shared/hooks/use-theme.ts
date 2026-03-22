import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { commands, events } from "@/bindings";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type ThemeMode = "light" | "dark" | "system";

export const preferencesKeys = {
  theme: () => ["preferences", "theme"] as const,
};

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", isDark);
}

export function useTheme() {
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: preferencesKeys.theme(),
    queryFn: async () => {
      const prefs = await commands.getAppPreferences();
      return (prefs.theme as ThemeMode) || "system";
    },
  });

  const theme = prefsQuery.data ?? "system";

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for cross-window sync — invalidate query on external changes
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    events.appPreferences.listen(() => {
      queryClient.invalidateQueries({ queryKey: preferencesKeys.theme() });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  // Listen for OS theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setThemeMutation = useMutation({
    mutationFn: async (mode: ThemeMode) => {
      await commands.setAppPreferences({ theme: mode });
      return mode;
    },
    onSuccess: (mode) => {
      queryClient.setQueryData(preferencesKeys.theme(), mode);
      applyTheme(mode);
    },
  });

  const setTheme = async (mode: ThemeMode) => {
    // Optimistic UI update
    applyTheme(mode);
    await setThemeMutation.mutateAsync(mode);
  };

  return { theme, setTheme };
}
