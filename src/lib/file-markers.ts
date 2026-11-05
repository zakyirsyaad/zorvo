import type { FileStat } from "./diff-stats";

/** What the Files tab says about a changed file: modified (renamed counts) or added (untracked counts). */
export type FileMarker = "modified" | "added";

/** The Files tab's git markers: a letter per changed file, a dot per folder that holds changes. */
export interface FileMarkers {
  /** Paths relative to the Files tab's folder. */
  files: ReadonlyMap<string, FileMarker>;
  /** Folders above a changed file, deleted ones included, relative to the same folder. */
  folders: ReadonlySet<string>;
}

export const MARKER_LETTER: Record<FileMarker, "M" | "A"> = { modified: "M", added: "A" };
export const MARKER_WORD: Record<FileMarker, "Modified" | "Added"> = { modified: "Modified", added: "Added" };

const NO_MARKERS: FileMarkers = { files: new Map(), folders: new Set() };

function markerOf(kind: FileStat["kind"]): FileMarker | null {
  if (kind === "added" || kind === "untracked") return "added";
  if (kind === "modified" || kind === "renamed") return "modified";
  return null;
}

/**
 * The markers for the Files tab's folder. The stats' paths are relative to the repository's root, so
 * the folder's `prefix` (`DiffTargets.prefix`, "app/" for a folder below the root) is cut off them, and
 * a change outside the folder marks nothing.
 */
export function markersOf(stats: readonly FileStat[] | null, prefix: string): FileMarkers {
  if (!stats || stats.length === 0) return NO_MARKERS;
  const files = new Map<string, FileMarker>();
  const folders = new Set<string>();
  for (const stat of stats) {
    if (!stat.path.startsWith(prefix)) continue;
    const path = stat.path.slice(prefix.length);
    const marker = markerOf(stat.kind);
    if (marker) files.set(path, marker);
    // Every folder strictly above the path holds a change, a deleted file's too.
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      folders.add(path.slice(0, slash));
    }
  }
  return { files, folders };
}
