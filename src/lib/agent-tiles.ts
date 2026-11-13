/** How many agents the draft shows as tiles; the rest are under "All agents". */
export const TILE_LIMIT = 4;

function lastIndexNotIn(tiles: readonly { value: string }[], chosen: ReadonlySet<string>): number {
  for (let index = tiles.length - 1; index >= 0; index -= 1) {
    if (!chosen.has(tiles[index].value)) return index;
  }
  return -1;
}

/**
 * The agents the draft shows as tiles: the first `limit` in use, in their order. A chosen agent outside them
 * takes the place of the last tile that is not chosen, so what is chosen is always on screen.
 */
export function shownTiles<T extends { value: string }>(
  options: readonly T[],
  chosenIds: readonly string[],
  limit: number = TILE_LIMIT,
): T[] {
  const chosen = new Set(chosenIds);
  const shown = options.slice(0, limit);
  for (const option of options.slice(limit)) {
    if (!chosen.has(option.value)) continue;
    const place = lastIndexNotIn(shown, chosen);
    // Every tile is chosen already: nothing gives way.
    if (place === -1) break;
    shown[place] = option;
  }
  return shown;
}
