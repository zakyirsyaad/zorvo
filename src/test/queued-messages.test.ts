import { describe, it, expect } from 'vitest';
import {
  MAX_QUEUED_MESSAGES,
  addMessage,
  isFull,
  moveToFront,
  previewOf,
  queueHoldNote,
  removeMessage,
  takeFirst,
  type QueuedMessage,
} from '../lib/queued-messages';

const m = (id: string, text = id): QueuedMessage => ({ id, text, attachments: [] });

describe('queued messages', () => {
  it('adds at the end and never mutates', () => {
    const before = [m('a')];
    const after = addMessage(before, m('b'));
    expect(after.map((x) => x.id)).toEqual(['a', 'b']);
    expect(before).toHaveLength(1);
  });

  it('stops at five', () => {
    expect(MAX_QUEUED_MESSAGES).toBe(5);
    let list: readonly QueuedMessage[] = [];
    for (const id of ['1', '2', '3', '4', '5', '6']) list = addMessage(list, m(id));
    expect(list.map((x) => x.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(isFull(list)).toBe(true);
    expect(isFull(list.slice(1))).toBe(false);
  });

  it('removes by id and leaves the rest in order', () => {
    expect(removeMessage([m('a'), m('b'), m('c')], 'b').map((x) => x.id)).toEqual(['a', 'c']);
    const list = [m('a')];
    expect(removeMessage(list, 'zzz')).toEqual(list);
  });

  it('moves one to the front', () => {
    expect(moveToFront([m('a'), m('b'), m('c')], 'c').map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(moveToFront([m('a')], 'x').map((x) => x.id)).toEqual(['a']);
  });

  it('takes the first and returns the rest', () => {
    const taken = takeFirst([m('a'), m('b')]);
    expect(taken?.first.id).toBe('a');
    expect(taken?.rest.map((x) => x.id)).toEqual(['b']);
    expect(takeFirst([])).toBeNull();
  });

  it('shows text as plain visible text on one line', () => {
    expect(previewOf('hi‮evil')).toContain('\\u202E');
    expect(previewOf('**bold** `x`')).toBe('**bold** `x`');
    expect(previewOf('a\n\nb')).toBe('a b');
  });

  it('words why a held queue did not send', () => {
    expect(queueHoldNote('failed', 'Qwen Code')).toBe('Not sent: the last turn failed.');
    expect(queueHoldNote('ended', 'Qwen Code')).toBe('Not sent: Qwen Code has ended.');
    expect(queueHoldNote('refused', 'Qwen Code')).toBe('Not sent: Qwen Code did not take the last message.');
    expect(queueHoldNote('waiting', 'Qwen Code')).toBe('Waits for your answer in the chat.');
    expect(queueHoldNote('stopped', 'Qwen Code')).toBe('Not sent: you stopped the turn.');
    expect(queueHoldNote(null, 'Qwen Code')).toBeNull();
  });
});
