import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { canvasThumbUrl, parseCanvasRead, type Canvas, type CanvasRead } from '../lib/canvas';

/** Emitted by the backend with `{ sessionId }` after a session's artifacts changed. */
const ARTIFACTS_CHANGED = 'artifacts-changed';
/** What the canvas wrapper reported: `{ sessionId, key, kind: "select" | "zoom", artboardId?, zoom? }`. */
const CANVAS_VIEW = 'canvas-view';
/** An artboard's picture is in the cache: `{ sessionId, key, artboardId, sha256 }`. */
const CANVAS_THUMB = 'canvas-thumb';
const ARTBOARD_ID = /^[a-z0-9-]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NO_PICTURES: ReadonlyMap<string, string> = new Map();

interface ViewMemory {
  selected: string | null;
  zoom: number;
}

/**
 * The selection and zoom of each canvas, kept for this run: Expand and Shrink mount another viewer on the
 * same view, which still shows that selection, so the next state sent must not take it away.
 */
const memory = new Map<string, ViewMemory>();
const DEFAULT_VIEW: ViewMemory = { selected: null, zoom: 1 };

interface ReadMemory {
  read: CanvasRead | null;
  shown: CanvasRead | null;
}

/**
 * The last reads of each canvas, kept for this run: the viewer that Expand or Shrink mounts starts with
 * the canvas at once, so its box takes over the view in the same commit and the view only moves.
 */
const lastReads = new Map<string, ReadMemory>();
const NO_READ: ReadMemory = { read: null, shown: null };

export interface CanvasState {
  /** The newest answer that fit, which may carry an error and no canvas. */
  read: CanvasRead | null;
  /** The last canvas that could be read; kept while `canvas.json` cannot be. */
  lastGood: Canvas | null;
  /** The last read that had a canvas, with its files' hashes: what the wrapper shows. */
  shown: CanvasRead | null;
  refresh: () => void;
  selected: string | null;
  zoom: number;
  /** Each artboard's cached picture, by artboard id: only for the hash its file has now. */
  thumbs: ReadonlyMap<string, string>;
}

/** The hashes `canvas_thumbs` answers as ready; anything else in the answer is left out. */
function readyHashes(answer: unknown): string[] {
  if (!Array.isArray(answer)) return [];
  return answer.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { sha256, ready } = item as Record<string, unknown>;
    return ready === true && typeof sha256 === 'string' && SHA256.test(sha256) ? [sha256] : [];
  });
}

/** The hash of a `canvas-thumb` event for this canvas, or null. */
function thumbEventHash(payload: unknown, sessionId: string, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as Record<string, unknown>;
  if (event.sessionId !== sessionId || event.key !== key) return null;
  return typeof event.sha256 === 'string' && SHA256.test(event.sha256) ? event.sha256 : null;
}

function parseViewEvent(payload: unknown, sessionId: string, key: string): Partial<ViewMemory> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as Record<string, unknown>;
  if (event.sessionId !== sessionId || event.key !== key) return null;
  if (event.kind === 'select') {
    const id = event.artboardId;
    if (id === null) return { selected: null };
    return typeof id === 'string' && ARTBOARD_ID.test(id) ? { selected: id } : null;
  }
  if (event.kind === 'zoom' && typeof event.zoom === 'number' && Number.isFinite(event.zoom)) return { zoom: event.zoom };
  return null;
}

/**
 * One canvas as the backend reads it now. It is read again when the backend says the session's
 * artifacts changed (the agent showed it again), when one of the session's turns ends
 * (`turnsEnded` moves) and when the window comes to the front. A `canvas.json` that no longer
 * parses keeps the last good canvas, which the viewer goes on showing.
 */
