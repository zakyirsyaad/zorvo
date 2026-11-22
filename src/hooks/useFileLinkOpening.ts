import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FILE_LINK_OPEN, fileLinkTarget } from "../lib/file-links";
import { useLatest } from "./useLatest";

/**
 * Opens the file a link in a reply points at: in the file viewer when it is inside the folder the
 * Files tab shows, else selected in the file manager. Main window only: a popout has no Files tab.
 */
export function useFileLinkOpening(options: {
  /** The folder the Files tab shows; relative paths are read against it. */
  folder: string | undefined;
  viewFile: (relative: string) => void;
  onError: (message: string) => void;
}): void {
  const latest = useLatest(options);
  useEffect(() => {
    const open = (event: Event) => {
      const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path !== "string") return;
      const { folder, viewFile, onError } = latest.current;
      const target = fileLinkTarget(path, folder);
      if (target.kind === "view") viewFile(target.relative);
      else if (target.kind === "reveal") {
        // The backend's own sentence, never the path: it says only that the file was not found or shown.
        invoke("reveal_file_in_finder", { path: target.path }).catch((error) => onError(String(error)));
      } else onError("Open a session to open that file.");
    };
    window.addEventListener(FILE_LINK_OPEN, open);
    return () => window.removeEventListener(FILE_LINK_OPEN, open);
  }, [latest]);
}
