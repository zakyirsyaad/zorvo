import { formatLineCount, MINUS, type FileStat } from "../../lib/diff-stats";

export interface DiffFileListProps {
  /** The files the review shows, already narrowed by Search files. */
  stats: readonly FileStat[];
  /** The file marked as the one you are on: the last one picked here, else the first. */
  selectedPath: string | null;
  /** Opens the file's section and brings it into view. */
  onSelect: (path: string) => void;
}

const ROW = "flex h-[30px] w-full shrink-0 items-center gap-2 rounded-md px-2.5 text-left font-mono text-caption transition-colors focus-ring";

/** The full review's list of changed files on the left, each with its counts. */
export function DiffFileList({ stats, selectedPath, onSelect }: DiffFileListProps) {
  return (
    <nav aria-label="Changed files" className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface-1 px-2 py-2.5">
      {stats.map((stat) => {
        // A nested repository is listed as a folder, "vendor/lib/": named by its last part.
        const shown = stat.path.replace(/\/+$/, "");
        const name = shown.slice(shown.lastIndexOf("/") + 1);
        const isSelected = stat.path === selectedPath;
        return (
          <button
            key={stat.path}
            type="button"
            title={stat.path}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(stat.path)}
            className={`${ROW} ${isSelected ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"}`}
          >
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {stat.added > 0 && <span className="shrink-0 tabular-nums text-status-running">+{formatLineCount(stat.added)}</span>}
            {stat.removed > 0 && (
              <span className="shrink-0 tabular-nums text-danger">
                {MINUS}
                {formatLineCount(stat.removed)}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
