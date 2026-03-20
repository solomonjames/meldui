/* eslint-disable react-refresh/only-export-components -- renderer lookup pattern, components are not directly exported */
import type { ToolActivity } from "@/shared/types";

interface RendererProps {
  activity: ToolActivity;
  expanded: boolean;
}

function tryParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function ReadRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const filePath = parsed?.file_path as string | undefined;
  const offset = parsed?.offset as number | undefined;
  const limit = parsed?.limit as number | undefined;

  return (
    <>
      {filePath && (
        <span className="text-xs text-muted-foreground font-mono truncate">
          {filePath}
          {(offset || limit) && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px]">
              {offset ? `L${offset}` : ""}{offset && limit ? `-${offset + limit}` : limit ? `${limit} lines` : ""}
            </span>
          )}
        </span>
      )}
      {expanded && activity.result && (
        <div className="px-3 pb-2 border-t mt-2">
          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap mt-2 max-h-48 overflow-y-auto font-mono">
            {activity.result.slice(0, 3000)}{activity.result.length > 3000 ? "\n..." : ""}
          </pre>
        </div>
      )}
    </>
  );
}

function EditRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const filePath = parsed?.file_path as string | undefined;
  const oldString = parsed?.old_string as string | undefined;
  const newString = parsed?.new_string as string | undefined;

  return (
    <>
      {filePath && (
        <span className="text-xs text-muted-foreground font-mono truncate">{filePath}</span>
      )}
      {expanded && oldString && newString && (
        <div className="px-3 pb-2 border-t mt-2 space-y-1">
          <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2">
            <pre className="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
              {oldString.slice(0, 1000)}
            </pre>
          </div>
          <div className="rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-2">
            <pre className="text-xs text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
              {newString.slice(0, 1000)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

function BashRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const command = parsed?.command as string | undefined;

  return (
    <>
      {command && (
        <code className="text-xs text-muted-foreground font-mono truncate max-w-[300px] inline-block">
          {command.length > 80 ? command.slice(0, 80) + "..." : command}
        </code>
      )}
      {expanded && (
        <div className="px-3 pb-2 border-t mt-2">
          {command && (
            <div className="mb-2">
              <code className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all">
                $ {command}
              </code>
            </div>
          )}
          {activity.result && (
            <div className="rounded bg-zinc-900 dark:bg-black p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">
                {activity.result.slice(0, 3000)}{activity.result.length > 3000 ? "\n..." : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function GlobRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const pattern = parsed?.pattern as string | undefined;
  const resultLines = activity.result?.split("\n").filter(Boolean) ?? [];

  return (
    <>
      {pattern && (
        <span className="text-xs text-muted-foreground font-mono truncate">
          {pattern}
          {activity.result && (
            <span className="ml-1.5 text-[10px] text-zinc-500">({resultLines.length} files)</span>
          )}
        </span>
      )}
      {expanded && resultLines.length > 0 && (
        <div className="px-3 pb-2 border-t mt-2">
          <div className="text-xs text-muted-foreground font-mono max-h-48 overflow-y-auto space-y-0.5">
            {resultLines.slice(0, 50).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {resultLines.length > 50 && <div className="text-zinc-400">... and {resultLines.length - 50} more</div>}
          </div>
        </div>
      )}
    </>
  );
}

function GrepRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const pattern = parsed?.pattern as string | undefined;
  const resultLines = activity.result?.split("\n").filter(Boolean) ?? [];

  return (
    <>
      {pattern && (
        <span className="text-xs text-muted-foreground font-mono truncate">
          /{pattern}/
          {activity.result && (
            <span className="ml-1.5 text-[10px] text-zinc-500">({resultLines.length} matches)</span>
          )}
        </span>
      )}
      {expanded && resultLines.length > 0 && (
        <div className="px-3 pb-2 border-t mt-2">
          <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
            {resultLines.slice(0, 100).join("\n")}
            {resultLines.length > 100 ? `\n... and ${resultLines.length - 100} more` : ""}
          </pre>
        </div>
      )}
    </>
  );
}

function WriteRenderer({ activity, expanded }: RendererProps) {
  const parsed = tryParse(activity.input);
  const filePath = parsed?.file_path as string | undefined;
  const ext = filePath?.split(".").pop() ?? "";

  return (
    <>
      {filePath && (
        <span className="text-xs text-muted-foreground font-mono truncate">
          {filePath}
          {ext && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] uppercase">
              {ext}
            </span>
          )}
        </span>
      )}
      {expanded && activity.result && (
        <div className="px-3 pb-2 border-t mt-2">
          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap mt-2 max-h-48 overflow-y-auto">
            {activity.result.slice(0, 2000)}
          </pre>
        </div>
      )}
    </>
  );
}

function WebSearchRenderer({ activity }: RendererProps) {
  const parsed = tryParse(activity.input);
  const queryStr = parsed?.query as string | undefined;

  return (
    <>
      {queryStr && (
        <span className="text-xs text-muted-foreground truncate italic">"{queryStr}"</span>
      )}
    </>
  );
}

function WebFetchRenderer({ activity }: RendererProps) {
  const parsed = tryParse(activity.input);
  const url = parsed?.url as string | undefined;

  return (
    <>
      {url && (
        <span className="text-xs text-blue-600 dark:text-blue-400 truncate font-mono">{url}</span>
      )}
    </>
  );
}

function DefaultRenderer({ activity, expanded }: RendererProps) {
  let summary = "";
  try {
    const parsed = JSON.parse(activity.input);
    if (parsed.file_path) summary = parsed.file_path;
    else if (parsed.command) summary = parsed.command;
    else if (parsed.pattern) summary = parsed.pattern;
    else if (parsed.content?.slice) summary = `${parsed.content.slice(0, 60)}...`;
  } catch {
    if (activity.input.length > 0) {
      summary = activity.input.slice(0, 80);
      if (activity.input.length > 80) summary += "...";
    }
  }

  return (
    <>
      {summary && (
        <span className="text-xs text-muted-foreground truncate">{summary}</span>
      )}
      {expanded && activity.input && (
        <div className="px-3 pb-2 border-t mt-2">
          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {activity.input}
          </pre>
        </div>
      )}
      {expanded && activity.result && (
        <div className="px-3 pb-2 border-t">
          <p className="text-xs font-medium text-zinc-500 mt-2 mb-1">
            Result{activity.is_error ? " (error)" : ""}:
          </p>
          <pre className={`text-xs overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto ${activity.is_error ? "text-red-500" : "text-muted-foreground"}`}>
            {activity.result.slice(0, 2000)}{activity.result.length > 2000 ? "..." : ""}
          </pre>
        </div>
      )}
    </>
  );
}

const RENDERERS: Record<string, React.FC<RendererProps>> = {
  Read: ReadRenderer,
  Edit: EditRenderer,
  Bash: BashRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  Write: WriteRenderer,
  WebSearch: WebSearchRenderer,
  WebFetch: WebFetchRenderer,
};

export function getToolRenderer(toolName: string): React.FC<RendererProps> {
  return RENDERERS[toolName] ?? DefaultRenderer;
}

