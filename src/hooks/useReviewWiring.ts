import { DESIGN_SYSTEM_QUOTE_RULE, designSystemHeading, designSystemMessage } from '../lib/design-system-comments';
import type { DesignSystemEntry } from '../lib/design-system-read';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ComposerHandle } from '../components/ComposerDock';
import { artifactHeading, artifactMessage, canvasHeading, canvasMessage, CANVAS_QUOTE_RULE, type CheckedArtifactComment } from '../lib/artifact-comments';
import type { Canvas, CanvasEntry } from '../lib/canvas';
import { runOfSession } from '../lib/compare-run';
import type { ReviewOwner } from '../lib/composer-state';
import { asUnsent, reviewHeading, reviewMessage, type CheckedComment, type MessageContext } from '../lib/review-comments';
import type { Artifact, ArtifactComment, ReviewComment, ReviewTarget, Session } from '../types';
import type { ReviewComments } from './useReviewComments';
import { useReviewMessage, type ReviewSlot } from './useReviewMessage';

const NO_COMPOSER = 'There is no message box for this session, so comments cannot be added.';
const COMPOSER_DISABLED = 'The message box is not available right now.';
const SLOT_ELSEWHERE = 'The message holds comments for another session. Go back to it, or clear the message.';

/** What the diff panel needs to put comments in the message. */
export interface AddReview {
  inMessage: ReadonlySet<string>;
  /** Why nothing can be added now; undefined when it can. */
  blockedReason: string | undefined;
  add: (comments: readonly CheckedComment[], target: ReviewTarget, context: MessageContext) => void;
}

/** What the artifact viewer needs to put its comments in the message. */
export interface AddArtifactReview {
  inMessage: ReadonlySet<string>;
  /** Why nothing can be added now; undefined when it can. The same reasons as the diff's. */
  blockedReason: string | undefined;
  add: (checked: readonly CheckedArtifactComment[], artifact: Artifact, cwd: string) => void;
  /** The same for comments on a canvas's artboards: a heading per artboard, in canvas order. */
  addCanvas: (checked: readonly CheckedArtifactComment[], entry: CanvasEntry, canvas: Canvas, cwd: string) => void;
  /** The same for comments on a design system: a heading, then the comments by what they are on. */
  addDesignSystem?: (checked: readonly CheckedArtifactComment[], entry: DesignSystemEntry) => void;
}

type ArtifactCommentsChange = (prev: ArtifactComment[]) => ArtifactComment[];

/** A comment going into a message again is plain until that message is sent. */
function unsent(comment: ArtifactComment): ArtifactComment {
  const { sentAt: _sentAt, ...rest } = comment;
  return rest;
}

export interface ReviewWiring {
  /** The comments, with Edit and Delete also taking a comment out of the message. */
  review: ReviewComments;
  addReview: AddReview;
  addArtifactReview: AddArtifactReview;
  /** Takes comments of either kind out of the message, when they are edited, deleted or swept. */
  forget: (ids: readonly string[]) => void;
  /** The composer's comments for the session on screen, while its message is still being written. */
  slot: ReviewSlot | null;
  /** The session the composer's comments are for, while that blocks Send here. */
  reviewOwner: ReviewOwner | undefined;
  /** Send would take the composer's comments somewhere other than their session. */
  blocksSend: boolean;
  /** The composer holds another session's comments, so nothing of `sessionId`'s may join them. */
  isHeldFor: (sessionId: string) => boolean;
  /** A canvas's Pick and Build: leaves an expanded canvas first, which hides the composer, then puts the text in. */
  insertCanvasText: (text: string) => void;
  sendFrom: (sessionId: string, text: string) => void;
  /** Puts back the slot of a message a secret review held, so its comments still go with it. */
  rearm: (slot: ReviewSlot) => void;
  onComposerText: (text: string) => void;
  onComposerRestored: (text: string) => void;
  onComposerGivenBack: (text: string) => void;
}

