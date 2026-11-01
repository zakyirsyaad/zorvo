import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import { withAttachments } from '../lib/attachments';
import { useLatest } from './useLatest';

interface Unsent {
  text: string;
  attachments: readonly string[];
}

export interface UnsentMessagesDeps {
  composerRef: RefObject<ComposerHandle | null>;
  activeSessionId: string;
  /** Every session that still exists: what is kept for any other is dropped. */
  sessionIds: readonly string[];
}

/** Several messages that came back together read as one, in the order they were written. */
function combined(messages: readonly Unsent[]): Unsent {
  return {
    text: messages
      .map((m) => m.text)
      .filter((text) => text !== '')
      .join('\n\n'),
    attachments: messages.reduce<string[]>((all, m) => withAttachments(all, m.attachments), []),
  };
}

/**
 * Gives a message that did not reach its agent back to the composer of the session it was written for.
 * One composer serves every session, so a message for a session that is not on screen waits (in memory)
 * until that session is, and goes into no other session's composer. What the user typed meanwhile stays.
 */
export function useUnsentMessages(deps: UnsentMessagesDeps) {
  const kept = useRef(new Map<string, Unsent[]>());
  const latest = useLatest(deps);

  const deliver = useCallback(({ composerRef, activeSessionId }: UnsentMessagesDeps) => {
    const waiting = kept.current.get(activeSessionId);
    // A run's panel has no composer: the message waits for the session's to mount.
    if (!waiting || !composerRef.current) return;
    kept.current.delete(activeSessionId);
    const { text, attachments } = combined(waiting);
    composerRef.current.giveBack(text, attachments);
  }, []);

  // After every render: the composer may have mounted, or the session come on screen, since the message was kept.
  useEffect(() => {
    for (const sessionId of kept.current.keys()) {
      if (!deps.sessionIds.includes(sessionId)) kept.current.delete(sessionId);
    }
    deliver(deps);
  });

  const giveBack = useCallback(
    (sessionId: string, text: string, attachments: readonly string[] = []) => {
      kept.current.set(sessionId, [...(kept.current.get(sessionId) ?? []), { text, attachments }]);
      deliver(latest.current);
    },
    [deliver, latest],
  );

  return { giveBack };
}
