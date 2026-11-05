import type { UnifiedRow } from "./git-changes";

/** How a line of the file changed since HEAD: new on its own, or in place of removed lines. */
export type LineChange = "added" | "modified";

/**
 * The file's changed lines, by their number in the file as it is now. A run of changes is the rows
 * between two context lines or hunk headers; its added lines are modified when the run removes a line
 * too, else added. A "\ No newline" note does not end a run.
 */
export function changedLines(rows: readonly UnifiedRow[]): ReadonlyMap<number, LineChange> {
  const changes = new Map<number, LineChange>();
  let run: UnifiedRow[] = [];
  const closeRun = () => {
    const kind: LineChange = run.some((row) => row.kind === "removed") ? "modified" : "added";
    for (const row of run) {
      if (row.kind === "added" && row.newLine !== undefined) changes.set(row.newLine, kind);
    }
    run = [];
  };
  for (const row of rows) {
    if (row.kind === "context" || row.kind === "hunk") closeRun();
    else run.push(row);
  }
  closeRun();
  return changes;
}
