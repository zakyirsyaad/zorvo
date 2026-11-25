import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatSize } from "../../lib/file-content";

export interface FileVideoProps {
  rootPath: string;
  relativePath: string;
  size: number;
  /** Moves when the folder's changes are read again. Not followed: a playing video would restart on
   * every window focus. A token stays good for the file however it changes. */
  version: number;
}

/**
 * A video from the workspace, played in the file viewer. The webview sends the folder and the path
 * inside it; the backend checks both and the file's header and hands back a `zorvo-media` token,
 * which it then serves in byte ranges.
 */
export function FileVideo({ rootPath, relativePath, size }: FileVideoProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let isGone = false;
    setFailure(null);
    invoke<string>("media_url_for_file", { root: rootPath, relative: relativePath })
      .then((answer) => {
        if (!isGone && typeof answer === "string") setUrl(answer);
      })
      .catch((error) => {
        if (!isGone) setFailure(typeof error === "string" && error !== "" ? error : "Zorvo could not play this video.");
      });
    return () => {
      isGone = true;
    };
  }, [rootPath, relativePath]);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (failure) {
    return (
      <p role="alert" className="px-3 py-4 text-ui-sm text-danger">
        {failure}
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      {url && <video key={url} src={url} controls aria-label={name} className="max-h-full max-w-full rounded-md bg-surface-2" />}
      <p className="text-caption text-fg-subtle">{`Video · ${formatSize(size)} · Read only`}</p>
    </div>
  );
}
