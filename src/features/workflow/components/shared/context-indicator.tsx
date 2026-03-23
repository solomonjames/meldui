import type { ContextUsage } from "@/shared/types";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/shared/ui/hover-card";

interface ContextIndicatorProps {
  usage: ContextUsage | undefined;
  visibility: "threshold" | "always" | "never";
}

function RadialProgress({ percentage, color }: { percentage: number; color: string }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      className="shrink-0"
      role="img"
      aria-label={`Context usage: ${percentage}%`}
    >
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted/20"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
        className="transition-all duration-300"
      />
    </svg>
  );
}

function getColor(percentage: number): string {
  if (percentage >= 90) return "var(--destructive)";
  if (percentage >= 70) return "var(--amber-500, #f59e0b)";
  return "var(--muted-foreground)";
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function ContextIndicator({ usage, visibility }: ContextIndicatorProps) {
  if (!usage || visibility === "never") return null;

  const percentage =
    usage.contextLimit > 0 ? Math.round((usage.tokensUsed / usage.contextLimit) * 100) : 0;

  if (visibility === "threshold" && percentage < 70) return null;

  const color = getColor(percentage);

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button type="button" className="flex items-center gap-1 px-1">
          <RadialProgress percentage={percentage} color={color} />
          <span className="text-[10px] tabular-nums text-muted-foreground">{percentage}%</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-56 text-xs">
        <p className="font-medium mb-2">Context Window</p>
        <div className="space-y-1 text-muted-foreground">
          <div className="flex justify-between">
            <span>Used</span>
            <span className="tabular-nums">{formatTokens(usage.tokensUsed)}</span>
          </div>
          <div className="flex justify-between">
            <span>Limit</span>
            <span className="tabular-nums">{formatTokens(usage.contextLimit)}</span>
          </div>
          <div className="flex justify-between">
            <span>Available</span>
            <span className="tabular-nums">
              {formatTokens(usage.contextLimit - usage.tokensUsed)}
            </span>
          </div>
          <hr className="border-border my-1.5" />
          <div className="flex justify-between">
            <span>Input</span>
            <span className="tabular-nums">{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Output</span>
            <span className="tabular-nums">{formatTokens(usage.outputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache reads</span>
            <span className="tabular-nums">{formatTokens(usage.cacheReads)}</span>
          </div>
          <hr className="border-border my-1.5" />
          <div className="flex justify-between">
            <span>Cost</span>
            <span className="tabular-nums">${usage.costUsd.toFixed(2)}</span>
          </div>
          {usage.rateLimitUtilization > 0 && (
            <div className="flex justify-between">
              <span>Rate limit</span>
              <span className="tabular-nums">{Math.round(usage.rateLimitUtilization * 100)}%</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
