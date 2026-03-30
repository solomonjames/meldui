import { BookOpen, CheckCircle2, Circle, Code, FileText, ShieldCheck } from "lucide-react";
import type { TicketPhase } from "@/shared/lib/tickets/phase";

export const PHASE_CONFIG: Record<
  TicketPhase,
  { icon: typeof Circle; iconColor: string; badgeBg: string; label: string }
> = {
  backlog: {
    icon: Circle,
    iconColor: "text-zinc-400",
    badgeBg: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    label: "Backlog",
  },
  research: {
    icon: BookOpen,
    iconColor: "text-purple-500",
    badgeBg: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400",
    label: "Research",
  },
  spec: {
    icon: FileText,
    iconColor: "text-amber-500",
    badgeBg: "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400",
    label: "Spec",
  },
  implementation: {
    icon: Code,
    iconColor: "text-blue-500",
    badgeBg: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
    label: "Impl",
  },
  review: {
    icon: ShieldCheck,
    iconColor: "text-orange-500",
    badgeBg: "bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400",
    label: "Review",
  },
  done: {
    icon: CheckCircle2,
    iconColor: "text-emerald-500",
    badgeBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-400",
    label: "Done",
  },
};