export function useCanvas(sessionId: string, key: string | null, turnsEnded = 0): CanvasState {
  const memoryKey = key === null ? null : `${sessionId}/${key}`;
  const [{ read, shown }, setReads] = useState<ReadMemory>(() => (memoryKey === null ? NO_READ : (lastReads.get(memoryKey) ?? NO_READ)));
  const [view, setView] = useState<ViewMemory>(() => (memoryKey === null ? DEFAULT_VIEW : (memory.get(memoryKey) ?? DEFAULT_VIEW)));
  // Pictures are known by hash, so one drawn for an older file never shows for the new one.
  const [readyPictures, setReadyPictures] = useState<ReadonlySet<string>>(() => new Set());
  // Answers are numbered: one asked for earlier never replaces one asked for later.
  const lastRequest = useRef(0);
  const lastApplied = useRef(0);

  const refresh = useCallback(() => {
    if (key === null) return;
    const request = ++lastRequest.current;
    invoke('canvas_read', { sessionId, key })
      .then((answer) => {
        const parsed = parseCanvasRead(answer);
        if (parsed === null || request < lastApplied.current) return;
        lastApplied.current = request;
        setReads((previous) => {
          const next = { read: parsed, shown: parsed.canvas === null ? previous.shown : parsed };
          lastReads.set(`${sessionId}/${key}`, next);
          return next;
        });
      })
      .catch(() => undefined);
  }, [sessionId, key]);

  // Another canvas in the same viewer starts from what is known of that one.
  const shownKey = useRef(memoryKey);
  useEffect(() => {
    if (shownKey.current === memoryKey) return;
    shownKey.current = memoryKey;
    setReads(memoryKey === null ? NO_READ : (lastReads.get(memoryKey) ?? NO_READ));
    setView(memoryKey === null ? DEFAULT_VIEW : (memory.get(memoryKey) ?? DEFAULT_VIEW));
    setReadyPictures(new Set());
  }, [memoryKey]);

  const addReady = useCallback((hashes: readonly string[]) => {
    if (hashes.length === 0) return;
    setReadyPictures((previous) => (hashes.every((hash) => previous.has(hash)) ? previous : new Set([...previous, ...hashes])));
  }, []);

  // The files' hashes, as one string: an equal read asks for nothing again.
  const hashes = shown?.boards.map((board) => board.sha256 ?? '').join(',') ?? null;
  useEffect(() => {
    if (key === null || hashes === null) return;
    // The backend queues the missing pictures and says through `canvas-thumb` when each is drawn.
    invoke('canvas_thumbs', { sessionId, key })
      .then((answer) => addReady(readyHashes(answer)))
      .catch(() => undefined);
  }, [sessionId, key, hashes, addReady]);

  const thumbs = useMemo(() => {
    if (shown === null || readyPictures.size === 0) return NO_PICTURES;
    const pictures = new Map<string, string>();
    for (const board of shown.boards) {
      if (board.sha256 !== null && readyPictures.has(board.sha256)) pictures.set(board.id, canvasThumbUrl(board.sha256));
    }
    return pictures.size === 0 ? NO_PICTURES : pictures;
  }, [shown, readyPictures]);

  useEffect(() => {
    refresh();
  }, [refresh, turnsEnded]);

  useEffect(() => {
    if (key === null) return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const stopChanged = listen<unknown>(ARTIFACTS_CHANGED, (event) => {
      if ((event.payload as { sessionId?: unknown } | null)?.sessionId === sessionId) refresh();
    });
    const stopView = listen<unknown>(CANVAS_VIEW, (event) => {
      const change = parseViewEvent(event.payload, sessionId, key);
      if (change === null) return;
      setView((previous) => {
        const next = { ...previous, ...change };
        memory.set(`${sessionId}/${key}`, next);
        return next;
      });
    });
    const stopThumb = listen<unknown>(CANVAS_THUMB, (event) => {
      const hash = thumbEventHash(event.payload, sessionId, key);
      if (hash !== null) addReady([hash]);
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      void stopChanged.then((stop) => stop());
      void stopView.then((stop) => stop());
      void stopThumb.then((stop) => stop());
    };
  }, [sessionId, key, refresh, addReady]);

  return { read, lastGood: shown?.canvas ?? null, shown, refresh, selected: view.selected, zoom: view.zoom, thumbs };
}
