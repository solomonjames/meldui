import { open } from "@tauri-apps/plugin-dialog";
import {
  Brain,
  ChevronDown,
  FileText,
  Gauge,
  Paperclip,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { ContextIndicator } from "@/features/workflow/components/shared/context-indicator";
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
import { fuzzyMatch, useAutocompleteTrigger } from "@/shared/components/chat/autocomplete-utils";
import type { AgentConfig, ContextUsage } from "@/shared/types";
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
  onSend: (
    message: string,
    attachments?: Array<{ name: string; path: string; type: string }>,
  ) => void;
  placeholder?: string;
  contextUsage?: ContextUsage;
  contextIndicatorVisibility?: "threshold" | "always" | "never";
  projectFiles?: string[];
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
  placeholder = "Add context or ask questions... (Enter to send)",
  contextUsage,
  contextIndicatorVisibility,
  projectFiles,
}: ComposeToolbarProps) {
  const [input, setInput] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [attachments, setAttachments] = useState<
    Array<{ name: string; path: string; type: string }>
  >([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleAttach = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        { name: "Text", extensions: ["txt", "md", "json", "yaml", "toml", "csv"] },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const newAttachments = paths.slice(0, 5 - attachments.length).map((p) => ({
      name: p.split("/").pop() ?? p,
      path: p,
      type: p.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? "image" : "text",
    }));
    setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition(e.currentTarget.selectionStart ?? 0);
  };

  const {
    isOpen: autocompleteOpen,
    trigger: activeTrigger,
    filter: autocompleteFilter,
    triggerIndex,
  } = useAutocompleteTrigger(["/", "#", "@"], input, cursorPosition);

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
        : activeTrigger === "@"
          ? (projectFiles ?? []).map((path) => ({
              name: path,
              icon: FileText,
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

  // Compute filtered items for keyboard navigation (must match AutocompleteMenu's filtering)
  const filteredAutocompleteItems = autocompleteOpen
    ? autocompleteItems.filter((item) => fuzzyMatch(item.name, autocompleteFilter)).slice(0, 8)
    : [];

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // When autocomplete is open, intercept navigation keys
    if (autocompleteOpen && filteredAutocompleteItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((prev) =>
          prev < filteredAutocompleteItems.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((prev) =>
          prev > 0 ? prev - 1 : filteredAutocompleteItems.length - 1,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filteredAutocompleteItems[autocompleteIndex];
        if (item) {
          handleAutocompleteSelect(item);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Clear the trigger character to close the menu
        setInput((prev) => prev.slice(0, triggerIndex) + prev.slice(triggerIndex + 1));
        setCursorPosition(triggerIndex);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "u" && e.metaKey) {
      e.preventDefault();
      handleAttach();
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
  };

  const modelDisplayName = MODEL_DISPLAY_NAMES[config.model] ?? config.model;
  const thinkingLabel =
    THINKING_OPTIONS.find((o) => o.value === config.thinking.type)?.label ?? "Adaptive";
  const effortLabel = EFFORT_OPTIONS.find((o) => o.value === config.effort)?.label ?? "High";

  return (
    <TooltipProvider delay={500}>
      <div className="p-3">
        <div className="rounded-lg border border-border bg-muted/30">
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
                selectedIndex={autocompleteIndex}
                onSelectedIndexChange={setAutocompleteIndex}
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
              className="min-h-[88px] max-h-[200px] resize-none border-0 bg-transparent rounded-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {/* Toolbar row */}
          <div className="flex items-center gap-1.5 px-3 pb-2 pt-1 dark:bg-input/30 bg-transparent">
            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <PillButton tooltip="AI model">
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
                    tooltip="Extended thinking"
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
                    tooltip="Effort level"
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
              tooltip="Fast mode"
              active={config.fastMode}
              accentClass="bg-amber-500/10 border-amber-500/30 text-amber-400"
              onClick={() => onSetFastMode(!config.fastMode)}
            >
              <Zap className="w-3 h-3" />
              Fast
            </PillButton>

            <ContextIndicator
              usage={contextUsage}
              visibility={contextIndicatorVisibility ?? "threshold"}
            />

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="flex items-center gap-1">
                {attachments.map((a, i) => (
                  <span
                    key={a.path}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary text-[10px]"
                  >
                    <Paperclip className="w-2.5 h-2.5" />
                    {a.name}
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Paperclip button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleAttach}>
                  <Paperclip className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Attach files (Cmd+U)
              </TooltipContent>
            </Tooltip>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send button */}
            <Button onClick={handleSend} disabled={!input.trim()} size="sm" className="h-7">
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
