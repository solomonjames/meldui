import { RefreshCw, Save, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettings } from "@/features/settings/hooks/use-settings";
import type {
  ProjectSettings,
  SupervisorSettings,
  SyncSettings,
  WorktreeSettings,
} from "@/shared/lib/sync";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import { Textarea } from "@/shared/ui/textarea";

interface SettingsPageProps {
  projectDir: string;
}

export function SettingsPage({ projectDir }: SettingsPageProps) {
  const { settings, loading, error, loadSettings, updateSettings } = useSettings(projectDir);
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then((result) => {
      if (result) setDraft(result);
    });
  }, [loadSettings]);

  // Effective draft: use local draft if available, else settings from hook
  const effectiveDraft = useMemo(() => draft ?? settings ?? {}, [draft, settings]);

  const handleSave = useCallback(async () => {
    await updateSettings(effectiveDraft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [effectiveDraft, updateSettings]);

  const updateSync = useCallback((patch: Partial<SyncSettings>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sync: {
          enabled: false,
          provider: "beads",
          auto_push: false,
          config: {},
          ...prev.sync,
          ...patch,
        },
      };
    });
  }, []);

  const updateWorktree = useCallback((patch: Partial<WorktreeSettings>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        worktree: {
          ...prev.worktree,
          ...patch,
        },
      };
    });
  }, []);

  const updateSupervisor = useCallback((patch: Partial<SupervisorSettings>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        supervisor: {
          max_replies_per_step: 5,
          ...prev.supervisor,
          ...patch,
        },
      };
    });
  }, []);

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">Project Settings</h3>
              <p className="text-xs text-muted-foreground">
                Configuration stored in .meldui/settings.json
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadSettings}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Reload
            </Button>
            <Button size="sm" onClick={handleSave}>
              {saved ? (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto p-6 space-y-8">
          {/* Sync Section */}
          <section className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold">Sync</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Sync tickets with an external provider like Beads
              </p>
            </div>
            <Separator />
            <div className="space-y-4">
              <ToggleField
                label="Enable sync"
                description="Synchronize tickets with the configured provider"
                checked={effectiveDraft.sync?.enabled ?? false}
                onChange={(enabled) => updateSync({ enabled })}
              />
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="sync-provider"
                >
                  Provider
                </label>
                <Input
                  id="sync-provider"
                  value={effectiveDraft.sync?.provider ?? "beads"}
                  onChange={(e) => updateSync({ provider: e.target.value })}
                  placeholder="beads"
                  className="text-sm"
                />
              </div>
              <ToggleField
                label="Auto-push"
                description="Automatically push ticket changes to the provider"
                checked={effectiveDraft.sync?.auto_push ?? false}
                onChange={(auto_push) => updateSync({ auto_push })}
              />
            </div>
          </section>

          {/* Worktree Section */}
          <section className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold">Worktrees</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Each ticket workflow runs in an isolated git worktree
              </p>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="worktree-setup">
                Setup command
              </label>
              <Textarea
                id="worktree-setup"
                value={effectiveDraft.worktree?.setup_command ?? ""}
                onChange={(e) =>
                  updateWorktree({
                    setup_command: e.target.value || undefined,
                  })
                }
                placeholder="e.g., bun install"
                className="font-mono text-sm min-h-[80px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Shell command to run after creating a worktree. Use this to install dependencies
                (e.g.,{" "}
                <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">bun install</code>,{" "}
                <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">composer install</code>)
                or set up the environment. Runs in the worktree directory.
              </p>
            </div>
          </section>

          {/* Supervisor Section */}
          <section className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold">Auto-Advance Supervisor</h4>
              <p className="text-xs text-muted-foreground mt-1">
                When auto-advance is enabled, the supervisor evaluates agent output and replies on
                your behalf instead of blindly advancing
              </p>
            </div>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="supervisor-max-replies"
                >
                  Max replies per step
                </label>
                <Input
                  id="supervisor-max-replies"
                  type="number"
                  min={1}
                  max={20}
                  value={effectiveDraft.supervisor?.max_replies_per_step ?? 5}
                  onChange={(e) =>
                    updateSupervisor({
                      max_replies_per_step: Math.max(1, Math.min(20, Number(e.target.value) || 5)),
                    })
                  }
                  className="text-sm w-24"
                />
                <p className="text-[11px] text-muted-foreground">
                  Maximum supervisor replies before falling back to manual input (default: 5)
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="supervisor-prompt"
                >
                  Custom supervisor prompt
                </label>
                <Textarea
                  id="supervisor-prompt"
                  value={effectiveDraft.supervisor?.custom_prompt ?? ""}
                  onChange={(e) =>
                    updateSupervisor({
                      custom_prompt: e.target.value || undefined,
                    })
                  }
                  placeholder="Leave empty for default. Custom prompts replace the guidelines section only — the preamble and JSON format instructions are always included."
                  className="font-mono text-sm min-h-[120px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Customize how the supervisor evaluates agent responses. Empty = use default
                  guidelines.
                </p>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <div>
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
