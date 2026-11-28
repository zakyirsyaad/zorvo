import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { canvasMarksFor } from '../lib/artifact-comments';
import type { BoardState } from '../lib/canvas';
import type { ArtifactComment, PageMark } from '../types';
import { enqueueArtifactViewCall } from './useArtifactView';
import { useLatest } from './useLatest';

/** Emitted with `{ sessionId, key, kind: "board-loaded", artboardId }` when a live artboard's frame has loaded. */
const CANVAS_VIEW = 'canvas-view';
const COULD_NOT_MARK = 'Zorvo could not mark that artboard.';
const NO_MARKS = '[]';

function loadedBoardOf(payload: unknown, sessionId: string, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as Record<string, unknown>;
  if (event.sessionId !== sessionId || event.key !== key || event.kind !== 'board-loaded') return null;
  return typeof event.artboardId === 'string' ? event.artboardId : null;
}

/**
 * Sends each artboard of the canvas on screen the marks of its Current comments: when they change,
 * and again when the wrapper says the artboard's frame loaded (the backend keeps none, and a frame
 * that loads later knows nothing). Only marks that differ from the last ones sent go out.
 */
export function useCanvasMarks(
  sessionId: string,
  key: string,
  comments: readonly ArtifactComment[] | undefined,
  boards: readonly BoardState[] | undefined,
  onError: (message: string) => void,
): void {
  const byBoard = useMemo(() => {
    const marks = new Map<string, PageMark[]>();
    if (comments === undefined) return marks;
    for (const board of boards ?? []) marks.set(board.id, canvasMarksFor(comments, key, board.id, board.sha256));
    return marks;
  }, [comments, boards, key]);
  const signature = JSON.stringify([...byBoard]);
  const byBoardRef = useLatest(byBoard);
  const onErrorRef = useLatest(onError);
  // What each artboard was last sent, as JSON; an artboard never sent anything has none.
  const lastSent = useRef(new Map<string, string>());

  const send = useLatest((artboardId: string, marks: PageMark[]) => {
    lastSent.current.set(artboardId, JSON.stringify(marks));
    enqueueArtifactViewCall(
      () => invoke('canvas_view_marks', { sessionId, key, artboardId, marks }),
      () => onErrorRef.current(COULD_NOT_MARK),
    );
  });

  useEffect(() => {
    for (const [artboardId, marks] of byBoardRef.current) {
      if ((lastSent.current.get(artboardId) ?? NO_MARKS) !== JSON.stringify(marks)) send.current(artboardId, marks);
    }
  }, [signature, byBoardRef, send]);

  const isOn = comments !== undefined;
  useEffect(() => {
    if (!isOn) return;
    const stop = listen<unknown>(CANVAS_VIEW, (event) => {
      const artboardId = loadedBoardOf(event.payload, sessionId, key);
      const marks = artboardId === null ? undefined : byBoardRef.current.get(artboardId);
      if (artboardId !== null && marks !== undefined) send.current(artboardId, marks);
    });
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [isOn, sessionId, key, byBoardRef, send]);
}
