import { useRef, useState } from 'react';
import { createId } from '../lib/ids';
import type { UnifiedRow } from '../lib/git-changes';
import { asUnsent, lineHash, MAX_COMMENT_LENGTH, MAX_COMMENTS_PER_SESSION, quoteOf } from '../lib/review-comments';
import type { ReviewComment, ReviewTarget } from '../types';

/**
 * A comment being written. All but `body` is taken when the box opens: a row that
 * changes under it reads Outdated, and a file that leaves the diff keeps its old path.
 */
export interface CommentDraft {
  body: string;
  lineHash: string;
  quote: string;
  /** The path before a rename, for a comment on a removed line. */
  oldFile?: string;
}

/** `${target}:${file}:${side}:${line}`, or `edit:${id}` while a saved comment is edited. */
export type DraftKey = string;

/** Where a new comment goes. */
export type CommentAnchor = Omit<ReviewComment, 'id' | 'body' | 'createdAt' | 'lineHash' | 'quote' | 'oldFile' | 'sentAt'>;

export interface ReviewComments {
  comments: readonly ReviewComment[];
  /** This session's open boxes, so one whose row has left the diff can still be shown. */
  draftKeys: readonly DraftKey[];
  draftFor: (key: DraftKey) => CommentDraft | undefined;
  /** Leaves a box that is already open as it is. */
  openDraft: (key: DraftKey, row: UnifiedRow, oldFile?: string) => void;
  openEdit: (comment: ReviewComment) => void;
  setDraftBody: (key: DraftKey, body: string) => void;
  closeDraft: (key: DraftKey) => void;
  /** Returns false, and keeps the box, when the session is at `MAX_COMMENTS_PER_SESSION`. */
  saveDraft: (key: DraftKey, anchor: CommentAnchor) => boolean;
  /** An edited comment is plain again, so it can be added afresh: this clears `sentAt`. */
  editComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;
  clearSent: () => void;
}

export function draftKeyOf({ target, file, side, line }: CommentAnchor): DraftKey {
  return `${target}:${file}:${side}:${line}`;
}

export function editDraftKeyOf(id: string): DraftKey {
  return `edit:${id}`;
}

/** The place in a new comment's key, or null for an edit's. A path may hold colons, so the match runs from both ends. */
export function parseDraftKey(key: DraftKey): CommentAnchor | null {
  const match = /^(head|base|start):(.*):(new|old):(\d+)$/s.exec(key);
  if (!match) return null;
  const [, target, file, side, line] = match;
  return { target: target as ReviewTarget, file, side: side as CommentAnchor['side'], line: Number(line) };
}

/**
 * The active session's comments, and the comments being written, per session.
 * A box's text survives a refresh and a session switch, and goes with a restart.
 * This hook sits in `App`, and typing must not redraw `App`: so the drafts live in
 * a ref, and only opening or closing a box redraws.
 */
export function useReviewComments(
  sessionId: string | undefined,
  comments: readonly ReviewComment[] | undefined,
  update: (sessionId: string, change: (prev: ReviewComment[]) => ReviewComment[]) => void,
): ReviewComments {
  const drafts = useRef<Readonly<Record<string, Readonly<Record<DraftKey, CommentDraft>>>>>({});
  const [, redraw] = useState(0);
  const list = comments ?? [];
  const session = sessionId ?? '';

  const sessionDrafts = () => drafts.current[session] ?? {};
  const write = (next: Readonly<Record<DraftKey, CommentDraft>>) => {
    drafts.current = { ...drafts.current, [session]: next };
  };
  const open = (key: DraftKey, draft: CommentDraft) => {
    if (sessionDrafts()[key]) return;
    write({ ...sessionDrafts(), [key]: draft });
    redraw((n) => n + 1);
  };
  const closeDraft = (key: DraftKey) => {
    const { [key]: closed, ...rest } = sessionDrafts();
    if (!closed) return;
    write(rest);
    redraw((n) => n + 1);
  };
  const change = (next: (prev: ReviewComment[]) => ReviewComment[]) => {
    if (sessionId) update(sessionId, next);
  };

  return {
    comments: list,
    draftKeys: Object.keys(sessionDrafts()),
    draftFor: (key) => sessionDrafts()[key],
    openDraft: (key, row, oldFile) =>
      open(key, { body: '', lineHash: lineHash(row.text), quote: quoteOf(row.text), ...(oldFile ? { oldFile } : {}) }),
    openEdit: (comment) =>
      open(editDraftKeyOf(comment.id), { body: comment.body, lineHash: comment.lineHash, quote: comment.quote }),
    setDraftBody: (key, body) => {
      const draft = sessionDrafts()[key];
      if (draft) write({ ...sessionDrafts(), [key]: { ...draft, body } });
    },
    closeDraft,
    saveDraft: (key, anchor) => {
      const draft = sessionDrafts()[key];
      if (!draft || list.length >= MAX_COMMENTS_PER_SESSION) return false;
      const comment: ReviewComment = {
        ...anchor,
        ...(draft.oldFile ? { oldFile: draft.oldFile } : {}),
        id: createId('comment'),
        body: draft.body.slice(0, MAX_COMMENT_LENGTH),
        lineHash: draft.lineHash,
        quote: draft.quote,
        createdAt: Date.now(),
      };
      change((prev) => [...prev, comment]);
      closeDraft(key);
      return true;
    },
    editComment: (id, body) => {
      change((prev) =>
        prev.map((comment) =>
          comment.id === id ? { ...asUnsent(comment), body: body.slice(0, MAX_COMMENT_LENGTH) } : comment,
        ),
      );
      closeDraft(editDraftKeyOf(id));
    },
    deleteComment: (id) => {
      change((prev) => prev.filter((comment) => comment.id !== id));
      closeDraft(editDraftKeyOf(id));
    },
    clearSent: () => change((prev) => prev.filter((comment) => comment.sentAt === undefined)),
  };
}
