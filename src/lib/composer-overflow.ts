/**
 * How many of the agent's controls sit in the composer's bottom row; the rest go into its ⋯ menu.
 * A count rather than a measurement: the chips never reshuffle while the window is resized.
 */
export const MAX_INLINE_CONTROLS = 3;

/** The controls shown as chips, in order, and those the ⋯ menu holds. */
export function splitControls<T>(controls: readonly T[], max = MAX_INLINE_CONTROLS): { inline: T[]; overflow: T[] } {
  return { inline: controls.slice(0, max), overflow: controls.slice(max) };
}
