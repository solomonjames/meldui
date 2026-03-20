import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemeMode } from "@/shared/hooks/use-theme";

const options: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "System", icon: Monitor },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Appearance
      </h3>
      <div className="inline-flex rounded-lg border border-border bg-muted p-1 gap-1">
        {options.map(({ mode, label, icon: Icon }) => (
          <button
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
    </div>
  );
}
