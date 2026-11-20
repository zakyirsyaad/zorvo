import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BROWSER_OPEN } from "../lib/browser";
import { parseShown, type ShownArtifact } from "../lib/artifacts";
import { useLatest } from "./useLatest";

export function useBrowserOpening(options: {
  sessionId: string | null;
  show: () => void;
  onError: (message: string) => void;
  onArtifactShown?: (sessionId: string, shown: ShownArtifact) => void;
}): void {
  const latest = useLatest(options);
  useEffect(() => {
    const open = (event: Event) => {
      const { sessionId, show, onError } = latest.current;
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
      if (!sessionId) {
        onError("Open a session before opening a page in Zorvo's browser.");
        return;
      }
      show();
      void invoke("browser_execute", { sessionId, args: { operation: "tabs.open", url } })
        .catch(error => latest.current.onError(String(error)));
    };
    // A reveal is explicit. Background snapshots and other reads do not switch the inspector.
    const unlisten = listen<{ sessionId: string }>("browser-reveal", event => {
      if (event.payload.sessionId === latest.current.sessionId) latest.current.show();
    }).catch(error => { latest.current.onError(String(error)); return () => {}; });
    const stopPreview = listen<{ sessionId: string; shown: unknown }>("browser-preview", event => {
      const shown = parseShown(event.payload.shown);
      if (shown) latest.current.onArtifactShown?.(event.payload.sessionId, shown);
    }).catch(error => { latest.current.onError(String(error)); return () => {}; });
    window.addEventListener(BROWSER_OPEN, open);
    return () => {
      window.removeEventListener(BROWSER_OPEN, open);
      void unlisten.then(stop => stop());
      void stopPreview.then(stop => stop());
    };
  }, [latest]);
}
