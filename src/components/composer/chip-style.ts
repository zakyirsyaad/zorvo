/**
 * A chip in the composer's row, as the canvas draws it: 28px, borderless and radius 6, in `fg-secondary`;
 * filled while its menu is open.
 */
export const COMPOSER_CHIP =
  "focus-ring inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg";

/**
 * A chip above the draft's card (folder, branch, agent), as the canvas draws it: 28px, radius 8, edged on
 * `surface-1`; filled and edged stronger while its menu is open.
 */
export const DRAFT_CHIP =
  "focus-ring inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-1 px-2.5 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:border-border-strong aria-expanded:bg-surface-hover aria-expanded:text-fg";

/** What an open mode menu says under a mode that lets the agent act without asking. */
export const RISKY_LINE = "Lets the agent act without asking";

/** A setting's name for a count of its choices: "Model" gives "models". */
export function pluralOf(label: string): string {
  const lower = label.toLowerCase();
  return lower.endsWith("s") ? lower : `${lower}s`;
}
