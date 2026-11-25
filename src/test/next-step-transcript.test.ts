import { describe, expect, it } from 'vitest';
import { closeTurn } from '../lib/acp-events';
import { normalizeTranscript } from '../lib/persistence';
import type { ChatMessage } from '../types';

const user: ChatMessage = { id: 'u1', role: 'user', content: 'Do it', timestamp: 1 };
const reply: ChatMessage = { id: 'a1', role: 'agent', content: 'Done.', timestamp: 2 };

describe('closeTurn and a normal end', () => {
  it('marks the last reply when the turn ended with end_turn', () => {
    const [, last] = closeTurn([user, reply], 3, 'end_turn');
    expect(last.endedNormally).toBe(true);
    expect(last.isComplete).toBe(true);
  });

  it('does not mark a cancelled turn or one with no reason', () => {
    expect(closeTurn([user, reply], 3, 'cancelled')[1].endedNormally).toBeUndefined();
    expect(closeTurn([user, reply], 3)[1].endedNormally).toBeUndefined();
  });

  it('marks nothing when the last message is the user\'s', () => {
    expect(closeTurn([user], 3, 'end_turn')[0].endedNormally).toBeUndefined();
  });
});

describe('normalizeTranscript and the next step', () => {
  it('keeps a well-formed next step and the end mark', () => {
    const saved = { ...reply, endedNormally: true, nextStep: { recap: 'Done.', pick: 'commit', answered: { label: 'Commit', at: 4 } } };
    const [message] = normalizeTranscript([saved]);
    expect(message.endedNormally).toBe(true);
    expect(message.nextStep).toEqual({ recap: 'Done.', pick: 'commit', answered: { label: 'Commit', at: 4 } });
  });

  it('drops a malformed next step and any other end mark', () => {
    const [message] = normalizeTranscript([{ ...reply, endedNormally: 'yes', nextStep: { pick: 'deploy' } }]);
    expect(message).not.toHaveProperty('nextStep');
    expect(message).not.toHaveProperty('endedNormally');
  });
});
