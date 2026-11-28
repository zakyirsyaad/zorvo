import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLatest } from './useLatest';

/**
 * What a box shows: a stored page, or a canvas through Zorvo's wrapper. A new `reload` number
 * makes a new view of the same thing.
 */
export type ArtifactViewTarget =
  | { kind?: 'page'; sessionId: string; artifactId: string; version: number; reload: number }
  | { kind: 'canvas'; sessionId: string; key: string; reload?: number }
  | { kind: 'motion'; sessionId: string; key: string; format: string; reload?: number }
  | { kind: 'design-system'; sessionId: string; key: string; reload?: number };

/** What the view holds, whatever its reload number: Expand and Shrink keep one view for it. */
function viewKeyOf(target: ArtifactViewTarget): string {
  if (target.kind === 'motion') return `motion/${target.sessionId}/${target.key}/${target.format}`;
  if (target.kind === 'design-system') return `ds/${target.sessionId}/${target.key}`;
  return target.kind === 'canvas' ? `canvas/${target.sessionId}/${target.key}` : `${target.sessionId}/${target.artifactId}/${target.version}`;
}

function showCall(target: ArtifactViewTarget, { x, y, width, height }: Rect): Promise<unknown> {
  if (target.kind === 'canvas') return invoke('canvas_view_show', { sessionId: target.sessionId, key: target.key, x, y, width, height });
  if (target.kind === 'design-system') return invoke('ds_view_show', { sessionId: target.sessionId, key: target.key, x, y, width, height });
  if (target.kind === 'motion') {
    return invoke('motion_view_show', { sessionId: target.sessionId, key: target.key, format: target.format, x, y, width, height });
  }
  return invoke('artifact_view_show', { sessionId: target.sessionId, artifactId: target.artifactId, version: target.version, x, y, width, height });
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(box: HTMLElement): Rect {
  const { x, y, width, height } = box.getBoundingClientRect();
  return { x, y, width, height };
}

const isSameRect = (a: Rect | null, b: Rect) => a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Every call about the one page view goes out through this queue, in the order
 * it was asked for. An async command may otherwise overtake the one before it,
 * and one viewer leaving (its close) must not land after the next one's show.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue(call: () => Promise<unknown>, onError?: (error: unknown) => void): void {
  queue = queue.then(call).catch((error) => onError?.(error));
}

/**
 * Puts a call about the page view (comment mode, marks) in the same queue as
 * its show, move and close, so it reaches the backend after them, in order.
 */
export function enqueueArtifactViewCall(call: () => Promise<unknown>, onError?: (error: unknown) => void): void {
  enqueue(call, onError);
}

/**
 * The one page view is shared by every box that shows a page, so what it shows is kept here, not in a box.
 * `claimed` is the page a mounted box wants, and which box; `live` is the page the backend's view holds. A box that leaves
 * gives up its claim, and the view is closed only if nothing claimed it by the time the close's turn comes:
 * Expand and Shrink take the page from one box to another in one step, and the same view then only moves,
 * so what was typed or scrolled in the page stays.
 */
let claimed: { page: string; owner: object } | null = null;
let live: string | null = null;

/**
 * Shows an artifact's page over `boxRef`. The page lives in a webview of its
 * own, which the backend places: this hook only says which page, where the
 * box is, and when something of Zorvo's covers it. The webview sends ids and a
 * rectangle, never a URL or a path.
 */
