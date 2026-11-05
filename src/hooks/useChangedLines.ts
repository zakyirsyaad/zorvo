import { useEffect, useState } from "react";
import { changedLines, type LineChange } from "../lib/changed-lines";
import { readFileDiff } from "../lib/diff-read";
import { unifiedDiffRows } from "../lib/git-changes";

const NONE: ReadonlyMap<number, LineChange> = new Map();

/**
 * The open file's changed lines against HEAD. `repoPath` is the file's path in its repository (the
 * Files tab's prefix plus its own path), since `session_file_diff` names repository paths. Empty
 * while loading, on a failed read, and while disabled (a file with no changes reads no diff).
 */
export function useChangedLines(
  rootPath: string,
  repoPath: string,
  isEnabled: boolean,
  version: number,
): ReadonlyMap<number, LineChange> {
  const key = `${rootPath}\n${repoPath}\n${version}`;
  const [read, setRead] = useState<{ key: string; lines: ReadonlyMap<number, LineChange> } | null>(null);

  useEffect(() => {
    if (!isEnabled) return;
    const controller = new AbortController();
    readFileDiff(rootPath, repoPath, "head", undefined, controller.signal)
      .then((diff) => {
        if (!controller.signal.aborted) setRead({ key, lines: changedLines(unifiedDiffRows(diff)) });
      })
      // The bars are a hint: a diff that cannot be read leaves the file shown without them.
      .catch(() => {
        if (!controller.signal.aborted) setRead({ key, lines: NONE });
      });
    return () => controller.abort();
  }, [rootPath, repoPath, isEnabled, key]);

  return isEnabled && read?.key === key ? read.lines : NONE;
}
