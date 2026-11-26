import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));

vi.mock('../lib/session-worktree', () => ({
  createSessionWorktree: vi.fn().mockResolvedValue({
    worktree: { repoPath: '/w/app', path: '/wt/1', branch: 'agent/one', startCommit: 'abc' },
    cwd: '/wt/1',
  }),
  attachmentsFor: vi.fn(async (_repo: string, _cwd: string, attachments: readonly string[]) => [...attachments]),
}));

import type { ComposerHandle } from '../components/ComposerDock';
import type { FirstMessage } from '../hooks/session-engine/useAcpEngine';
import { useCompareRunWiring, type CompareRunWiringDeps } from '../hooks/useCompareRunWiring';
import type { AgentProfile, Session, Workspace } from '../types';

const makeAgent = (id: string, name: string): AgentProfile => ({
  id,
  name,
  command: id,
  detected: true,
  acp_args: [],
  source: 'registry',
  version: '1.0.0',
  distribution: 'npx',
  availability: 'ready',
  install_plan: null,
  description: null,
  installed_on_system: true,
  listed: true,
});

const claude = makeAgent('claude-acp', 'Claude Code');
const codex = makeAgent('codex-acp', 'Codex');
const workspace: Workspace = { name: 'app', path: '/w/app' };

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

function makeDeps(overrides: Partial<CompareRunWiringDeps> = {}): CompareRunWiringDeps {
  const composerRef = createRef<ComposerHandle | null>() as MutableRefObject<ComposerHandle | null>;
  composerRef.current = {
    insertPaths: vi.fn(),
    insertText: vi.fn(),
    restore: vi.fn(),
    giveBack: vi.fn(),
    holdsRestored: () => false,
    clear: vi.fn(),
    focus: vi.fn(),
  };
  return {
    sessions: [makeSession('s-1')],
    activeSession: makeSession('s-1'),
    activeSessionId: 's-1',
    activeRun: null,
    activeWorkspace: workspace,
    shownFolderPath: '/w/app',
    isNewSessionDraft: true,
    isComposerHidden: false,
    isComposerHiddenRef: { current: false },
    composerRef,
    pendingRestoreRef: { current: null },
    agents: [claude, codex],
    agentOptions: undefined,
    compareAgentIds: ['claude-acp', 'codex-acp'],
    baseBranch: 'main',
    noFolderNotice: 'Open a project folder first.',
    isSessionBusy: () => false,
    transcripts: {},
    failedTurns: {},
    isAgentRemovedFor: () => false,
    startSession: vi.fn(),
    openNewSession: vi.fn(),
    rememberFolder: vi.fn(),
    setActiveRunId: vi.fn(),
    setActiveSessionId: vi.fn(),
    setIsCreatingWorktree: vi.fn(),
    onRunStarted: vi.fn(),
    rememberProbed: vi.fn(),
    markSignedIn: vi.fn(),
    markSignInNeeded: vi.fn(),
    askSignIn: vi.fn(),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    readSessions: () => [],
    ensureLoaded: vi.fn(),
    setNotice: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  invoke.mockReset();
});

describe('useCompareRunWiring', () => {
  it('handleNewRun warns without a workspace and starts a run with a workspace', async () => {
    const noFolder = makeDeps({ activeWorkspace: undefined });
    const first = renderHook(() => useCompareRunWiring(noFolder));
    act(() => first.result.current.handleNewRun({ text: 'Fix bug' }));
    expect(noFolder.setNotice).toHaveBeenCalledWith('Open a project folder first.', 'warning');
    expect(noFolder.rememberFolder).not.toHaveBeenCalled();

    const withFolder = makeDeps();
    const second = renderHook(() => useCompareRunWiring(withFolder));
    await act(async () => {
      second.result.current.handleNewRun({ text: 'Fix bug' });
    });
    expect(withFolder.rememberFolder).toHaveBeenCalledWith(workspace);
    await waitFor(() => expect(withFolder.startSession).toHaveBeenCalledTimes(2));
  });

  it('drains pendingRestoreRef only when the composer is visible for that session and drops missing sessions', () => {
    const pendingRestoreRef: MutableRefObject<(FirstMessage & { sessionId?: string }) | null> = {
      current: { text: 'rewound prompt', attachments: ['/a.ts'], sessionId: 's-1' },
    };
    const deps = makeDeps({
      activeSessionId: 's-2',
      pendingRestoreRef,
    });

    const { rerender } = renderHook((props: CompareRunWiringDeps) => useCompareRunWiring(props), {
      initialProps: deps,
    });
    expect(deps.composerRef.current?.restore).not.toHaveBeenCalled();
    expect(pendingRestoreRef.current).not.toBeNull();

    // Switching back to s-1 delivers the pending restore.
    rerender({ ...deps, activeSessionId: 's-1' });
    expect(deps.composerRef.current?.restore).toHaveBeenCalledWith('rewound prompt', ['/a.ts']);
    expect(pendingRestoreRef.current).toBeNull();

    // A pending restore for a deleted session is discarded.
    pendingRestoreRef.current = { text: 'gone', sessionId: 's-deleted' };
    rerender({ ...deps, activeSessionId: 's-1', sessions: [makeSession('s-1')] });
    expect(pendingRestoreRef.current).toBeNull();
    expect(deps.composerRef.current?.restore).toHaveBeenCalledTimes(1);
  });

  it('compareModelProbe marks sign-in needed and notifies only when the agent is in compareAgentIds', async () => {
    invoke.mockRejectedValue('ACP_AUTH_REQUIRED:[]');
    const deps = makeDeps({ compareAgentIds: ['claude-acp', 'codex-acp'] });
    const { result, rerender } = renderHook((props: CompareRunWiringDeps) => useCompareRunWiring(props), {
      initialProps: deps,
    });

    await act(async () => {
      result.current.compareModelProbe.ask('codex-acp');
    });
    await waitFor(() => expect(deps.markSignInNeeded).toHaveBeenCalledWith('codex-acp'));
    expect(deps.setNotice).toHaveBeenCalledWith('Codex needs a sign-in, so it left the run. Pick it alone to sign in.');

    // Asking for an agent not in compareAgentIds still marks needed, without the compare notice.
    const setNotice = vi.fn();
    const markSignInNeeded = vi.fn();
    rerender({ ...deps, compareAgentIds: ['claude-acp'], setNotice, markSignInNeeded });
    await act(async () => {
      result.current.compareModelProbe.ask('qwen-code');
    });
    await waitFor(() => expect(markSignInNeeded).toHaveBeenCalledWith('qwen-code'));
    expect(setNotice).not.toHaveBeenCalled();
  });
});
