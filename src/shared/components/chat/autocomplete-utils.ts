import type { AutocompleteItem } from "@/shared/components/chat/autocomplete-menu";

/**
 * Handle keyboard events for autocomplete navigation.
 * Call this from the parent's onKeyDown handler when autocomplete is open.
 * Returns true if the event was handled (and should be preventDefault'd).
 */
export function handleAutocompleteKeyDown(
  e: React.KeyboardEvent,
  filteredItems: AutocompleteItem[],
  selectedIndex: number,
  setSelectedIndex: (i: number) => void,
  onSelect: (item: AutocompleteItem) => void,
  onClose: () => void,
): boolean {
  const maxIdx = Math.min(filteredItems.length - 1, 7);
  switch (e.key) {
    case "ArrowDown":
      setSelectedIndex(Math.min(selectedIndex + 1, maxIdx));
      return true;
    case "ArrowUp":
      setSelectedIndex(Math.max(selectedIndex - 1, 0));
      return true;
    case "Enter":
    case "Tab":
      if (filteredItems[selectedIndex]) {
        onSelect(filteredItems[selectedIndex]);
      }
      return true;
    case "Escape":
      onClose();
      return true;
    default:
      return false;
  }
}

/** Hook to manage autocomplete trigger state */
export function useAutocompleteTrigger(
  triggers: string[],
  inputValue: string,
  cursorPosition: number,
) {
  const activeTrigger = triggers.find((trigger) => {
    const beforeCursor = inputValue.slice(0, cursorPosition);
    const triggerIdx = beforeCursor.lastIndexOf(trigger);
    if (triggerIdx < 0) return false;
    if (
      triggerIdx > 0 &&
      beforeCursor[triggerIdx - 1] !== " " &&
      beforeCursor[triggerIdx - 1] !== "\n"
    )
      return false;
    const afterTrigger = beforeCursor.slice(triggerIdx + trigger.length);
    return !afterTrigger.includes(" ");
  });

  if (!activeTrigger) {
    return {
      isOpen: false,
      trigger: null,
      filter: "",
      triggerIndex: -1,
    } as const;
  }

  const beforeCursor = inputValue.slice(0, cursorPosition);
  const triggerIdx = beforeCursor.lastIndexOf(activeTrigger);
  const filter = beforeCursor.slice(triggerIdx + activeTrigger.length);

  return {
    isOpen: true,
    trigger: activeTrigger,
    filter,
    triggerIndex: triggerIdx,
  } as const;
}
