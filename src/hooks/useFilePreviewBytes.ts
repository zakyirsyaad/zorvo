import { useEffect, useState } from "react";
import { errorMessage, readWorkspacePreview } from "../lib/files";

export type PreviewBytesRead =
  | { status: "loading" }
  | { status: "ready"; bytes: Uint8Array<ArrayBuffer> }
  | { status: "failed"; message: string };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * An image's or a PDF's bytes for the viewer. `version` moves whenever the folder's changes are read again
 * (a turn ended, the window got focus, Refresh), so the file is read again then, but what is on screen stays
 * until the new read answers, and is replaced only when the bytes differ: the same bytes are the same object,
 * so an open PDF keeps its page. An answer for a file that is no longer the open one is dropped.
 */
export function useFilePreviewBytes(root: string, relative: string, version: number): PreviewBytesRead {
  const file = `${root}\n${relative}`;
  const [read, setRead] = useState<{ file: string; result: PreviewBytesRead } | null>(null);

  useEffect(() => {
    let isCancelled = false;
    readWorkspacePreview(root, relative)
      .then((bytes) => {
        if (isCancelled) return;
        setRead((previous) =>
          previous?.file === file && previous.result.status === "ready" && sameBytes(previous.result.bytes, bytes)
            ? previous
            : { file, result: { status: "ready", bytes } },
        );
      })
      .catch((error: unknown) => {
        if (!isCancelled) setRead({ file, result: { status: "failed", message: errorMessage(error) } });
      });
    return () => {
      isCancelled = true;
    };
  }, [root, relative, file, version]);

  return read && read.file === file ? read.result : { status: "loading" };
}
