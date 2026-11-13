import { useEffect, useState } from "react";
import { errorMessage, readWorkspacePreview } from "../lib/files";

export type PreviewBytesRead =
  | { status: "loading" }
  | { status: "ready"; bytes: Uint8Array }
  | { status: "failed"; message: string };

/** An image's or a PDF's bytes for the viewer, read again when `version` moves; an answer for an earlier file is dropped. */
export function useFilePreviewBytes(root: string, relative: string, version: number): PreviewBytesRead {
  const key = `${root}\n${relative}\n${version}`;
  const [read, setRead] = useState<{ key: string; result: PreviewBytesRead } | null>(null);

  useEffect(() => {
    let isCancelled = false;
    readWorkspacePreview(root, relative)
      .then((bytes) => {
        if (!isCancelled) setRead({ key, result: { status: "ready", bytes } });
      })
      .catch((error: unknown) => {
        if (!isCancelled) setRead({ key, result: { status: "failed", message: errorMessage(error) } });
      });
    return () => {
      isCancelled = true;
    };
  }, [root, relative, key]);

  return read && read.key === key ? read.result : { status: "loading" };
}
