/**
 * A chip in the composer's row and beside a draft's heading (folder, branch), as the canvas draws it: 26px, radius 6, no fill,
 * in `fg-secondary`, with its chevron where it opens a menu; `surface-hover` under the pointer and with `fg` while its menu is open.
 */
export const COMPOSER_CHIP =
  "focus-ring inline-flex h-6.5 max-w-full items-center gap-1 whitespace-nowrap rounded-md bg-transparent px-2 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg";

/** What an open mode menu says under a mode that lets the agent act without asking. */
export const RISKY_LINE = "Lets the agent act without asking";

/** A setting's name for a count of its choices: "Model" gives "models". */
export function pluralOf(label: string): string {
  const lower = label.toLowerCase();
  return lower.endsWith("s") ? lower : `${lower}s`;
}

/** The model picker's look when it is joined to its agent's chip: no fill of its own, a hairline before it. */
export const JOINED_MODEL_CHIP =
  "focus-ring inline-flex h-7 max-w-[180px] items-center gap-1 whitespace-nowrap rounded-l-none rounded-r-md border-l border-border bg-transparent px-2 text-ui-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg";
