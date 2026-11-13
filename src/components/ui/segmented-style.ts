/** The track of a segmented control: tabs, a radio group or a toggle group sit inside it. */
export const SEGMENTED_TRACK = "inline-flex gap-0.5 rounded-lg bg-chip p-0.5";

/** One item of a segmented control; the selected one is raised on `surface-hover`. `padding` widens it where the items are single words. */
export function segmentedItem(isSelected: boolean, padding = "px-2.5"): string {
  const base = `flex h-6.5 items-center gap-1.5 rounded-md ${padding} text-ui-sm transition-colors focus-ring`;
  return isSelected ? `${base} bg-surface-hover text-fg` : `${base} text-fg-muted hover:text-fg`;
}
