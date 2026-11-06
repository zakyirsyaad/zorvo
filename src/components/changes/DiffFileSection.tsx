import { ChevronRight } from "lucide-react";
import { FileDiff } from "./FileDiff";
import { commentSummary, FileComments, type FileReview } from "./LineComment";
import { formatLineCount, MINUS, type DiffTargetId, type FileStat } from "../../lib/diff-stats";

/** The id of a file's section in the diff view, which the review's file list scrolls to. */
export function diffSectionId(rootPath: string, path: string): string {
  return `diff-file:${rootPath}:${path}`;
}

/** One file in the diff view: a header with its counts, and the diff read on first open. */
export function DiffFileSection({ rootPath, stat, target, startCommit, version, isOpen, onToggle, review }: {
  rootPath: string;
  stat: FileStat;
  target: DiffTargetId;
  /** What the "start" target is measured from. */
  startCommit?: string;
  /** The diff is read again whenever this changes. */
  version: number | string;
  isOpen: boolean;
  onToggle: () => void;
  /** The file's comments, for a session on screen. */
  review?: FileReview;
}) {
  const takesComments = review !== undefined && !stat.isBinary && !stat.path.endsWith("/");
  return (
    <section id={diffSectionId(rootPath, stat.path)} className="scroll-mt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={stat.oldPath ? `${stat.oldPath} → ${stat.path}` : stat.path}
        className="flex h-9 w-full items-center gap-2 border-b border-border px-4 text-left hover:bg-surface-hover focus-ring"
      >
        <ChevronRight size={12} aria-hidden="true" className={`shrink-0 text-fg-subtle transition-transform ${isOpen ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate font-mono text-ui-sm text-fg">{stat.path}</span>
        {/* The rows say it to a screen reader: each offers "Comment on line N". */}
        {isOpen && takesComments && (
          <span aria-hidden="true" className="min-w-0 truncate text-caption text-fg-subtle">
            Click a line number to comment
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-caption tabular-nums">
          {stat.added > 0 && <span className="text-status-running">+{formatLineCount(stat.added)}</span>}
          {stat.removed > 0 && (
            <span className="text-danger">
              {MINUS}
              {formatLineCount(stat.removed)}
            </span>
          )}
        </span>
        {review && review.checked.length > 0 && (
          <span className="shrink-0 text-caption text-fg-muted">{commentSummary(review)}</span>
        )}
      </button>
      {isOpen &&
        (stat.isBinary ? (
          <>
            {review && <FileComments file={review} change={stat} rows={[]} />}
            <p className="px-4 py-2 text-caption text-fg-subtle">Binary file</p>
          </>
        ) : (
          <FileDiff
            rootPath={rootPath}
            change={stat}
            target={target}
            startCommit={startCommit}
            version={version}
            review={review}
            takesComments={!stat.path.endsWith("/")}
          />
        ))}
    </section>
  );
}
