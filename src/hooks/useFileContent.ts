import { useEffect, useState } from "react";
import { errorMessage, readWorkspaceFile } from "../lib/files";
import type { FileContent } from "../lib/file-content";

export type FileContentRead =
  | { status: "loading" }
  | { status: "ready"; content: FileContent }
  | { status: "failed"; message: string };

/**
 * A workspace file for the viewer, read again whenever `version` moves (a turn ended, Refresh).
 * An answer for an earlier file, or an earlier version, is dropped.
 */
export function useFileContent(root: string, relative: string, version: number): FileContentRead {
  const key = `${root}\n${relative}\n${version}`;
  const [read, setRead] = useState<{ key: string; result: FileContentRead } | null>(null);

  useEffect(() => {
    let isCancelled = false;
    readWorkspaceFile(root, relative)
      .then((content) => {
        if (!isCancelled) setRead({ key, result: { status: "ready", content } });
      })
      .catch((error: unknown) => {
        if (!isCancelled) setRead({ key, result: { status: "failed", message: errorMessage(error) } });
      });
    return () => {
      isCancelled = true;
    };
  }, [root, relative, key]);

  // While a new version loads, the last one for the same file stays on screen rather than flashing empty.
  if (read && read.key === key) return read.result;
  if (read && read.key.startsWith(`${root}\n${relative}\n`) && read.result.status === "ready") return read.result;
  return { status: "loading" };
}
