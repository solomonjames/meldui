import { useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkflowDefinition, WorkflowSuggestion } from "@/types";

interface WorkflowSelectorProps {
  currentWorkflowId?: string;
  workflows: WorkflowDefinition[];
  onAssign: (workflowId: string) => Promise<void>;
  onSuggest: () => Promise<WorkflowSuggestion | null>;
  loading?: boolean;
}

export function WorkflowSelector({
  currentWorkflowId,
  workflows,
  onAssign,
  onSuggest,
  loading,
}: WorkflowSelectorProps) {
  const [localId, setLocalId] = useState<string | null>(null);
  const selectedId = localId ?? currentWorkflowId ?? "";
  const [suggestion, setSuggestion] = useState<WorkflowSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    const result = await onSuggest();
    if (result) {
      setSuggestion(result);
    } else {
      setSuggestError("Unable to suggest workflow — please select manually");
    }
    setSuggesting(false);
  };

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAcceptSuggestion = async () => {
    if (!suggestion) return;
    setLocalId(suggestion.workflow_id);
    await onAssign(suggestion.workflow_id);
    setSuggestion(null);
    showSaved();
  };

  const handleRejectSuggestion = () => {
    setSuggestion(null);
  };

  const handleSelect = async (value: string) => {
    setLocalId(value);
    await onAssign(value);
    showSaved();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Workflow
        </h3>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 animate-in fade-in">
            <Check className="w-3 h-3" />
            Saved
          </span>
        )}
      </div>

      {/* Suggestion display */}
      {suggesting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Suggesting...
        </div>
      )}
      {suggestError && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {suggestError}
        </p>
      )}
      {suggestion && (
        <div className="flex items-center gap-2 text-xs bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="flex-1">
            Suggested:{" "}
            <strong>
              {workflows.find((w) => w.id === suggestion.workflow_id)?.name ??
                suggestion.workflow_id}
            </strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-emerald-600"
            onClick={handleAcceptSuggestion}
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-zinc-400"
            onClick={handleRejectSuggestion}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Select + Suggest button */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedId}
          onValueChange={handleSelect}
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
