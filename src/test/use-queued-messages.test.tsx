import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQueuedMessages, type QueuedMessagesDeps } from '../hooks/useQueuedMessages';

function setup(overrides: Partial<QueuedMessagesDeps> = {}, strict = false) {
  const deps: QueuedMessagesDeps = {
    sessionIds: ['s1', 's2'],
    deliver: vi.fn(async () => true),
    stop: vi.fn(),
    giveBack: vi.fn(),
    focusComposer: vi.fn(),
    isWaiting: () => false,
    isTurnUnderWay: () => true,
    isEnded: () => false,
    agentNameOf: () => 'Qwen Code',
    onNotice: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useQueuedMessages(deps), strict ? { wrapper: StrictMode } : undefined);
  return { deps, ...hook };
}

const texts = (result: { current: ReturnType<typeof useQueuedMessages> }, id = 's1') =>
  result.current.queueOf(id).map((m) => m.text);

describe('useQueuedMessages', () => {
  it('queues in order and keeps attachments', () => {
    const { result } = setup();
    act(() => {
      result.current.add('s1', 'one', ['/a.png']);
      result.current.add('s1', 'two');
    });
    expect(texts(result)).toEqual(['one', 'two']);
    expect(result.current.queueOf('s1')[0]?.attachments).toEqual(['/a.png']);
    expect(result.current.announcement).toContain('Qwen Code');
  });

  it('refuses a sixth message', () => {
    const { result } = setup();
    act(() => {
      for (const t of ['1', '2', '3', '4', '5']) result.current.add('s1', t);
    });
    expect(result.current.isFull('s1')).toBe(true);
    let added = true;
    act(() => {
      added = result.current.add('s1', '6');
    });
    expect(added).toBe(false);
    expect(texts(result)).toHaveLength(5);
  });

  it('sends only the first at a normal turn end', async () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledWith('s1', expect.objectContaining({ text: 'one' }), 'send');
    expect(texts(result)).toEqual(['two']);
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.deliver).toHaveBeenCalledTimes(2);
    expect(texts(result)).toEqual([]);
  });

  it('sends after a cancelled turn', async () => {
    const { result, deps } = setup();
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'cancelled' }));
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it('keeps the queue after a failed turn and says so, then sends after a good one', async () => {
    const { result, deps } = setup();
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'failed' }));
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(texts(result)).toEqual(['one']);
    expect(result.current.holdOf('s1')).toBe('failed');
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(result.current.holdOf('s1')).toBeNull();
  });

  it('keeps the queue after an exit and says the agent ended', async () => {
    const { result, deps } = setup();
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'exited' }));
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(result.current.holdOf('s1')).toBe('ended');
  });

  it('sends nothing while the session waits on the user', async () => {
    const { result, deps } = setup({ isWaiting: () => true });
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(texts(result)).toEqual(['one']);
  });

  it('gives a message the agent did not take back to the composer and keeps the rest', async () => {
    const { result, deps } = setup({ deliver: vi.fn(async () => false) });
    act(() => {
      result.current.add('s1', 'one', ['/a']);
      result.current.add('s1', 'two');
    });
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.giveBack).toHaveBeenCalledWith('s1', 'one', ['/a']);
    expect(texts(result)).toEqual(['two']);
  });

  it('sends once when two turn ends arrive in one tick', async () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    await act(async () => {
      result.current.onTurnSettled('s1', { how: 'finished' });
      result.current.onTurnSettled('s1', { how: 'finished' });
    });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(texts(result)).toEqual(['two']);
  });

  it('sends once under StrictMode', async () => {
    const { result, deps } = setup({}, true);
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it('leaves another session alone', async () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s2', 'other');
    });
    await act(async () => result.current.onTurnSettled('s2', { how: 'finished' }));
    expect(deps.deliver).toHaveBeenCalledWith('s2', expect.objectContaining({ text: 'other' }), 'send');
    expect(texts(result, 's1')).toEqual(['one']);
  });

  it('Send now moves to the front and stops the turn without sending', () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    const second = result.current.queueOf('s1')[1]!.id;
    act(() => result.current.sendNow('s1', second));
    expect(texts(result)).toEqual(['two', 'one']);
    expect(deps.stop).toHaveBeenCalledWith('s1');
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('Send now with no turn running sends at once', async () => {
    const { result, deps } = setup({ isTurnUnderWay: () => false });
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.sendNow('s1', result.current.queueOf('s1')[0]!.id));
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.deliver).toHaveBeenCalledWith('s1', expect.objectContaining({ text: 'one' }), 'send');
  });

  it('Send now on an ended session continues it', async () => {
    const { result, deps } = setup({ isTurnUnderWay: () => false, isEnded: () => true });
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.sendNow('s1', result.current.queueOf('s1')[0]!.id));
    expect(deps.deliver).toHaveBeenCalledWith('s1', expect.objectContaining({ text: 'one' }), 'resume');
  });

  it('Edit gives the message back and removes it', () => {
    const { result, deps } = setup();
    act(() => void result.current.add('s1', 'one', ['/a']));
    act(() => result.current.edit('s1', result.current.queueOf('s1')[0]!.id));
    expect(deps.giveBack).toHaveBeenCalledWith('s1', 'one', ['/a']);
    expect(deps.focusComposer).toHaveBeenCalled();
    expect(texts(result)).toEqual([]);
  });

  it('Remove drops one', () => {
    const { result } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    act(() => result.current.remove('s1', result.current.queueOf('s1')[0]!.id));
    expect(texts(result)).toEqual(['two']);
  });

  it('drops the queue of a deleted session', () => {
    const { result, rerender, deps } = setup({ sessionIds: ['s1'] });
    act(() => void result.current.add('s1', 'one'));
    deps.sessionIds = [];
    rerender();
    expect(texts(result)).toEqual([]);
  });

  it('a rewind puts the first back and drops the rest with one notice', () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
      result.current.add('s1', 'three');
    });
    act(() => result.current.clearForRewind('s1'));
    expect(deps.giveBack).toHaveBeenCalledWith('s1', 'one', []);
    expect(deps.onNotice).toHaveBeenCalledTimes(1);
    expect(deps.onNotice).toHaveBeenCalledWith(expect.stringContaining('2 queued messages'));
    expect(texts(result)).toEqual([]);
  });
});