/** What `App` joins: the session's comments, the composer, and the slot that says whom its comments are for. */
export function useReviewWiring({
  session,
  sessions,
  comments,
  updateComments,
  updateArtifactComments,
  composerRef,
  canContinue,
  hasComposer,
  isComposerDisabled,
  collapseDiff,
  collapseArtifact,
  agentNameOf,
}: {
  /** The session on screen. */
  session: Session | undefined;
  sessions: readonly Session[];
  comments: ReviewComments;
  updateComments: (sessionId: string, change: (prev: ReviewComment[]) => ReviewComment[]) => void;
  updateArtifactComments?: (sessionId: string, change: ArtifactCommentsChange) => void;
  composerRef: RefObject<ComposerHandle | null>;
  /** The session on screen takes a message itself. When not, Send falls through and starts a new session. */
  canContinue: boolean;
  /** False where a panel stands in the composer's place. */
  hasComposer: boolean;
  isComposerDisabled: boolean;
  /** Ends an expanded diff, which hides the composer. */
  collapseDiff: () => void;
  /** Ends an expanded artifact page, which hides the composer too. */
  collapseArtifact?: () => void;
  agentNameOf: (profileId: string) => string;
}): ReviewWiring {
  const change = (sessionId: string, ids: readonly string[], changed: (comment: ReviewComment) => ReviewComment) =>
    updateComments(sessionId, (prev) => prev.map((comment) => (ids.includes(comment.id) ? changed(comment) : comment)));
  const changeArtifact = (sessionId: string, ids: readonly string[], changed: (comment: ArtifactComment) => ArtifactComment) =>
    updateArtifactComments?.(sessionId, (prev) => prev.map((comment) => (ids.includes(comment.id) ? changed(comment) : comment)));
  const message = useReviewMessage({
    activeSessionId: session?.id,
    sessionIds: sessions.map((candidate) => candidate.id),
    markSent: (sessionId, ids) => {
      const sentAt = Date.now();
      change(sessionId, ids, (comment) => ({ ...comment, sentAt }));
    },
    markArtifactSent: (sessionId, ids) => {
      const sentAt = Date.now();
      changeArtifact(sessionId, ids, (comment) => ({ ...comment, sentAt }));
    },
  });
  const { slot, inMessage, sendFrom, rearm, onComposerText, onComposerRestored, onComposerGivenBack } = message;
  const isOwnSessionStuck = slot !== null && slot.sessionId === session?.id && !canContinue;
  const blocksSend = message.blocksSend || isOwnSessionStuck;

  const blockedReason = !hasComposer
    ? NO_COMPOSER
    : isComposerDisabled
      ? COMPOSER_DISABLED
      : message.blocksSend
        ? SLOT_ELSEWHERE
        : undefined;

  const add: AddReview['add'] = (checked, target, context) => {
    const composer = composerRef.current;
    if (!session || !composer || blockedReason) return;
    // The composer takes the focus below, so it has to be on screen first.
    flushSync(collapseDiff);
    const withHeading = message.needsHeading(session.id, target, reviewHeading(target, context));
    composer.insertText(reviewMessage(checked, target, context, withHeading));
    const ids = checked.map(({ comment }) => comment.id);
    change(session.id, ids, asUnsent);
    message.add(session.id, ids, target);
  };

  const addArtifact: AddArtifactReview['add'] = (checked, artifact, cwd) => {
    const composer = composerRef.current;
    if (!session || !composer || blockedReason || checked.length === 0) return;
    // The composer takes the focus below, so an expanded page must give it its place first.
    flushSync(() => collapseArtifact?.());
    const withHeading = message.needsArtifactHeading(session.id, artifact.id, artifactHeading(artifact, cwd));
    composer.insertText(artifactMessage(checked, artifact, cwd, withHeading));
    const ids = checked.map(({ comment }) => comment.id);
    changeArtifact(session.id, ids, unsent);
    message.addArtifact(session.id, ids, artifact.id);
  };

  const addCanvas: AddArtifactReview['addCanvas'] = (checked, entry, canvas, cwd) => {
    const composer = composerRef.current;
    if (!session || !composer || blockedReason || checked.length === 0) return;
    flushSync(() => collapseArtifact?.());
    // The message may already end with this canvas's first artboard: its heading is not written again.
    const first = canvas.sections
      .flatMap((section) => section.artboards)
      .find((board) => checked.some(({ comment }) => comment.canvas?.artboardId === board.id));
    // Comments of removed artboards have no artboard to continue; their group always gets its heading.
    const heading = first ? canvasHeading(entry, canvas, first, cwd) + CANVAS_QUOTE_RULE : '';
    const isContinued = first ? !message.needsArtifactHeading(session.id, `${entry.key}/${first.id}`, heading) : false;
    const { text, lastArtboardId } = canvasMessage(checked, entry, canvas, cwd, first && isContinued ? first.id : null);
    composer.insertText(text);
    const ids = checked.map(({ comment }) => comment.id);
    changeArtifact(session.id, ids, unsent);
    message.addArtifact(session.id, ids, `${entry.key}/${lastArtboardId ?? first?.id ?? ''}`);
  };

  const addDesignSystem: NonNullable<AddArtifactReview['addDesignSystem']> = (checked, entry) => {
    const composer = composerRef.current;
    if (!session || !composer || blockedReason || checked.length === 0) return;
    flushSync(() => collapseArtifact?.());
    const heading = designSystemHeading(entry) + DESIGN_SYSTEM_QUOTE_RULE;
    const withHeading = message.needsArtifactHeading(session.id, entry.key, heading);
    composer.insertText(designSystemMessage(checked, entry, withHeading));
    const ids = checked.map(({ comment }) => comment.id);
    changeArtifact(session.id, ids, unsent);
    message.addArtifact(session.id, ids, entry.key);
  };

  const insertCanvasText = (text: string) => {
    flushSync(() => collapseArtifact?.());
    composerRef.current?.insertText(text);
  };

  const owner = blocksSend && slot ? sessions.find((candidate) => candidate.id === slot.sessionId) : undefined;
  // A run's sessions share one title, so only the agent tells them apart: in the run, and once archived out of it.
  // A Pick's winner keeps its id, but it is a plain session again and the sidebar lists it by title.
  const isRunMember = owner?.compareRunId && (owner.archivedAt || runOfSession(sessions, owner.id));
  const ownerTitle = owner && isRunMember ? agentNameOf(owner.profileId) : owner?.name;

  return {
    review: {
      ...comments,
      editComment: (id, body) => {
        message.forget([id]);
        comments.editComment(id, body);
      },
      deleteComment: (id) => {
        message.forget([id]);
        comments.deleteComment(id);
      },
    },
    addReview: { inMessage, blockedReason, add },
    addArtifactReview: { inMessage: message.inMessageArtifact, blockedReason, add: addArtifact, addCanvas, addDesignSystem },
    forget: message.forget,
    slot,
    reviewOwner: blocksSend
      ? { title: ownerTitle || null, isArchived: Boolean(owner?.archivedAt), cannotContinue: isOwnSessionStuck }
      : undefined,
    blocksSend,
    isHeldFor: message.isHeldFor,
    insertCanvasText,
    sendFrom,
    rearm,
    onComposerText,
    onComposerRestored,
    // A message only ever comes back to the composer of the session on screen.
    onComposerGivenBack: (text) => {
      if (session) onComposerGivenBack(session.id, text);
    },
  };
}
