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
    canResume: () => true,
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
    expect(result.current.announcementFor('s1').text).toContain('Qwen Code');
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

  it('a rewind drops the whole queue, gives nothing back, and says how many went', () => {
    const { result, deps } = setup();
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    act(() => result.current.clearForRewind('s1'));
    expect(deps.giveBack).not.toHaveBeenCalled();
    expect(deps.onNotice).toHaveBeenCalledTimes(1);
    expect(deps.onNotice).toHaveBeenCalledWith('2 queued messages were removed with the rewind.');
    expect(texts(result)).toEqual([]);
  });

  it('a rewind of one message says so in the singular, and of none says nothing', () => {
    const { result, deps } = setup();
    act(() => result.current.clearForRewind('s1'));
    expect(deps.onNotice).not.toHaveBeenCalled();
    act(() => void result.current.add('s1', 'one'));
    act(() => result.current.clearForRewind('s1'));
    expect(deps.onNotice).toHaveBeenCalledWith('1 queued message was removed with the rewind.');
  });

  it('runs a turn end that arrived while the queued send was in flight, once it resolves', async () => {
    let resolveFirst: (taken: boolean) => void = () => {};
    const deliver = vi
      .fn<QueuedMessagesDeps['deliver']>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(true);
    const { result } = setup({ deliver, isTurnUnderWay: () => false });
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    act(() => result.current.onTurnSettled('s1', { how: 'finished' }));
    // The send was refused fast: its turn ended before the prompt call returned.
    act(() => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(deliver).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst(true));
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith('s1', expect.objectContaining({ text: 'two' }), 'send');
  });

  it('remembers a turn end that came while the session waits, and sends when it no longer waits', async () => {
    let waiting = true;
    const { result, deps, rerender } = setup({ isWaiting: () => waiting, isTurnUnderWay: () => false });
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.onTurnSettled('s1', { how: 'finished' }));
    expect(result.current.holdOf('s1')).toBe('waiting');
    expect(deps.deliver).not.toHaveBeenCalled();
    rerender();
    expect(deps.deliver).not.toHaveBeenCalled();
    waiting = false;
    await act(async () => rerender());
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(result.current.holdOf('s1')).toBeNull();
    await act(async () => rerender());
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it('does not send into an agent the user ended, and says it has ended', async () => {
    const { result, deps } = setup();
    act(() => void result.current.add('s1', 'one'));
    await act(async () => {
      result.current.onAgentEnded('s1');
      result.current.onTurnSettled('s1', { how: 'cancelled' });
    });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(result.current.holdOf('s1')).toBe('ended');
    expect(texts(result)).toEqual(['one']);
  });

  it('Send now on an ended session that cannot be resumed does nothing', () => {
    const { result, deps } = setup({ isTurnUnderWay: () => false, isEnded: () => true, canResume: () => false });
    act(() => void result.current.add('s1', 'one'));
    act(() => result.current.sendNow('s1', result.current.queueOf('s1')[0]!.id));
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
    expect(texts(result)).toEqual(['one']);
  });

  it('announces "sent" only when the agent took the message', async () => {
    const { result } = setup({ deliver: vi.fn(async () => false), isTurnUnderWay: () => false });
    act(() => void result.current.add('s1', 'one'));
    await act(async () => result.current.sendNow('s1', result.current.queueOf('s1')[0]!.id));
    expect(result.current.announcementFor('s1').text).not.toBe('Queued message sent.');
  });

  it('gives each announcement its own key, names one session, and clears', () => {
    const { result } = setup();
    act(() => void result.current.add('s1', 'one'));
    const first = result.current.announcementFor('s1');
    act(() => void result.current.add('s1', 'two'));
    const second = result.current.announcementFor('s1');
    expect(second.text).toBe(first.text);
    expect(second.key).not.toBe(first.key);
    expect(result.current.announcementFor('s2').text).toBe('');
    act(() => result.current.clearAnnouncement());
    expect(result.current.announcementFor('s1').text).toBe('');
  });

  it('Send now on a held queue clears the hold at once', async () => {
    const { result } = setup({ isTurnUnderWay: () => false });
    act(() => {
      result.current.add('s1', 'one');
      result.current.add('s1', 'two');
    });
    await act(async () => result.current.onTurnSettled('s1', { how: 'failed' }));
    expect(result.current.holdOf('s1')).toBe('failed');
    await act(async () => result.current.sendNow('s1', result.current.queueOf('s1')[1]!.id));
    expect(result.current.holdOf('s1')).toBeNull();
  });
});
