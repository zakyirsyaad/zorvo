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
  /** Restored text replaced the comments, which lifts the slot, unless it is the text they just went out in. */
  onComposerRestored: (text: string) => void;
  /** `text` came back to `sessionId`'s composer beside what is there, so a slot stays; it re-arms one for what just went out. */
  onComposerGivenBack: (sessionId: string, text: string) => void;
  /** Marks the slot's comments Sent and clears it, when `text` went to the slot's session. */
  sendFrom: (sessionId: string, text: string) => void;
}

/** Whether `block` stands alone in `text`: at either end or between blank lines, as messages given back together are joined. */
const holdsBlock = (text: string, block: string) => `\n\n${text}\n\n`.includes(`\n\n${block}\n\n`);

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
  // A message that did not reach the agent comes back holding its comments, already marked Sent: this says whom it is still for.
  const lastSend = useRef<(Pick<ReviewSlot, 'sessionId' | 'lastTarget'> & { text: string }) | null>(null);
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
    onComposerRestored: (text) => {
      const sent = lastSend.current;
      setSlot(sent?.text === text ? { sessionId: sent.sessionId, commentIds: [], lastTarget: sent.lastTarget } : null);
    },
    onComposerGivenBack: (sessionId, text) => {
      const sent = lastSend.current;
      if (!sent?.text || sent.sessionId !== sessionId || !holdsBlock(text, sent.text)) return;
      // A slot here keeps its comments; one for another session already blocks Send here.
      setSlot((prev) => prev ?? { sessionId, commentIds: [], lastTarget: sent.lastTarget });
    },
    sendFrom: (sessionId, text) => {
      if (slot?.sessionId !== sessionId) return;
      markSent(sessionId, slot.commentIds);
      lastSend.current = { sessionId, text, lastTarget: slot.lastTarget };
      setSlot(null);
    },
  };
}
