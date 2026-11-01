import { useEffect, useMemo, useState } from 'react';
import { readFileDiff } from '../lib/diff-read';
import type { DiffTargetId, FileStat } from '../lib/diff-stats';
import { unifiedDiffRows } from '../lib/git-changes';
import type { FileRead } from '../lib/review-comments';
import type { ReviewComment } from '../types';
import { useLatest } from './useLatest';

/** A file's read, with what it was read for: `scope` is the folder and target, `key` adds the moment. */
interface ReadEntry {
  scope: string;
  key: string;
  read: FileRead;
}

export interface CommentedFileReads {
  /** Per commented file on `target`; a file with no answer yet has no entry. */
  reads: Readonly<Record<string, FileRead>>;
  isReading: boolean;
}

/**
 * Reads the diff of each file with a comment on `target`, open or closed, so every
 * status is known. A file `listed` does not hold is `missing`, with no read. A file
 * is read again when its fingerprint or `version` changes, and the last answer stands
 * until the new one arrives.
 */
export function useCommentedFileReads(
  rootPath: string,
  comments: readonly ReviewComment[],
  target: DiffTargetId,
  listed: readonly FileStat[] | null,
  startCommit: string | undefined,
  version: number | string,
): CommentedFileReads {
  const [entries, setEntries] = useState<Readonly<Record<string, ReadEntry>>>({});
  const entriesRef = useLatest(entries);
  const scope = `${rootPath}\0${target}\0${startCommit ?? ''}`;

  const { files, wanted } = useMemo(() => {
    const files = [...new Set(comments.filter((c) => c.target === target).map((c) => c.file))].sort();
    const fingerprints = new Map(listed?.map((stat) => [stat.path, stat.fingerprint]));
    const wanted = files.flatMap((file) =>
      fingerprints.has(file) ? [{ file, key: `${scope}\0${version}\0${fingerprints.get(file)}` }] : [],
    );
    return { files, wanted };
  }, [comments, target, listed, scope, version]);
  const wantedRef = useLatest(wanted);
  // A new list of the same files is no reason to give up reads under way.
  const request = wanted.map(({ file, key }) => `${file}\0${key}`).join('\n');

  useEffect(() => {
    const controller = new AbortController();
    const settle = (file: string, key: string, read: FileRead) => {
      if (!controller.signal.aborted) setEntries((prev) => ({ ...prev, [file]: { scope, key, read } }));
    };
    for (const { file, key } of wantedRef.current) {
      if (entriesRef.current[file]?.key === key) continue;
      readFileDiff(rootPath, file, target, startCommit, controller.signal)
        .then((diff) => settle(file, key, { status: 'read', rows: unifiedDiffRows(diff ?? '') }))
        .catch(() => settle(file, key, { status: 'failed' }));
    }
    return () => controller.abort();
  }, [request, rootPath, target, startCommit, scope, entriesRef, wantedRef]);

  return useMemo(() => {
    const keys = new Map(wanted.map(({ file, key }) => [file, key]));
    const answers = files.flatMap((file): [string, FileRead][] => {
      if (!listed) return [];
      if (!keys.has(file)) return [[file, { status: 'missing' }]];
      const entry = entries[file];
      return entry?.scope === scope ? [[file, entry.read]] : [];
    });
    const isReading = listed === null ? files.length > 0 : wanted.some(({ file, key }) => entries[file]?.key !== key);
    return { reads: Object.fromEntries(answers), isReading };
  }, [entries, files, wanted, listed, scope]);
}
