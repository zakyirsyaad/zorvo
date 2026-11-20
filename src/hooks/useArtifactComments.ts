import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { anchorOfPick, marksFor, MAX_ARTIFACT_COMMENTS, parseCanvasPick, parsePagePick, withoutMissingArtifacts } from '../lib/artifact-comments';
import type { BoardState } from '../lib/canvas';
import { createId } from '../lib/ids';
import { MAX_COMMENT_LENGTH } from '../lib/review-comments';
import type { Artifact, ArtifactAnchor, ArtifactComment, PageMessage, PageRef, Session } from '../types';
import { enqueueArtifactViewCall } from './useArtifactView';
import { useLatest } from './useLatest';

/** Emitted by the backend when an artifact page reports a pick, a cancel or marks it could not find. */
const ARTIFACT_PAGE_PICK = 'artifact-page-pick';
/** Emitted by the backend when an artboard of the canvas on screen reports one of those. */
const CANVAS_PICK = 'canvas-pick';
const COULD_NOT_MARK = 'Zorvo could not mark that page.';
const COULD_NOT_COMMENT = 'Zorvo could not turn comment mode on for that page.';

type ArtifactCommentsChange = (prev: ArtifactComment[]) => ArtifactComment[];

/**
 * What a pick made, waiting for the user's text. It keeps the page it was picked on; on a canvas
 * that is the canvas key with version 0, and `artboardId` names the artboard.
 */
export interface ArtifactCandidate {
  page: PageRef;
  artboardId?: string;
  anchor: ArtifactAnchor;
  /** A newer pick arrived while text was typed here, so it was not taken. */
  isPickHeld: boolean;
}

export interface ArtifactCommentsState {
  sessionId: string;
  comments: readonly ArtifactComment[];
  /** Comment mode is on for the page on screen. */
  isCommenting: boolean;
  setCommenting: (on: boolean) => void;
  /** The session's candidate, whichever version it was picked on. */
  candidate: ArtifactCandidate | null;
  /** Kept outside React state: typing must not redraw `App`. */
  candidateBody: () => string;
  setCandidateBody: (body: string) => void;
  cancelCandidate: () => void;
  /** On a canvas, `boards` gives the artboard's file hash now; `gone` when its file is missing. */
  saveCandidate: (boards?: readonly BoardState[]) => SaveOutcome;
  /** Opens the candidate box for a comment on a whole artboard of the canvas on screen. */
  startArtboardComment: (artboardId: string) => void;
  /** Numbers the page on screen could not find again. */
  missing: ReadonlySet<number>;
  /** The same for each artboard of the canvas on screen, by artboard id. */
  canvasMissing: ReadonlyMap<string, ReadonlySet<number>>;
  /** An edited comment is plain again, and leaves the message. */
  editComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;
  /** Removes the artifact's sent comments. */
  clearSent: (artifactId: string) => void;
}

export type SaveOutcome = 'saved' | 'empty' | 'full' | 'gone';

/** The canvas the viewer shows, for its comments. */
export interface ShownCanvasRef {
  sessionId: string;
  key: string;
}

const keyOf = (page: PageRef | null) => (page === null ? null : `${page.sessionId}/${page.artifactId}/${page.version}`);
const canvasKeyOf = (canvas: ShownCanvasRef | null) => (canvas === null ? null : `canvas:${canvas.sessionId}/${canvas.key}`);
/** A canvas has no versions: its comments' place is the canvas key with this version. */
const CANVAS_VERSION = 0;
const NO_NUMBERS: ReadonlySet<number> = new Set();
const NO_BOARD_NUMBERS: ReadonlyMap<string, ReadonlySet<number>> = new Map();

function failure(error: unknown, fallback: string): string {
  return typeof error === 'string' && error !== '' ? error : fallback;
}

function plain(comment: ArtifactComment, body: string): ArtifactComment {
  const { sentAt: _sentAt, ...rest } = comment;
  return { ...rest, body };
}

/**
 * The comments of the session on screen and what its artifact page reports.
 * Picks count only for the page on screen while comment mode is on; marks go
 * to that page whenever its comments change. Main window only.
 */
