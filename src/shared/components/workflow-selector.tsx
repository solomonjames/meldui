import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { WorkflowDefinition, WorkflowSuggestion } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

interface WorkflowSelectorProps {
  selectedWorkflowId?: string;
  workflows: WorkflowDefinition[];
  onSelect: (workflowId: string) => void;
  onSuggest: () => Promise<WorkflowSuggestion | null>;
  loading?: boolean;
}

export function WorkflowSelector({
  selectedWorkflowId,
  workflows,
  onSelect,
  onSuggest,
  loading,
}: WorkflowSelectorProps) {
  const [suggestion, setSuggestion] = useState<WorkflowSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    const result = await onSuggest();
    if (result) {
      setSuggestion(result);
      onSelect(result.workflow_id);
    } else {
      setSuggestError("Unable to suggest workflow — please select manually");
    }
    setSuggesting(false);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Workflow
      </h3>

      {/* Suggestion display */}
      {suggesting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Suggesting...
        </div>
      )}
      {suggestError && <p className="text-xs text-amber-600 dark:text-amber-400">{suggestError}</p>}
      {suggestion && (
        <div className="flex items-start gap-2 text-xs bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <span className="flex-1">
            Suggested{" "}
            <strong>
              {workflows.find((w) => w.id === suggestion.workflow_id)?.name ??
                suggestion.workflow_id}
            </strong>
            {suggestion.reasoning && (
              <span className="text-muted-foreground"> — {suggestion.reasoning}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setSuggestion(null)}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Select + Suggest button */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedWorkflowId ?? ""}
          onValueChange={(v) => v && onSelect(v)}
          disabled={loading}
          items={workflows.map((wf) => ({ value: wf.id, label: wf.name }))}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select workflow..." />
          </SelectTrigger>
          <SelectContent>
            {workflows.map((wf) => (
              <SelectItem key={wf.id} value={wf.id}>
                {wf.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSuggest}
          disabled={suggesting || loading}
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          Suggest
        </Button>
      </div>
    </div>
  );
}
