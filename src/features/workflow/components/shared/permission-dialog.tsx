import type { PermissionRequest } from "@/shared/types";

interface PermissionDialogProps {
  permission: PermissionRequest;
  onRespond: (requestId: string, allowed: boolean) => void;
}

export function PermissionDialog({ permission, onRespond }: PermissionDialogProps) {
  let summary = "";
  const input = permission.input;
  if (input.command) summary = String(input.command);
  else if (input.file_path) summary = String(input.file_path);
  else if (input.pattern) summary = String(input.pattern);
  else summary = JSON.stringify(input).slice(0, 200);

  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 my-2 p-4">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Permission Required: {permission.tool_name}
          </p>
          <pre className="text-xs text-amber-700 dark:text-amber-300 mt-1 whitespace-pre-wrap break-all">
            {summary}
          </pre>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onRespond(permission.request_id, true)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              Allow
            </button>
            <button
              onClick={() => onRespond(permission.request_id, false)}
              className="px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
