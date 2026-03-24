import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { commands, events } from "@/bindings";
import { type ThemeMode, useTheme } from "@/shared/hooks/use-theme";

const options: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "System", icon: Monitor },
];

const contextIndicatorOptions = [
  { value: "threshold", label: "At 70%" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
] as const;

const preferencesKeys = {
  contextIndicator: () => ["preferences", "context_indicator_visibility"] as const,
};

function useContextIndicator() {
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: preferencesKeys.contextIndicator(),
    queryFn: async () => {
      const prefs = await commands.getAppPreferences();
      return (prefs.context_indicator_visibility as string) || "threshold";
    },
  });

  const currentVisibility = prefsQuery.data ?? "threshold";

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    events.appPreferences
      .listen(() => {
        queryClient.invalidateQueries({
          queryKey: preferencesKeys.contextIndicator(),
        });
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  const setVisibilityMutation = useMutation({
    mutationFn: async (value: string) => {
      const current = await commands.getAppPreferences();
      await commands.setAppPreferences({ ...current, context_indicator_visibility: value });
      return value;
    },
    onSuccess: (value) => {
      queryClient.setQueryData(preferencesKeys.contextIndicator(), value);
    },
  });

  const updatePreference = async (value: string) => {
    await setVisibilityMutation.mutateAsync(value);
  };

  return { currentVisibility, updatePreference };
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { currentVisibility, updatePreference } = useContextIndicator();

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Appearance</h3>
      <div className="inline-flex rounded-lg border border-border bg-muted p-1 gap-1">
        {options.map(({ mode, label, icon: Icon }) => (
          <button
            type="button"
            key={mode}
            onClick={() => setTheme(mode)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
              ${
                theme === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Context Indicator</h3>
        <div className="inline-flex rounded-lg border border-border bg-muted p-1 gap-1">
          {contextIndicatorOptions.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              onClick={() => updatePreference(value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                currentVisibility === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
