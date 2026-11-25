import type { AcpReducerContext } from './acp-events';
import type { ChatMessage, NextStep } from '../types';

/** What `wrap_up` answers the agent. */
export const WRAP_UP_SHOWN_TEXT = 'Shown at the end of your turn.';

/**
 * Puts an agent's `wrap_up` on its turn's last reply, whether the turn end has closed it yet or
 * not, and replaces one an earlier call left. When the user spoke last there is no reply of this
 * turn to put it on, and the messages are returned unchanged.
 */
export function withNextStep(messages: readonly ChatMessage[], step: NextStep, _ctx: AcpReducerContext): ChatMessage[] {
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last?.role !== 'agent') return messages as ChatMessage[];
  return messages.map((message, index) => (index === lastIndex ? { ...message, nextStep: step } : message));
}

/**
 * Undoes what a refused message recorded: the agent never took `refused` (a sign-in or a private
 * credit refusal arrives after the prompt was written), so a box answer recorded at or after it is
 * cleared, and an answer-only step goes away with it.
 */
export function withAnswerUndone(messages: readonly ChatMessage[], refused: ChatMessage): ChatMessage[] {
  return messages.map((message) => {
    const answered = message.nextStep?.answered;
    if (message.role !== 'agent' || !answered || answered.at < refused.timestamp) return message;
    const { answered: _undone, ...step } = message.nextStep ?? {};
    const { nextStep: _old, ...rest } = message;
    return Object.keys(step).length > 0 ? { ...rest, nextStep: step } : (rest as ChatMessage);
  });
}