export function useArtifactView(
  boxRef: RefObject<HTMLElement | null>,
  target: ArtifactViewTarget | null,
  isCovered: boolean,
  onError: (message: string) => void,
): void {
  const onErrorRef = useLatest(onError);
  const isCoveredRef = useLatest(isCovered);
  const lastRect = useRef<Rect | null>(null);
  // The target the backend was last asked to show; null while it shows none of ours.
  const shownKey = useRef<string | null>(null);

  // A view is made visible, so only a change from that is worth a call.
  const wasCovered = useRef(false);

  // The page itself, whatever its reload number: a box that arrives with the page another just left keeps the view.
  const pageKey = target === null ? null : viewKeyOf(target);
  const targetKey = target === null ? null : `${pageKey}/${target.reload ?? 0}`;
  // The reload number this box last showed; a new one in the same box asks for a new view.
  const lastReload = useRef<number | null>(null);
  // Names this box in the shared claim, so a box that leaves gives up its own claim only.
  const owner = useRef<object>({}).current;
  const targetRef = useLatest(target);

  useEffect(() => {
    if (targetKey === null || pageKey === null) return;

    /** Brings the backend's view in step with the box: shows the page once the box has a size, then follows it. */
    const sync = () => {
      const box = boxRef.current;
      const shown = targetRef.current;
      if (box === null || shown === null) return;
      const rect = rectOf(box);
      // A box with no size is hidden (Settings and the gallery hide the main sheet without unmounting it):
      // there is nowhere to show the page, and a zero rectangle would make the backend close the view.
      if (rect.width === 0 || rect.height === 0) return;
      if (shownKey.current !== targetKey) {
        shownKey.current = targetKey;
        lastRect.current = rect;
        claimed = { page: pageKey, owner };
        const reload = shown.reload ?? 0;
        const isReload = lastReload.current !== null && lastReload.current !== reload;
        lastReload.current = reload;
        const place = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        enqueue(
          async () => {
            // A newer box took the view meanwhile: its own call follows.
            if (claimed?.owner !== owner || claimed.page !== pageKey) return;
            if (live === pageKey && !isReload) {
              await invoke('artifact_view_bounds', { x: place.x, y: place.y, width: place.width, height: place.height });
            } else {
              live = pageKey;
              try {
                await showCall(shown, place);
              } catch (error) {
                // The backend closes the view when it cannot show the page.
                if (live === pageKey) live = null;
                throw error;
              }
            }
            // The view is in step with this box now: a new one is visible, a kept one is as its last box left it.
            wasCovered.current = isCoveredRef.current;
            await invoke('artifact_view_hide', { hidden: isCoveredRef.current });
          },
          (error) => onErrorRef.current(typeof error === 'string' ? error : 'Zorvo could not show that page.'),
        );
        return;
      }
      if (isSameRect(lastRect.current, rect)) return;
      lastRect.current = rect;
      enqueue(() => invoke('artifact_view_bounds', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
    };

    sync();
    // The box moves with the window, the inspector's width and Expand, and gets its size back when what hid it closes.
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const box = boxRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (box !== null) observer?.observe(box);
    observer?.observe(document.body);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', follow);
      if (shownKey.current === null) return;
      shownKey.current = null;
      if (claimed?.owner === owner) claimed = null;
      enqueue(() => {
        if (claimed !== null || live === null) return Promise.resolve();
        live = null;
        return invoke('artifact_view_close');
      });
    };
  }, [targetKey, pageKey, owner, boxRef, targetRef, isCoveredRef, onErrorRef]);

  useEffect(() => {
    if (shownKey.current === null || wasCovered.current === isCovered) return;
    wasCovered.current = isCovered;
    enqueue(() => invoke('artifact_view_hide', { hidden: isCovered }));
  }, [isCovered]);
}

/** Points of the box, inset from its edges, that must be free for the page to show. */
const SAMPLES = [0.1, 0.5, 0.9];

/** Whether one of Zorvo's marked overlays (a notice) lies over the box: a small one can miss every sampled point. */
function hasOverlayOver(box: DOMRect): boolean {
  return Array.from(document.querySelectorAll('[data-overlay]')).some((overlay) => {
    const rect = overlay.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < box.right &&
      rect.right > box.left &&
      rect.top < box.bottom &&
      rect.bottom > box.top
    );
  });
}

function isCoveredNow(box: HTMLElement): boolean {
  const rect = box.getBoundingClientRect();
  const { x, y, width, height } = rect;
  // No size: the box is in a part of the window that is hidden, so the page must not show either.
  if (width === 0 || height === 0) return true;
  if (hasOverlayOver(rect)) return true;
  if (typeof document.elementFromPoint !== 'function') return false;
  return SAMPLES.some((fx) =>
    SAMPLES.some((fy) => {
      const top = document.elementFromPoint(x + width * fx, y + height * fy);
      return top !== null && top !== box && !box.contains(top);
    }),
  );
}

/**
 * Whether anything of Zorvo's is drawn over the box: a menu, a dialog, a toast.
 * The page is a native layer above the HTML, so it must be hidden then. This
 * looks at what is on top at a grid of points whenever the document changes,
 * so no overlay has to announce itself.
 */
export function useBoxCovered(boxRef: RefObject<HTMLElement | null>, isActive: boolean): boolean {
  const [isCovered, setIsCovered] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setIsCovered(false);
      return;
    }
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = boxRef.current;
        if (box !== null) setIsCovered(isCoveredNow(box));
      });
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [boxRef, isActive]);

  return isCovered;
}
