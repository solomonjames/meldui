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
