import { Brain, ChevronDown, Gauge, Send, Sparkles, Zap } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import {
  COMMAND_DESCRIPTIONS,
  COMMAND_ICON_FALLBACK,
  COMMAND_ICONS,
  MODEL_DISPLAY_NAMES,
} from "@/features/workflow/constants";
import {
  type AutocompleteItem,
  AutocompleteMenu,
} from "@/shared/components/chat/autocomplete-menu";
import { useAutocompleteTrigger } from "@/shared/components/chat/autocomplete-utils";
import type { AgentConfig } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Textarea } from "@/shared/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";

interface ComposeToolbarProps {
  config: AgentConfig;
  onSetModel: (model: string) => void;
  onSetThinking: (params: {
    type: "adaptive" | "enabled" | "disabled";
    budgetTokens?: number;
  }) => void;
  onSetEffort: (effort: "low" | "medium" | "high" | "max") => void;
  onSetFastMode: (enabled: boolean) => void;
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const THINKING_OPTIONS = [
  { value: "adaptive", label: "Adaptive" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Off" },
] as const;

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
] as const;

function PillButton({
  children,
  tooltip,
  active,
  accentClass,
  onClick,
}: {
  children: React.ReactNode;
  tooltip: string;
  active?: boolean;
  accentClass?: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border transition-colors cursor-pointer
            ${active && accentClass ? accentClass : "bg-secondary border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function ComposeToolbar({
  config,
  onSetModel,
  onSetThinking,
  onSetEffort,
  onSetFastMode,
  onSend,
  disabled = false,
  placeholder = "Add context or ask questions... (Enter to send)",
}: ComposeToolbarProps) {
  const [input, setInput] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition(e.currentTarget.selectionStart ?? 0);
  };

  const {
    isOpen: autocompleteOpen,
    trigger: activeTrigger,
    filter: autocompleteFilter,
    triggerIndex,
  } = useAutocompleteTrigger(["/", "#"], input, cursorPosition);

  const autocompleteItems: AutocompleteItem[] =
    activeTrigger === "/"
      ? config.slashCommands.map((name) => ({
          name: `/${name}`,
          description: COMMAND_DESCRIPTIONS[name],
          icon: COMMAND_ICONS[name] ?? COMMAND_ICON_FALLBACK,
        }))
      : activeTrigger === "#"
        ? config.skills.map((name) => ({
            name: `#${name}`,
            icon: Sparkles,
            accentColor: "purple",
          }))
        : [];

  const handleAutocompleteSelect = (item: AutocompleteItem) => {
    const before = input.slice(0, triggerIndex);
    const after = input.slice(cursorPosition);
    const newInput = `${before}${item.name} ${after}`;
    setInput(newInput);
    const newPos = before.length + item.name.length + 1;
    setCursorPosition(newPos);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  };

  const modelDisplayName = MODEL_DISPLAY_NAMES[config.model] ?? config.model;
  const thinkingLabel =
    THINKING_OPTIONS.find((o) => o.value === config.thinking.type)?.label ?? "Adaptive";
  const effortLabel = EFFORT_OPTIONS.find((o) => o.value === config.effort)?.label ?? "High";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-t bg-white dark:bg-zinc-900 p-3">
        <div className="rounded-lg border bg-background">
          {/* Textarea */}
          <div className="relative">
            {autocompleteOpen && (
              <AutocompleteMenu
                items={autocompleteItems}
                filter={autocompleteFilter}
                onSelect={handleAutocompleteSelect}
                _onClose={() => {
                  /* noop — closing handled by filter going empty */
                }}
                _anchorRef={textareaRef}
              />
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCursorPosition(e.target.selectionStart ?? 0);
              }}
              onKeyDown={handleKeyDown}
              onSelect={handleSelect}
              onClick={handleSelect}
              placeholder={placeholder}
              className="min-h-[44px] max-h-[120px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={disabled}
            />
          </div>

          {/* Toolbar row */}
          <div className="flex items-center gap-1.5 px-3 pb-2 pt-1">
            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <PillButton tooltip="Select AI model">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    {modelDisplayName}
                    <ChevronDown className="w-3 h-3" />
                  </PillButton>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                {config.availableModels.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    onClick={() => onSetModel(m)}
                    className={config.model === m ? "bg-accent" : ""}
                  >
                    {MODEL_DISPLAY_NAMES[m] ?? m}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Thinking selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <PillButton
                    tooltip="Extended thinking mode (applies next step)"
                    active={config.thinking.type === "enabled"}
                    accentClass="bg-purple-500/10 border-purple-500/30 text-purple-400"
                  >
                    <Brain className="w-3 h-3" />
                    {thinkingLabel}
                    <ChevronDown className="w-3 h-3" />
                  </PillButton>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                {THINKING_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => onSetThinking({ type: o.value })}
                    className={config.thinking.type === o.value ? "bg-accent" : ""}
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Effort selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <PillButton
                    tooltip="Response effort level (applies next step)"
                    active={config.effort === "max"}
                    accentClass="bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  >
                    <Gauge className="w-3 h-3" />
                    {effortLabel}
                    <ChevronDown className="w-3 h-3" />
                  </PillButton>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                {EFFORT_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => onSetEffort(o.value)}
                    className={config.effort === o.value ? "bg-accent" : ""}
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Fast mode toggle */}
            <PillButton
              tooltip="Fast mode — same model, faster output"
              active={config.fastMode}
              accentClass="bg-amber-500/10 border-amber-500/30 text-amber-400"
              onClick={() => onSetFastMode(!config.fastMode)}
            >
              <Zap className="w-3 h-3" />
              Fast
            </PillButton>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send button */}
            <Button
              onClick={handleSend}
              disabled={!input.trim() || disabled}
              size="sm"
              className="h-7"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