export function useArtifactComments({
  sessionId,
  comments,
  update,
  shownPage,
  shownCanvas = null,
  forget,
  onError,
}: {
  sessionId: string | undefined;
  comments: readonly ArtifactComment[] | undefined;
  update: (sessionId: string, change: ArtifactCommentsChange) => void;
  /** Null unless the viewer shows a page of the session on screen. */
  shownPage: PageRef | null;
  /** Null unless the viewer shows a canvas of the session on screen. */
  shownCanvas?: ShownCanvasRef | null;
  forget: (ids: readonly string[]) => void;
  onError: (message: string) => void;
}): ArtifactCommentsState {
  const session = sessionId ?? '';
  const list = comments ?? [];
  const shownKey = keyOf(shownPage) ?? canvasKeyOf(shownCanvas);
  const [commenting, setCommentingPage] = useState<string | null>(null);
  // Another page on screen (another artifact, version or session) starts with comment mode off.
  const [lastShownKey, setLastShownKey] = useState(shownKey);
  if (lastShownKey !== shownKey) {
    setLastShownKey(shownKey);
    setCommentingPage(null);
  }
  const isCommenting = commenting !== null && commenting === shownKey;

  const [candidates, setCandidates] = useState<Readonly<Record<string, ArtifactCandidate>>>({});
  const bodies = useRef<Record<string, string>>({});
  const candidate = candidates[session] ?? null;

  const marks = shownPage ? marksFor(list, shownPage.artifactId, shownPage.version) : [];
  const marksKey = shownPage ? `${shownKey}|${JSON.stringify(marks)}` : null;
  const [missing, setMissing] = useState<{ key: string; numbers: ReadonlySet<number> } | null>(null);
  const [canvasMissing, setCanvasMissing] = useState<{ key: string; byBoard: ReadonlyMap<string, ReadonlySet<number>> } | null>(null);

  const latest = useLatest({ shownPage, shownKey, isCommenting, marksKey });

  const dropCandidate = (owner: string) => {
    delete bodies.current[owner];
    setCandidates((prev) => {
      if (!(owner in prev)) return prev;
      const next = { ...prev };
      delete next[owner];
      return next;
    });
  };

  // A pick, a cancel or missing marks of the page or canvas on screen. `artboardId` is set for a canvas.
  const takeMessage = useLatest((page: PageRef, artboardId: string | undefined, message: PageMessage) => {
    const now = latest.current;
    if (message.kind === 'marks-missing') {
      if (artboardId === undefined) {
        if (now.marksKey !== null) setMissing({ key: now.marksKey, numbers: new Set(message.numbers) });
        return;
      }
      const key = now.shownKey ?? '';
      setCanvasMissing((prev) => {
        const byBoard = new Map(prev?.key === key ? prev.byBoard : []);
        byBoard.set(artboardId, new Set(message.numbers));
        return { key, byBoard };
      });
      return;
    }
    if (!now.isCommenting) return;
    const owner = page.sessionId;
    // Whether text is typed is read when the update applies, not when the event arrived:
    // a keystroke in between must not be overwritten.
    const isBlank = () => (bodies.current[owner] ?? '').trim() === '';
    if (message.kind === 'cancel') {
      setCandidates((prev) => {
        if (!(owner in prev) || !isBlank()) return prev;
        delete bodies.current[owner];
        const next = { ...prev };
        delete next[owner];
        return next;
      });
      return;
    }
    const anchor = anchorOfPick(message);
    if (anchor === null) return;
    offerCandidate(owner, { page, anchor, isPickHeld: false, ...(artboardId === undefined ? {} : { artboardId }) }, isBlank);
  });

  // A new candidate never replaces typed text: the one being written is marked as holding a pick.
  const offerCandidate = (owner: string, next: ArtifactCandidate, isBlank: () => boolean) =>
    setCandidates((prev) => {
      const current = prev[owner];
      if (current && !isBlank()) return current.isPickHeld ? prev : { ...prev, [owner]: { ...current, isPickHeld: true } };
      bodies.current[owner] = '';
      return { ...prev, [owner]: next };
    });

  useEffect(() => {
    let isGone = false;
    const stopPage = listen<unknown>(ARTIFACT_PAGE_PICK, (event) => {
      if (isGone) return;
      const pick = parsePagePick(event.payload);
      if (pick === null || keyOf(pick.page) !== latest.current.shownKey) return;
      takeMessage.current(pick.page, undefined, pick.message);
    });
    const stopCanvas = listen<unknown>(CANVAS_PICK, (event) => {
      if (isGone) return;
      const pick = parseCanvasPick(event.payload);
      if (pick === null || canvasKeyOf(pick) !== latest.current.shownKey) return;
      const page = { sessionId: pick.sessionId, artifactId: pick.key, version: CANVAS_VERSION };
      takeMessage.current(page, pick.artboardId, pick.message);
    });
    return () => {
      isGone = true;
      void stopPage.then((stop) => stop());
      void stopCanvas.then((stop) => stop());
    };
  }, [latest, takeMessage]);

  const pageRef = useLatest(shownPage);
  const marksRef = useLatest(marks);
  const onErrorRef = useLatest(onError);
  useEffect(() => {
    const page = pageRef.current;
    if (marksKey === null || page === null) return;
    const sent = marksRef.current;
    enqueueArtifactViewCall(
      () => invoke('artifact_view_marks', { sessionId: page.sessionId, artifactId: page.artifactId, version: page.version, marks: sent }),
      (error) => onErrorRef.current(failure(error, COULD_NOT_MARK)),
    );
  }, [marksKey, pageRef, marksRef, onErrorRef]);

  const setCommenting = (on: boolean) => {
    const reportFailure = (error: unknown) => onErrorRef.current(failure(error, COULD_NOT_COMMENT));
    if (shownPage !== null) {
      setCommentingPage(on ? shownKey : null);
      const page = shownPage;
      enqueueArtifactViewCall(
        () => invoke('artifact_comment_mode', { sessionId: page.sessionId, artifactId: page.artifactId, version: page.version, on }),
        reportFailure,
      );
      return;
    }
    if (shownCanvas === null) return;
    setCommentingPage(on ? shownKey : null);
    const canvas = shownCanvas;
    enqueueArtifactViewCall(() => invoke('canvas_comment_mode', { sessionId: canvas.sessionId, key: canvas.key, on }), reportFailure);
  };

  const startArtboardComment = (artboardId: string) => {
    if (shownCanvas === null) return;
    const owner = shownCanvas.sessionId;
    const page = { sessionId: owner, artifactId: shownCanvas.key, version: CANVAS_VERSION };
    offerCandidate(owner, { page, artboardId, anchor: { kind: 'artboard' }, isPickHeld: false }, () => (bodies.current[owner] ?? '').trim() === '');
  };

  const saveCandidate = (boards: readonly BoardState[] = []): SaveOutcome => {
    const waiting = candidates[session];
    const body = (bodies.current[session] ?? '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (!waiting || body === '') return 'empty';
    if (list.length >= MAX_ARTIFACT_COMMENTS) return 'full';
    const { artboardId } = waiting;
    const fileHash = artboardId === undefined ? null : (boards.find((board) => board.id === artboardId)?.sha256 ?? null);
    if (artboardId !== undefined && fileHash === null) return 'gone';
    const comment: ArtifactComment = {
      id: createId('ac'),
      artifactId: waiting.page.artifactId,
      version: waiting.page.version,
      anchor: waiting.anchor,
      body,
      createdAt: Date.now(),
      ...(artboardId !== undefined && fileHash !== null ? { canvas: { key: waiting.page.artifactId, artboardId, fileHash } } : {}),
    };
    update(session, (prev) => [...prev, comment]);
    dropCandidate(session);
    return 'saved';
  };

  const missingNow = missing !== null && missing.key === marksKey ? missing.numbers : NO_NUMBERS;

  return {
    sessionId: session,
    comments: list,
    isCommenting,
    setCommenting,
    candidate,
    candidateBody: () => bodies.current[session] ?? '',
    setCandidateBody: (body) => {
      bodies.current[session] = body;
    },
    cancelCandidate: () => dropCandidate(session),
    saveCandidate,
    startArtboardComment,
    missing: missingNow,
    canvasMissing: canvasMissing !== null && canvasMissing.key === shownKey ? canvasMissing.byBoard : NO_BOARD_NUMBERS,
    editComment: (id, body) => {
      const text = body.trim().slice(0, MAX_COMMENT_LENGTH);
      if (text === '') return;
      forget([id]);
      update(session, (prev) => prev.map((comment) => (comment.id === id ? plain(comment, text) : comment)));
    },
    deleteComment: (id) => {
      forget([id]);
      update(session, (prev) => prev.filter((comment) => comment.id !== id));
    },
    clearSent: (artifactId) =>
      update(session, (prev) => prev.filter((comment) => comment.artifactId !== artifactId || comment.sentAt === undefined)),
  };
}

/**
 * Removes the comments of artifacts that are gone, for every session whose
 * artifacts were read without failure, and takes them out of the message.
 */
export function useArtifactCommentSweep(
  sessions: readonly Session[],
  bySession: ReadonlyMap<string, readonly Artifact[]>,
  readSessions: ReadonlySet<string>,
  update: (sessionId: string, change: ArtifactCommentsChange) => void,
  forget: (ids: readonly string[]) => void,
): void {
  const updateRef = useLatest(update);
  const forgetRef = useLatest(forget);
  useEffect(() => {
    for (const session of sessions) {
      const comments = session.artifactComments;
      const artifacts = bySession.get(session.id);
      if (!comments || comments.length === 0 || !artifacts || !readSessions.has(session.id)) continue;
      const kept = withoutMissingArtifacts(comments, artifacts);
      if (kept === comments) continue;
      const keptIds = new Set(kept.map((comment) => comment.id));
      forgetRef.current(comments.filter((comment) => !keptIds.has(comment.id)).map((comment) => comment.id));
      updateRef.current(session.id, (prev) => withoutMissingArtifacts(prev, artifacts));
    }
  }, [sessions, bySession, readSessions, updateRef, forgetRef]);
}
