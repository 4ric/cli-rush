export interface CommandHistoryNavigation {
  value: string;
  index: number;
  draft: string;
}

export type CommandHistoryDirection = "older" | "newer";

export const navigateCommandHistory = (
  entries: readonly string[],
  currentValue: string,
  currentIndex: number,
  currentDraft: string,
  direction: CommandHistoryDirection,
): CommandHistoryNavigation => {
  if (!entries.length) {
    return { value: currentValue, index: -1, draft: currentValue };
  }

  if (direction === "older") {
    const enteringHistory = currentIndex < 0;
    const index = enteringHistory
      ? entries.length - 1
      : Math.max(0, currentIndex - 1);
    return {
      value: entries[index],
      index,
      draft: enteringHistory ? currentValue : currentDraft,
    };
  }

  if (currentIndex < 0) {
    return { value: currentValue, index: -1, draft: currentValue };
  }

  const index = currentIndex + 1;
  if (index >= entries.length) {
    return { value: currentDraft, index: -1, draft: currentDraft };
  }

  return { value: entries[index], index, draft: currentDraft };
};
