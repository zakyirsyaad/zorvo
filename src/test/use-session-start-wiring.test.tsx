import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const createSessionWorktree = vi.fn();
const attachmentsFor = vi.fn();
vi.mock('../lib/session-worktree', () => ({
  createSessionWorktree: (...args: unknown[]) => createSessionWorktree(...args),
  attachmentsFor: (...args: unknown[]) => attachmentsFor(...args),
}));

import type { ComposerHandle } from '../components/ComposerDock';
import { useSessionStartWiring, type SessionStartWiringDeps } from '../hooks/useSessionStartWiring';
import { NO_CHOICES } from '../lib/acp-draft';
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
const workspaceA: Workspace = { name: 'app-a', path: '/w/app-a' };
const workspaceB: Workspace = { name: 'app-b', path: '/w/app-b' };

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app-a',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

function makeDeps(overrides: Partial<SessionStartWiringDeps> = {}): SessionStartWiringDeps {
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
    sessions: [],
    workspaces: [workspaceA],
    activeWorkspace: workspaceA,
    agentsInUse: [claude],
    newSessionAgent: claude,
    privateDraftMode: undefined,
    paymentSource: 'credits',
    isWorktreeActive: false,
    baseBranch: 'main',
    startChoices: NO_CHOICES,
    noFolderNotice: 'Open a project folder first.',
    startAcp: vi.fn().mockResolvedValue(true),
    updateState: vi.fn(),
    updateMessages: vi.fn(),
    setActiveSessionId: vi.fn(),
    setActiveRunId: vi.fn(),
    setPickedAgentId: vi.fn(),
    setGalleryOpen: vi.fn(),
    setAcpChoices: vi.fn(),
    setIsCreatingWorktree: vi.fn(),
    selectWorkspace: vi.fn(),
    rememberFolder: vi.fn(),
    resetCompare: vi.fn(),
    resetBranchPicker: vi.fn(),
    giveBackMessage: vi.fn(),
    composerRef,
    setNotice: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  createSessionWorktree.mockReset();
  attachmentsFor.mockReset();
});

describe('useSessionStartWiring', () => {
  it('recordSession and startSession store initial messages, clear draft choices, and give back rejected sends', async () => {
    const deps = makeDeps({ startAcp: vi.fn().mockResolvedValue(false) });
    const { result } = renderHook(() => useSessionStartWiring(deps));

    await act(async () => {
      result.current.startSession(
        {
          agent: claude,
          cwd: '/w/app-a',
          name: 'First task',
          initialMessages: [{ id: 'm-1', role: 'user', content: 'seed', timestamp: 1 }],
        },
        { text: 'hello world', attachments: ['/a.ts'] },
      );
    });

    expect(deps.updateState).toHaveBeenCalledTimes(1);
    expect(deps.updateMessages).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
    expect(deps.setActiveSessionId).toHaveBeenCalledTimes(1);
    expect(deps.setAcpChoices).toHaveBeenCalledWith(NO_CHOICES);
    expect(deps.giveBackMessage).toHaveBeenCalledWith(expect.any(String), 'hello world', ['/a.ts']);
  });

  it('handleNewSession validates workspace/agent, forwards ownKey privateMode, and recovers from worktree failures', async () => {
    const noWs = makeDeps({ activeWorkspace: undefined });
    const hook1 = renderHook(() => useSessionStartWiring(noWs));
    await act(async () => {
      await hook1.result.current.handleNewSession({ text: 'hi' });
    });
    expect(noWs.setNotice).toHaveBeenCalledWith('Open a project folder first.', 'warning');

    const noAgent = makeDeps({ newSessionAgent: undefined });
    const hook2 = renderHook(() => useSessionStartWiring(noAgent));
    await act(async () => {
      await hook2.result.current.handleNewSession({ text: 'hi' });
    });
    expect(noAgent.setNotice).toHaveBeenCalledWith(expect.any(String), 'warning');

    // Worktree failure restores message and resets creating flag.
    createSessionWorktree.mockRejectedValueOnce('git worktree failed');
    const wtFail = makeDeps({ isWorktreeActive: true });
    const hook3 = renderHook(() => useSessionStartWiring(wtFail));
    await act(async () => {
      await hook3.result.current.handleNewSession({ text: 'keep me', attachments: ['/f.ts'] });
    });
    expect(wtFail.setIsCreatingWorktree).toHaveBeenNthCalledWith(1, true);
    expect(wtFail.setIsCreatingWorktree).toHaveBeenLastCalledWith(false);
    expect(wtFail.setNotice).toHaveBeenCalledWith('Could not create a worktree: git worktree failed');
    expect(wtFail.setActiveSessionId).toHaveBeenCalledWith('');
    expect(wtFail.composerRef.current?.restore).toHaveBeenCalledWith('keep me', ['/f.ts']);

    // Private draft preserves ownKey when paymentSource === 'ownKey'.
    const priv = makeDeps({
      privateDraftMode: { modelId: 'priv-1', sessionCap: 500 },
      paymentSource: 'ownKey',
    });
    const hook4 = renderHook(() => useSessionStartWiring(priv));
    await act(async () => {
      await hook4.result.current.handleNewSession({ text: 'private prompt' });
    });
    expect(priv.rememberFolder).toHaveBeenCalledWith(workspaceA);
    expect(priv.startAcp).toHaveBeenCalledWith(
      expect.objectContaining({ privateMode: { modelId: 'priv-1', sessionCap: 500, ownKey: true } }),
      { text: 'private prompt' },
      NO_CHOICES,
    );
  });

  it('chooseFolder, openNewSession, handleSelectSession, openRun, and navigateTo update navigation and workspace', () => {
    const s1 = makeSession('s-1', { cwd: '/w/app-b' });
    const runSession1 = makeSession('r-1', { cwd: '/w/app-b', compareRunId: 'run-1' });
    const runSession2 = makeSession('r-2', { cwd: '/w/app-b', compareRunId: 'run-1' });
    const deps = makeDeps({
      sessions: [s1, runSession1, runSession2],
      workspaces: [workspaceA, workspaceB],
    });
    const { result } = renderHook(() => useSessionStartWiring(deps));

    act(() => result.current.chooseFolder('/w/app-b'));
    expect(deps.selectWorkspace).toHaveBeenCalledWith('/w/app-b');

    act(() => result.current.chooseFolder('/w/new-folder'));
    expect(deps.rememberFolder).toHaveBeenCalledWith({ name: 'new-folder', path: '/w/new-folder' });

    act(() => result.current.openNewSession('/w/app-a', 'claude-acp', { keepChoices: true }));
    expect(deps.setGalleryOpen).toHaveBeenCalledWith(false);
    expect(deps.setPickedAgentId).toHaveBeenCalledWith('claude-acp');
    expect(deps.setActiveRunId).toHaveBeenCalledWith(null);
    expect(deps.setAcpChoices).not.toHaveBeenCalled();

    act(() => result.current.navigateTo('s-1'));
    expect(deps.setActiveSessionId).toHaveBeenCalledWith('s-1');
    expect(deps.resetCompare).toHaveBeenCalled();
    expect(deps.selectWorkspace).toHaveBeenCalledWith('/w/app-b');

    act(() => result.current.openRun('run-1'));
    expect(deps.setActiveRunId).toHaveBeenCalledWith('run-1');
    expect(deps.setActiveSessionId).toHaveBeenCalledWith('');
  });
});
