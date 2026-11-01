import { useRef, useState } from 'react';
import type { ReviewTarget } from '../types';

/** Which session the comments added to the composer are for. */
export interface ReviewSlot {
  sessionId: string;
  commentIds: readonly string[];
  lastTarget: ReviewTarget;
}

export interface ReviewMessage {
  slot: ReviewSlot | null;
  /** Comments in the message, for the active session only. */
  inMessage: ReadonlySet<string>;
  /** The composer holds comments for another session, or none is on screen. */
  blocksSend: boolean;
  /** Call it after the text went into the composer, so a composer that took nothing leaves no slot. */
  add: (sessionId: string, ids: readonly string[], target: ReviewTarget) => void;
  /** The composer's text already has `heading` only after an add for this session and target, and only while it still holds it. */
  needsHeading: (sessionId: string, target: ReviewTarget, heading: string) => boolean;
  /** Takes edited or deleted comments out. The slot stays, since their text stays in the composer. */
  forget: (ids: readonly string[]) => void;
  /** Lifts the slot when no text is left: `handleSend` sends nothing for spaces, so they count as empty. */
  onComposerText: (text: string) => void;
  /** Lifts the slot: restored text replaced the comments. */
  onComposerRestored: () => void;
  /** Marks the slot's comments Sent and clears it, when the message went to the slot's session. */
  sendFrom: (sessionId: string) => void;
}

/**
 * One composer serves every session and keeps its text across a switch, so this remembers whom
 * added comments are for. In memory only, as composer text is: after a restart they are plain comments.
 */
export function useReviewMessage({ activeSessionId, markSent }: {
  activeSessionId: string | undefined;
  markSent: (sessionId: string, ids: readonly string[]) => void;
}): ReviewMessage {
  const [slot, setSlot] = useState<ReviewSlot | null>(null);
  // Read only for the heading, which says quoted lines are not instructions: replacing the text keeps the slot.
  const composerText = useRef('');
  const isActiveSessions = slot !== null && slot.sessionId === activeSessionId;

  return {
    slot,
    inMessage: new Set(isActiveSessions ? slot.commentIds : []),
    blocksSend: slot !== null && !isActiveSessions,
    add: (sessionId, ids, target) =>
      setSlot((prev) => ({
        sessionId,
        commentIds: prev?.sessionId === sessionId ? [...new Set([...prev.commentIds, ...ids])] : [...ids],
        lastTarget: target,
      })),
    needsHeading: (sessionId, target, heading) =>
      slot?.sessionId !== sessionId || slot.lastTarget !== target || !composerText.current.includes(heading),
    forget: (ids) => setSlot((prev) => prev && { ...prev, commentIds: prev.commentIds.filter((id) => !ids.includes(id)) }),
    onComposerText: (text) => {
      composerText.current = text;
      if (text.trim() === '') setSlot(null);
    },
    onComposerRestored: () => setSlot(null),
    sendFrom: (sessionId) => {
      if (slot?.sessionId !== sessionId) return;
      markSent(sessionId, slot.commentIds);
      setSlot(null);
    },
  };
}
