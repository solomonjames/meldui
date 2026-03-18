import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ThemeMode = "light" | "dark" | "system";

interface AppPreferences {
  theme: string;
}

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", isDark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>("system");

  // Load saved theme on mount
  useEffect(() => {
    invoke<AppPreferences>("get_app_preferences").then((prefs) => {
      const mode = (prefs.theme as ThemeMode) || "system";
      setThemeState(mode);
      applyTheme(mode);
    });
  }, []);

  // Listen for cross-window sync
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<AppPreferences>("preferences-changed", (event) => {
      const mode = (event.payload.theme as ThemeMode) || "system";
      setThemeState(mode);
      applyTheme(mode);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for OS theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback(async (mode: ThemeMode) => {
    setThemeState(mode);
    applyTheme(mode);
    await invoke("set_app_preferences", { preferences: { theme: mode } });
  }, []);

  return { theme, setTheme };
}
