import { Bug, Layers, Sparkles, SquareCheckBig, Wrench } from "lucide-react";

export const TYPE_CONFIG: Record<string, { icon: typeof Sparkles; color: string; bg: string }> = {
  feature: {
    icon: Sparkles,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10",
  },
  task: {
    icon: SquareCheckBig,
    color: "text-blue-600",
    bg: "bg-blue-500/10",
  },
  epic: {
    icon: Layers,
    color: "text-purple-600",
    bg: "bg-purple-500/10",
  },
  chore: {
    icon: Wrench,
    color: "text-amber-600",
    bg: "bg-amber-500/10",
  },
  bug: {
    icon: Bug,
    color: "text-red-600",
    bg: "bg-red-500/10",
  },
};

export const PRIORITY_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: "P0", color: "text-red-600", bg: "bg-red-500/10" },
  1: { label: "P1", color: "text-amber-600", bg: "bg-amber-500/10" },
  2: { label: "P2", color: "text-cyan-600", bg: "bg-cyan-500/10" },
  3: { label: "P3", color: "text-blue-600", bg: "bg-blue-500/10" },
  4: { label: "P4", color: "text-zinc-500", bg: "bg-zinc-500/10" },
};

export const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  open: { dot: "bg-zinc-400", label: "Open" },
  in_progress: { dot: "bg-blue-500", label: "In Progress" },
  blocked: { dot: "bg-red-500", label: "Blocked" },
  deferred: { dot: "bg-amber-400", label: "Deferred" },
  closed: { dot: "bg-emerald-500", label: "Closed" },
};
