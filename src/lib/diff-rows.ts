import { diffLines } from 'diff';
import type { DiffRow, ToolDetail } from '../types';

export type { DiffRow, DiffRowKind } from '../types';

/** Unchanged lines kept on each side of a change; longer unchanged runs are folded. */
const CONTEXT_LINES = 3;

function linesOf(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Folds the middle of an unchanged run, keeping context next to the changes around it. */
function foldContext(lines: string[], isFirst: boolean, isLast: boolean): DiffRow[] {
  const keepBefore = isFirst ? 0 : CONTEXT_LINES;
  const keepAfter = isLast ? 0 : CONTEXT_LINES;
  if (lines.length <= keepBefore + keepAfter + 1) return lines.map((text) => ({ kind: 'context', text }));
  const folded = lines.length - keepBefore - keepAfter;
  return [
    ...lines.slice(0, keepBefore).map((text): DiffRow => ({ kind: 'context', text })),
    { kind: 'skipped', text: `${folded} unchanged line${folded === 1 ? '' : 's'}` },
    ...lines.slice(lines.length - keepAfter).map((text): DiffRow => ({ kind: 'context', text })),
  ];
}

/** Line-by-line rows for a file change; `oldText` null means a new file. */
export function diffRows(oldText: string | null, newText: string): DiffRow[] {
  const parts = diffLines(oldText ?? '', newText);
  const rows = parts.flatMap((part, index) => {
    const lines = linesOf(part.value);
    if (part.added) return lines.map((text): DiffRow => ({ kind: 'added', text }));
    if (part.removed) return lines.map((text): DiffRow => ({ kind: 'removed', text }));
    return foldContext(lines, index === 0, index === parts.length - 1);
  });
  return rows;
}

/** A file change as a tool's diff detail keeps it: the rows it shows, never the whole file. */
export function diffDetail(path: string, oldText: string | null, newText: string): Extract<ToolDetail, { kind: 'diff' }> {
  return { kind: 'diff', path, isNewFile: oldText === null, rows: diffRows(oldText, newText) };
}

export function countChanges(rows: readonly DiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter((r) => r.kind === 'added').length,
    removed: rows.filter((r) => r.kind === 'removed').length,
  };
}
