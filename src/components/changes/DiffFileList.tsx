import { formatLineCount, MINUS, type FileStat } from "../../lib/diff-stats";

export interface DiffFileListProps {
  /** The files the review shows, already narrowed by Search files. */
  stats: readonly FileStat[];
  /** Opens the file's section and brings it into view. */
  onSelect: (path: string) => void;
}

/** The full review's list of changed files on the left, each with its counts. */
export function DiffFileList({ stats, onSelect }: DiffFileListProps) {
  return (
    <nav aria-label="Changed files" className="w-60 shrink-0 overflow-y-auto border-r border-border p-1.5">
      {stats.map((stat) => {
        // A nested repository is listed as a folder, "vendor/lib/": named by its last part.
        const shown = stat.path.replace(/\/+$/, "");
        const slash = shown.lastIndexOf("/");
        const name = shown.slice(slash + 1);
        const folder = slash > 0 ? shown.slice(0, slash) : "";
        return (
          <button
            key={stat.path}
            type="button"
            title={stat.path}
            onClick={() => onSelect(stat.path)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-surface-hover focus-ring"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-caption text-fg-secondary">{name}</span>
              {folder && <span className="truncate text-caption text-fg-muted">{folder}</span>}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-status-running">+{formatLineCount(stat.added)}</span>
            <span className="shrink-0 text-caption tabular-nums text-danger">
              {MINUS}
              {formatLineCount(stat.removed)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
