import { describe, expect, it } from 'vitest';
import { withAnswerUndone, withNextStep } from '../lib/next-step-part';
import type { AcpReducerContext } from '../lib/acp-events';
import type { ChatMessage } from '../types';

const ctx: AcpReducerContext = { sessionId: 's-1', now: 5, createId: () => 'new' };
const user: ChatMessage = { id: 'u1', role: 'user', content: 'Do it', timestamp: 1 };
const open: ChatMessage = { id: 'a1', role: 'agent', content: 'Working.', timestamp: 2 };

describe('withNextStep', () => {
  it('sets the step on the open reply', () => {
    const [, reply] = withNextStep([user, open], { recap: 'Done.' }, ctx);
    expect(reply.nextStep).toEqual({ recap: 'Done.' });
  });

  it('sets it on a reply the turn end already closed, without a new reply', () => {
    const closed = { ...open, isComplete: true, endedNormally: true as const };
    const next = withNextStep([user, closed], { recap: 'Done.' }, ctx);
    expect(next).toHaveLength(2);
    expect(next[1].nextStep).toEqual({ recap: 'Done.' });
  });

  it('replaces an earlier step', () => {
    const first = withNextStep([user, open], { recap: 'First.' }, ctx);
    expect(withNextStep(first, { recap: 'Second.' }, ctx)[1].nextStep).toEqual({ recap: 'Second.' });
  });

  it('leaves the messages alone when the user spoke last', () => {
    const messages = [open, user];
    expect(withNextStep(messages, { recap: 'Done.' }, ctx)).toBe(messages);
  });
});

describe('withAnswerUndone', () => {
  const sent: ChatMessage = { id: 'u2', role: 'user', content: 'Commit these changes.', timestamp: 10 };
  const answered: ChatMessage = { ...open, isComplete: true, endedNormally: true, nextStep: { recap: 'Done.', answered: { label: 'Commit', at: 11 } } };

  it('clears the answer a refused message recorded, keeping the step', () => {
    const next = withAnswerUndone([user, answered], sent);
    expect(next[1].nextStep).toEqual({ recap: 'Done.' });
  });

  it('leaves an answer recorded before the refused message alone', () => {
    const earlier = { ...answered, nextStep: { recap: 'Done.', answered: { label: 'Commit', at: 5 } } };
    expect(withAnswerUndone([user, earlier], sent)[1].nextStep?.answered?.label).toBe('Commit');
  });

  it('drops an answer-only step entirely', () => {
    const only = { ...answered, nextStep: { answered: { label: 'Commit', at: 11 } } };
    expect(withAnswerUndone([user, only], sent)[1]).not.toHaveProperty('nextStep');
  });
});
