import { useCallback, useMemo, useRef, useState } from 'react';
import type { NextStepView } from '../components/chat/NextStepBox';
import type { BackgroundTask } from '../lib/background-tasks';
import { turnChangedFiles, type NextStepButton } from '../lib/next-step';
import type { ChatMessage, Session } from '../types';
import type { PullRequestStatus } from './usePullRequest';
import { useLatest } from './useLatest';
import { useNextStepFacts } from './useNextStepFacts';

export interface NextStepArgs {
  /** The session on screen. */
  session: Session | null;
  sessions: readonly Session[];
  messages: readonly ChatMessage[];
  isBusy: boolean;
  /** Something in the chat waits for the user's answer. */
  isWaiting: boolean;
  /**
   * The session has ended (every session reads ended after a restart) and a press may continue it:
   * its agent is here and it has its own agent session to resume. `send` then resumes it.
   */
  canResume: boolean;
  /** Why the composer cannot send now, when it cannot. */
  blockedReason: string | undefined;
  pullRequest: PullRequestStatus | null;
  tasks: readonly BackgroundTask[];
  /** The composer's own Send for `text` (a resume for an ended session), without giving a refused text back into the composer; resolves true when the agent took it. */
  send: (sessionId: string, text: string) => Promise<boolean>;
  updateMessages: (sessionId: string, update: (messages: ChatMessage[]) => ChatMessage[]) => void;
  /** Opens a pull request in the user's browser. */
  openUrl: (url: string) => void;
  /** Opens a dev server in Zorvo's Browser panel. */
  openPreview: (url: string) => void;
}

/**
 * A worker reports to its coordinator, and a compare run's panel replaces its chat: neither gets a
 * box. An ended session keeps its box while a press can continue it, so a restart, which ends every
 * session, does not take the last box away; an archived one does not, as a press would bring it back.
 */
function isEligible(session: Session, canResume: boolean): boolean {
  const isWorker = Boolean(session.delegatedFrom && !session.delegatedFrom.endedAt);
  if (isWorker || session.compareRunId) return false;
  return session.status === 'running' || (canResume && !session.archivedAt);
}

function withAnswer(messages: ChatMessage[], messageId: string, label: string, at: number): ChatMessage[] {
  return messages.map((message) =>
    message.id === messageId ? { ...message, nextStep: { ...message.nextStep, answered: { label, at } } } : message,
  );
}

/**
 * The active next-step box of the session on screen: under its last reply, once a turn ended on
 * its own and nothing waits or works. A press sends its words through the composer's Send and
 * records the answer only when the agent took it; Open PR and Open in Zorvo's browser only open.
 */
export function useNextStep(args: NextStepArgs): NextStepView | null {
  const { session, messages, isBusy, isWaiting, canResume, blockedReason, pullRequest, tasks, send, updateMessages, openUrl, openPreview } = args;
  const last = messages[messages.length - 1];
  const reply = last?.role === 'agent' && last.endedNormally ? last : undefined;
  const isActive = session !== null && isEligible(session, canResume) && reply !== undefined && !isBusy && !isWaiting;
  const turnChanged = useMemo(() => turnChangedFiles(messages), [messages]);
  const facts = useNextStepFacts({ session, isActive, pullRequest, tasks });
  const [isSending, setIsSending] = useState(false);
  const sending = useRef(false);

  // Read at press time, so a new callback from the parent does not make a new view for every row.
  const latest = useLatest({ session, reply, facts, send, updateMessages, openUrl, openPreview });
  const onPress = useCallback(
    (button: NextStepButton) => {
      const { session: current, reply: shown, facts: known } = latest.current;
      if (current === null || shown === undefined) return;
      if (button.kind === 'action' && button.action === 'open_pr') {
        if (known.pr) latest.current.openUrl(known.pr.url);
        return;
      }
      if (button.kind === 'action' && button.action === 'open_preview') {
        if (known.preview) latest.current.openPreview(`http://localhost:${known.preview.port}`);
        return;
      }
      if (button.message === undefined || sending.current) return;
      sending.current = true;
      setIsSending(true);
      const sessionId = current.id;
      const messageId = shown.id;
      void latest.current
        .send(sessionId, button.message)
        .then((isTaken) => {
          if (isTaken) latest.current.updateMessages(sessionId, (prev) => withAnswer(prev, messageId, button.label, Date.now()));
        })
        .finally(() => {
          sending.current = false;
          setIsSending(false);
        });
    },
    [latest],
  );

  const replyId = isActive ? reply?.id : undefined;
  return useMemo(
    () =>
      replyId === undefined ? null : { messageId: replyId, facts, turnChanged, ...(blockedReason ? { blockedReason } : {}), isSending, onPress },
    [replyId, facts, turnChanged, blockedReason, isSending, onPress],
  );
}
