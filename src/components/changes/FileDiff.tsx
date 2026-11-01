import { useEffect, useMemo, useState } from "react";
import { unifiedDiffRows, type FileChange } from "../../lib/git-changes";
import type { DiffTargetId } from "../../lib/diff-stats";
import { DiffRows } from "./DiffRows";
import { readFileDiff } from "../../lib/diff-read";

type DiffState = { status: "loading" } | { status: "ready"; diff: string; key: string } | { status: "failed"; error: string; key: string };

/** One changed file's diff against `target` (the last commit unless told otherwise), read when it is opened. */
export function FileDiff({ rootPath, change, version, target = "head", startCommit }: {
  rootPath: string;
  change: FileChange;
  /** The diff is read again whenever this changes. */
  version: number | string;
  target?: DiffTargetId;
  /** What the "start" target is measured from. */
  startCommit?: string;
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
  if (state.status === "loading" || isStale) return <p className="px-3 py-1.5 text-[11px] text-fg-subtle">Loading the diff…</p>;
  if (state.status === "failed") {
    return (
      <p role="alert" className="px-3 py-1.5 text-[11px] text-danger">
        Could not show the diff: {state.error}
      </p>
    );
  }
  if (rows.length === 0) return <p className="px-3 py-1.5 text-[11px] text-fg-subtle">No text changes.</p>;
  return <DiffRows rows={rows} label={`Diff of ${change.path}`} />;
}
