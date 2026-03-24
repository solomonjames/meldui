import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Cog,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  GitCommit,
  GitPullRequest,
  Globe,
  ListChecks,
  Minimize2,
  Search,
  Slash,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

/** Maps tool names to Lucide icons for tool cards */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  FileRead: FileText,
  Write: FilePlus,
  FileWrite: FilePlus,
  Edit: FilePen,
  FileEdit: FilePen,
  MultiEdit: FilePen,
  Bash: Terminal,
  BashOutput: Terminal,
  Grep: Search,
  Glob: FileSearch,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Bot,
  Skill: Sparkles,
  TodoWrite: ListChecks,
  TodoRead: ListChecks,
  NotebookEdit: BookOpen,
};

/** Fallback icon for unknown tools */
export const TOOL_ICON_FALLBACK: LucideIcon = Cog;

/** MCP tool icon — used for any tool_name starting with "mcp__" */
export const MCP_TOOL_ICON: LucideIcon = Wrench;

/** Maps slash command names to Lucide icons */
export const COMMAND_ICONS: Record<string, LucideIcon> = {
  commit: GitCommit,
  "review-pr": GitPullRequest,
  compact: Minimize2,
};

export const COMMAND_ICON_FALLBACK: LucideIcon = Slash;

/** Static descriptions for known slash commands (SDK only provides names) */
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  commit: "Create a git commit",
  "review-pr": "Review a pull request",
  compact: "Compact the conversation context",
  help: "Show available commands",
  clear: "Clear conversation history",
};

/** Model display names */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "claude-opus-4-6[1m]": "Opus 4.6 (1M)",
  "claude-opus-4-6-1m": "Opus 4.6 (1M)",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};
