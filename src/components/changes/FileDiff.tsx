import { useEffect, useMemo, useState } from "react";
import { isCommentableFile, unifiedDiffRows, type FileChange } from "../../lib/git-changes";
import type { DiffTargetId } from "../../lib/diff-stats";
import { DiffRows, type DiffDensity } from "./DiffRows";
import { againstRows, FileComments, rowReviewOf, type FileReview } from "./LineComment";
import { readFileDiff } from "../../lib/diff-read";

type DiffState = { status: "loading" } | { status: "ready"; diff: string; key: string } | { status: "failed"; error: string; key: string };

/** One changed file's diff against `target` (the last commit unless told otherwise), read when it is opened. */
export function FileDiff({ rootPath, change, version, target = "head", startCommit, review, takesComments = false, density = "review" }: {
  rootPath: string;
  change: FileChange;
  /** The diff is read again whenever this changes. */
  version: number | string;
  target?: DiffTargetId;
  /** What the "start" target is measured from. */
  startCommit?: string;
  /** The file's comments. Only the diff view passes it, and the Changes panel shows none. */
  review?: FileReview;
  /** Whether its lines can take a new comment; a nested repository's cannot. */
  takesComments?: boolean;
  /** `card` in the Changes tab, `review` in the full diff review. */
  density?: DiffDensity;
}) {
  const [state, setState] = useState<DiffState>({ status: "loading" });

  const { path, kind } = change;
  // What is being read; a diff of anything else must never show.
  const key = `${rootPath}\0${path}\0${target}\0${startCommit ?? ""}`;
  // Read again with every new list (`version`): the file may have changed since.
  useEffect(() => {
    const controller = new AbortController();
    // A diff already shown stays while a refresh (new `version`) arrives, so it does not flash.
    // A different file or target starts over.
    setState((prev) => (prev.status === "ready" && prev.key === key ? prev : { status: "loading" }));
    readFileDiff(rootPath, path, target, startCommit, controller.signal)
      .then((diff) => !controller.signal.aborted && setState({ status: "ready", diff: diff ?? "", key }))
      .catch((error) => !controller.signal.aborted && setState({ status: "failed", error: String(error), key }));
    // Gives up its turn (or its slot) so a closed section never holds up the others.
    return () => controller.abort();
  }, [rootPath, path, kind, version, target, startCommit, key]);

  const rows = useMemo(() => (state.status === "ready" ? unifiedDiffRows(state.diff) : []), [state]);

  // The effect has not yet reset a state left over from another file or target.
  const isStale = state.status !== "loading" && state.key !== key;
  const shownRows = state.status === "ready" && !isStale ? rows : [];
  // A comment just saved reads against the rows on screen until its own read answers.
  const fileReview = review && (review.read || shownRows.length === 0 ? review : againstRows(review, shownRows));
  const rowReview = fileReview && takesComments && shownRows.length > 0 && isCommentableFile(shownRows)
    ? rowReviewOf(fileReview, change, shownRows, density)
    : undefined;

  const body = () => {
    if (state.status === "loading" || isStale) return <p className="px-4 py-1.5 text-caption text-fg-subtle">Loading the diff…</p>;
    if (state.status === "failed") {
      return (
        <p role="alert" className="px-4 py-1.5 text-caption text-danger">
          Could not show the diff: {state.error}
        </p>
      );
    }
    if (rows.length === 0) return <p className="px-4 py-1.5 text-caption text-fg-subtle">No text changes.</p>;
    return <DiffRows rows={rows} label={`Diff of ${change.path}`} review={rowReview} density={density} />;
  };
  return (
    <>
      {fileReview && <FileComments file={fileReview} change={change} rows={rowReview ? shownRows : []} />}
      {body()}
    </>
  );
}
