import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCanvas } from '../components/ChatCanvas';
import { useSessionRewind, type SessionRewindDeps } from '../hooks/useSessionRewind';
import { NO_CHOICES } from '../lib/acp-draft';
import { changedFilesOf, createTurnCheckpoint, isValidCheckpoint } from '../lib/turn-checkpoints';
import type { ChatMessage, Session } from '../types';

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const VALID_SHA = 'a'.repeat(40);

const session: Session = {
  id: 's1',
  name: 'Session 1',
  profileId: 'claude-acp',
  cwd: '/w/repo',
  status: 'running',
  acpSessionId: 'acp-1',
  createdAt: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('turn-checkpoints helper', () => {
  it('validates tree hashes and returns null outside a git repo or on failure', async () => {
    expect(isValidCheckpoint(VALID_SHA)).toBe(true);
    expect(isValidCheckpoint('not-a-hash')).toBe(false);

    vi.spyOn(tauriInternals(), 'invoke').mockResolvedValueOnce(VALID_SHA);
    expect(await createTurnCheckpoint('/w/repo')).toBe(VALID_SHA);

    vi.spyOn(tauriInternals(), 'invoke').mockRejectedValueOnce(new Error('not git'));
    expect(await createTurnCheckpoint('/tmp/plain')).toBeNull();
  });
});

describe('useSessionRewind file restore', () => {
  const userMsg: ChatMessage = {
    id: 'm1',
    role: 'user',
    content: 'edit app.ts',
    timestamp: 10,
    checkpoint: VALID_SHA,
  };
  const agentMsg: ChatMessage = {
    id: 'm2',
    role: 'agent',
    content: 'done',
    timestamp: 20,
    tools: [
      { id: 't1', name: 'Edit', kind: 'edit', status: 'completed', details: [{ kind: 'diff', path: '/w/repo/src/app.ts', isNewFile: false, rows: [] }] },
      { id: 't2', name: 'Read', kind: 'read', status: 'completed', details: [{ kind: 'changed', path: '/w/repo/README.md' }] },
    ],
  };

  function setup(overrides: Partial<SessionRewindDeps> = {}) {
    const deps: SessionRewindDeps = {
      agents: [],
      transcripts: { s1: [userMsg, agentMsg] },
      acp: { info: {}, start: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true) },
      patchSession: vi.fn(),
      updateMessages: vi.fn(),
      onRestore: vi.fn(),
      onGiveBack: vi.fn(),
      onNotice: vi.fn(),
      onRewound: vi.fn(),
      onFilesRestored: vi.fn(),
      ...overrides,
    };
    return { deps, ...renderHook(() => useSessionRewind(deps)) };
  }

  it('does not restore files on a plain chat rewind', async () => {
    const spy = vi.spyOn(tauriInternals(), 'invoke');
    const { result } = setup();

    act(() => result.current.rewind(session, 'm1'));
    await act(async () => Promise.resolve());

    expect(spy).not.toHaveBeenCalledWith('restore_turn_checkpoint', expect.anything(), undefined);
  });

  it('waits for acp.stop, restores checkpoint files, reloads Changes, and blocks restart until restore settles', async () => {
    let resolveStop!: (v: boolean) => void;
    const stopPromise = new Promise<boolean>((res) => {
      resolveStop = res;
    });
    let resolveRestore!: (count: number) => void;
    const restorePromise = new Promise<number>((res) => {
      resolveRestore = res;
    });

    const spy = vi.spyOn(tauriInternals(), 'invoke').mockImplementation((cmd) => {
      if (cmd === 'restore_turn_checkpoint') return restorePromise;
      if (cmd === 'write_fork_handoff') return Promise.resolve('/tmp/rewind-handoff.md');
      return Promise.resolve(undefined);
    });
    const startMock = vi.fn().mockResolvedValue(true);
    const { result, deps } = setup({
      acp: { info: {}, start: startMock, stop: vi.fn(() => stopPromise) },
    });

    act(() => {
      result.current.rewind(session, 'm1', { restoreFiles: true });
    });

    // Must not restore files while agent process is still stopping.
    expect(spy).not.toHaveBeenCalledWith('restore_turn_checkpoint', expect.anything(), undefined);

    await act(async () => {
      resolveStop(true);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledWith(
      'restore_turn_checkpoint',
      { path: '/w/repo', checkpoint: VALID_SHA, files: ['/w/repo/src/app.ts', '/w/repo/README.md'] },
      undefined,
    );

    // Triggering restart before restore finishes must wait for restore to complete first.
    let restartDone = false;
    await act(async () => {
      void result.current
        .restart({ ...session, status: 'terminated', acpSessionId: null }, { text: 'retry' }, NO_CHOICES)
        .then(() => {
          restartDone = true;
        });
      await Promise.resolve();
    });
    expect(startMock).not.toHaveBeenCalled();
    expect(restartDone).toBe(false);

    await act(async () => {
      resolveRestore(3);
      await restorePromise;
    });

    expect(deps.onFilesRestored).toHaveBeenCalledTimes(1);
    expect(deps.onNotice).toHaveBeenCalledWith('Rewound chat and restored 3 files.', 'info');
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('keeps chat rewound and notifies with an error if restore fails', async () => {
    vi.spyOn(tauriInternals(), 'invoke').mockImplementation((cmd) =>
      cmd === 'restore_turn_checkpoint' ? Promise.reject('missing tree object') : Promise.resolve(undefined),
    );
    const { result, deps } = setup();

    await act(async () => {
      result.current.rewind(session, 'm1', { restoreFiles: true });
    });

    expect(deps.onRewound).toHaveBeenCalledWith('s1');
    expect(deps.onNotice).toHaveBeenCalledWith('Rewound chat, but could not restore files: missing tree object');
  });

  it('serializes back-to-back rewind file restores for the same session', async () => {
    const sha2 = 'b'.repeat(40);
    const secondUserMsg: ChatMessage = { id: 'm3', role: 'user', content: 'second', timestamp: 30, checkpoint: sha2 };
    const secondAgentMsg: ChatMessage = {
      id: 'm4',
      role: 'agent',
      content: 'done 2',
      timestamp: 40,
      tools: [{ id: 't3', name: 'Edit', kind: 'edit', status: 'completed', details: [{ kind: 'diff', path: '/w/repo/src/app.ts', isNewFile: false, rows: [] }] }],
    };

    const calls: string[] = [];
    let resolveFirst!: (count: number) => void;
    const firstRestore = new Promise<number>((res) => {
      resolveFirst = res;
    });

    vi.spyOn(tauriInternals(), 'invoke').mockImplementation((cmd, args) => {
      if (cmd === 'restore_turn_checkpoint') {
        const cp = String((args as { checkpoint?: string })?.checkpoint ?? '');
        calls.push(cp);
        return cp === sha2 ? firstRestore : Promise.resolve(1);
      }
      return Promise.resolve(undefined);
    });

    const { result } = setup({
      transcripts: { s1: [userMsg, agentMsg, secondUserMsg, secondAgentMsg] },
    });

    await act(async () => {
      result.current.rewind(session, 'm3', { restoreFiles: true });
      result.current.rewind({ ...session, status: 'terminated' }, 'm1', { restoreFiles: true });
      await Promise.resolve();
    });

    // Second restore must wait until the first restore settles.
    expect(calls).toEqual([sha2]);

    await act(async () => {
      resolveFirst(1);
      await firstRestore;
      await Promise.resolve();
    });

    expect(calls).toEqual([sha2, VALID_SHA]);
  });
});

describe('restore scope', () => {
  it('restores nothing when the agent reported no changed files', async () => {
    const spy = vi.spyOn(tauriInternals(), 'invoke').mockResolvedValue(undefined);
    const deps: SessionRewindDeps = {
      agents: [],
      transcripts: { s1: [{ id: 'm1', role: 'user', content: 'look', timestamp: 1, checkpoint: VALID_SHA }, { id: 'm2', role: 'agent', content: 'ok', timestamp: 2 }] },
      acp: { info: {}, start: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true) },
      patchSession: vi.fn(),
      updateMessages: vi.fn(),
      onRestore: vi.fn(),
      onGiveBack: vi.fn(),
      onNotice: vi.fn(),
    };
    const { result } = renderHook(() => useSessionRewind(deps));
    await act(async () => {
      result.current.rewind(session, 'm1', { restoreFiles: true });
      await Promise.resolve();
    });
    expect(spy).not.toHaveBeenCalledWith('restore_turn_checkpoint', expect.anything(), undefined);
    expect(deps.onNotice).toHaveBeenCalledWith('Rewound chat. The agent reported no file changes after that message.', 'info');
  });

  it('lists only files the agent changed, never ones it read', () => {
    const messages: ChatMessage[] = [
      {
        id: 'a',
        role: 'agent',
        content: '',
        timestamp: 1,
        tools: [
          { id: '1', name: 'Write', kind: 'edit', status: 'completed', details: [{ kind: 'diff', path: 'new.ts', isNewFile: true, rows: [] }] },
          { id: '2', name: 'Read', kind: 'read', status: 'completed', locations: ['docs.md'] },
          { id: '3', name: 'Edit', kind: 'edit', status: 'failed', details: [{ kind: 'diff', path: 'new.ts', isNewFile: false, rows: [] }] },
        ],
      },
    ];
    expect(changedFilesOf(messages)).toEqual(['new.ts']);
  });
});

describe('ChatCanvas Rewind + files? confirmation', () => {
  it('offers both Rewind? and Rewind + files? only when a message has a checkpoint, and cancels on Escape', () => {
    const withCheckpoint: ChatMessage[] = [
      { id: 'u-cp', role: 'user', content: 'first prompt', timestamp: 1, checkpoint: VALID_SHA },
      { id: 'u-plain', role: 'user', content: 'second prompt', timestamp: 2 },
    ];
    const onRewind = vi.fn();
    render(<ChatCanvas messages={withCheckpoint} agentName="Claude Code" onRewind={onRewind} />);

    // Message without checkpoint offers only Rewind?.
    const plain = within(screen.getByTestId('chat-message-u-plain'));
    fireEvent.click(plain.getByRole('button', { name: 'Rewind to here' }));
    expect(plain.getByRole('button', { name: 'Confirm rewind' })).toBeDefined();
    expect(plain.queryByRole('button', { name: 'Confirm rewind and restore files' })).toBeNull();

    // Message with checkpoint offers both; Escape cancels and returns focus to Rewind to here.
    const cpRow = within(screen.getByTestId('chat-message-u-cp'));
    const trigger = cpRow.getByRole('button', { name: 'Rewind to here' });
    fireEvent.click(trigger);
    const restoreBtn = cpRow.getByRole('button', { name: 'Confirm rewind and restore files' });
    expect(restoreBtn.textContent).toBe('Rewind + files?');

    fireEvent.keyDown(restoreBtn, { key: 'Escape' });
    expect(cpRow.queryByRole('button', { name: 'Confirm rewind and restore files' })).toBeNull();
    expect(document.activeElement).toBe(cpRow.getByRole('button', { name: 'Rewind to here' }));
    expect(onRewind).not.toHaveBeenCalled();

    // Clicking Rewind + files? forwards { restoreFiles: true }.
    fireEvent.click(cpRow.getByRole('button', { name: 'Rewind to here' }));
    fireEvent.click(cpRow.getByRole('button', { name: 'Confirm rewind and restore files' }));
    expect(onRewind).toHaveBeenCalledWith('u-cp', { restoreFiles: true });
  });
});
