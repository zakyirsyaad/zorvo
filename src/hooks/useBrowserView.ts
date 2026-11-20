import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLatest } from "./useLatest";

interface Bounds { x: number; y: number; width: number; height: number }
let queue: Promise<unknown> = Promise.resolve();

interface BrowserCoverage {
  key: string;
  covered: boolean;
  onPreview: (source: string | null) => void;
  onCaptureFailed: () => void;
}

async function decodeSnapshot(value: unknown): Promise<string> {
  const snapshot = value as { mimeType?: unknown; base64?: unknown } | null;
  if (snapshot?.mimeType !== "image/png" || typeof snapshot.base64 !== "string" || snapshot.base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(snapshot.base64)) {
    throw new Error("The browser could not preserve the page behind this menu.");
  }
  const source = `data:image/png;base64,${snapshot.base64}`;
  await new Promise<void>((resolve, reject) => {
    const preview = new Image();
    const timer = setTimeout(() => { preview.onload = null; preview.onerror = null; reject(new Error("The browser page preview timed out.")); }, 5_000);
    preview.onload = () => { clearTimeout(timer); resolve(); };
    preview.onerror = () => { clearTimeout(timer); reject(new Error("The browser page preview could not be decoded.")); };
    preview.src = source;
  });
  return source;
}

/** Native scrolling stays local. Covering menus take one decoded frame before hiding the view. */
export function useBrowserView(boxRef: RefObject<HTMLElement | null>, sessionId: string, tabId: string | null, visible: boolean, onError: (message: string) => void, coverage?: BrowserCoverage): void {
  const latest = useLatest({ visible, onError, coverage });
  const syncRef = useRef<(() => void) | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    if (!tabId) return;
    let active = true;
    let frame = 0;
    let shown = false;
    let last: string | null = null;
    const report = (error: unknown) => latest.current.onError(String(error));
    const sync = () => {
      const box = boxRef.current;
      if (!active || !box) return;
      const rect = box.getBoundingClientRect();
      const bounds: Bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const show = latest.current.visible && bounds.width > 0 && bounds.height > 0;
      const covered = latest.current.coverage?.covered === true && bounds.width > 0 && bounds.height > 0;
      const identity = latest.current.coverage?.key;
      const key = JSON.stringify({ bounds, show, covered, identity });
      if (key === last) return;
      last = key;
      const request = ++revision.current;
      const valid = () => active && revision.current === request && latest.current.coverage?.key === identity;
      queue = queue.catch(() => {}).then(async () => {
        if (!valid()) return;
        if (!show && covered && shown) {
          const callbacks = latest.current.coverage;
          try {
            const snapshot = await invoke("browser_execute", { sessionId, args: { operation: "screenshot", tabId, engine: "webkit" } });
            if (!valid()) return;
            const source = await decodeSnapshot(snapshot);
            if (!valid()) return;
            callbacks?.onPreview(source);
            // Let React place the already decoded image before hiding its native source.
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, 100);
              requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
            });
          } catch (error) {
            if (!valid()) return;
            callbacks?.onCaptureFailed();
            report(error);
            return;
          }
        }
        if (!valid()) return;
        await invoke("browser_bounds", { sessionId, tabId, bounds: show ? bounds : null, visible: show });
        shown = show;
        if (valid() && show) latest.current.coverage?.onPreview(null);
      })
        .catch(error => active && latest.current.onError(String(error)));
    };
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(follow);
    if (boxRef.current) observer?.observe(boxRef.current);
    observer?.observe(document.body);
    window.addEventListener("resize", follow);
    syncRef.current = sync;
    follow();
    return () => {
      active = false;
      if (syncRef.current === sync) syncRef.current = null;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", follow);
      queue = queue.catch(() => {}).then(() => invoke("browser_bounds", { sessionId, tabId, bounds: null, visible: false }))
        .catch(report);
    };
  }, [boxRef, sessionId, tabId, latest]);
  useLayoutEffect(() => {
    const generation = revision;
    generation.current++;
    syncRef.current?.();
    return () => { generation.current++; };
  }, [visible, coverage?.covered, coverage?.key, sessionId, tabId]);
}
