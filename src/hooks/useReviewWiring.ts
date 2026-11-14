import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ComposerHandle } from '../components/ComposerDock';
import { runOfSession } from '../lib/compare-run';
import type { ReviewOwner } from '../lib/composer-state';
import { asUnsent, reviewHeading, reviewMessage, type CheckedComment, type MessageContext } from '../lib/review-comments';
import type { ReviewComment, ReviewTarget, Session } from '../types';
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

export interface ReviewWiring {
  /** The comments, with Edit and Delete also taking a comment out of the message. */
  review: ReviewComments;
  addReview: AddReview;
  /** The composer's comments for the session on screen, while its message is still being written. */
  slot: ReviewSlot | null;
  /** The session the composer's comments are for, while that blocks Send here. */
  reviewOwner: ReviewOwner | undefined;
  /** Send would take the composer's comments somewhere other than their session. */
  blocksSend: boolean;
  /** The composer holds another session's comments, so nothing of `sessionId`'s may join them. */
  isHeldFor: (sessionId: string) => boolean;
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
  composerRef,
  canContinue,
  hasComposer,
  isComposerDisabled,
  collapseDiff,
  agentNameOf,
}: {
  /** The session on screen. */
  session: Session | undefined;
  sessions: readonly Session[];
  comments: ReviewComments;
  updateComments: (sessionId: string, change: (prev: ReviewComment[]) => ReviewComment[]) => void;
  composerRef: RefObject<ComposerHandle | null>;
  /** The session on screen takes a message itself. When not, Send falls through and starts a new session. */
  canContinue: boolean;
  /** False where a panel stands in the composer's place. */
  hasComposer: boolean;
  isComposerDisabled: boolean;
  /** Ends an expanded diff, which hides the composer. */
  collapseDiff: () => void;
  agentNameOf: (profileId: string) => string;
}): ReviewWiring {
  const change = (sessionId: string, ids: readonly string[], changed: (comment: ReviewComment) => ReviewComment) =>
    updateComments(sessionId, (prev) => prev.map((comment) => (ids.includes(comment.id) ? changed(comment) : comment)));
  const message = useReviewMessage({
    activeSessionId: session?.id,
    sessionIds: sessions.map((candidate) => candidate.id),
    markSent: (sessionId, ids) => {
      const sentAt = Date.now();
      change(sessionId, ids, (comment) => ({ ...comment, sentAt }));
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
    slot,
    reviewOwner: blocksSend
      ? { title: ownerTitle || null, isArchived: Boolean(owner?.archivedAt), cannotContinue: isOwnSessionStuck }
      : undefined,
    blocksSend,
    isHeldFor: message.isHeldFor,
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
