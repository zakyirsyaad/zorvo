import { useCallback, useRef, useState } from 'react';
import type { NextStepView } from '../components/chat/NextStepBox';
import type { BackgroundTask } from '../lib/background-tasks';
import type { NextStepButton } from '../lib/next-step';
import type { ChatMessage, Session } from '../types';
import type { PullRequestStatus } from './usePullRequest';
import { useNextStepFacts } from './useNextStepFacts';

export interface NextStepArgs {
  /** The session on screen. */
  session: Session | null;
  sessions: readonly Session[];
  messages: readonly ChatMessage[];
  isBusy: boolean;
  /** Something in the chat waits for the user's answer. */
  isWaiting: boolean;
  /** Why the composer cannot send now, when it cannot. */
  blockedReason: string | undefined;
  pullRequest: PullRequestStatus | null;
  tasks: readonly BackgroundTask[];
  /** The composer's own Send for `text`; resolves true when the agent took it. */
  send: (sessionId: string, text: string) => Promise<boolean>;
  updateMessages: (sessionId: string, update: (messages: ChatMessage[]) => ChatMessage[]) => void;
  /** Opens a pull request in the user's browser. */
  openUrl: (url: string) => void;
  /** Opens a dev server in Zorvo's Browser panel. */
  openPreview: (url: string) => void;
}

/** A worker reports to its coordinator, and a compare run's panel replaces its chat: neither gets a box. */
function isEligible(session: Session): boolean {
  const isWorker = Boolean(session.delegatedFrom && !session.delegatedFrom.endedAt);
  return !isWorker && !session.compareRunId && session.status === 'running';
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
  const { session, messages, isBusy, isWaiting, blockedReason, pullRequest, tasks, send, updateMessages, openUrl, openPreview } = args;
  const last = messages[messages.length - 1];
  const reply = last?.role === 'agent' && last.endedNormally ? last : undefined;
  const isActive = session !== null && isEligible(session) && reply !== undefined && !isBusy && !isWaiting;
  const facts = useNextStepFacts({ session, isActive, pullRequest, tasks });
  const [isSending, setIsSending] = useState(false);
  const sending = useRef(false);

  const onPress = useCallback(
    (button: NextStepButton) => {
      if (session === null || reply === undefined) return;
      if (button.kind === 'action' && button.action === 'open_pr') {
        if (facts.pr) openUrl(facts.pr.url);
        return;
      }
      if (button.kind === 'action' && button.action === 'open_preview') {
        if (facts.preview) openPreview(`http://localhost:${facts.preview.port}`);
        return;
      }
      if (button.message === undefined || sending.current) return;
      sending.current = true;
      setIsSending(true);
      const sessionId = session.id;
      const messageId = reply.id;
      void send(sessionId, button.message)
        .then((isTaken) => {
          if (isTaken) updateMessages(sessionId, (prev) => withAnswer(prev, messageId, button.label, Date.now()));
        })
        .finally(() => {
          sending.current = false;
          setIsSending(false);
        });
    },
    [session, reply, facts.pr, facts.preview, send, updateMessages, openUrl, openPreview],
  );

  if (!isActive || reply === undefined) return null;
  return { messageId: reply.id, facts, ...(blockedReason ? { blockedReason } : {}), isSending, onPress };
}
