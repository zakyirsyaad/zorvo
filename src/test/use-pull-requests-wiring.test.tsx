import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));

import type { PullRequestStatus } from '../hooks/usePullRequest';
import { usePullRequestsWiring, type PullRequestsWiringDeps } from '../hooks/usePullRequestsWiring';
import type { Session } from '../types';

const pr = (branch: string, number: number, url = `https://github.com/org/repo/pull/${number}`): PullRequestStatus => ({
  branch,
  number,
  title: `PR #${number}`,
  url,
  state: 'open',
  isDraft: false,
  checks: { passing: 1, failing: 0, pending: 0 },
});

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  profileId: 'claude-acp',
  cwd: '/w/app',
  status: 'running',
  createdAt: 1,
  ...overrides,
});

function makeDeps(overrides: Partial<PullRequestsWiringDeps> = {}): PullRequestsWiringDeps {
  const s1 = makeSession('s-1');
  return {
    sessions: [s1],
    activeSession: s1,
    isSessionBusy: () => false,
    isGithubSignedIn: true,
    isRepository: true,
    shownFolderPath: '/w/app',
    branch: 'main',
    changesFolderPath: undefined,
    turnsEnded: 0,
    suppressRepoError: false,
    reportError: vi.fn(),
    setNotice: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  invoke.mockReset();
});

describe('usePullRequestsWiring', () => {
  it('resolves pullRequestOf and active pullRequest from workspace PRs, prioritizing agentWork outside a worktree', async () => {
    const workPr = pr('feat/agent', 42, 'https://github.com/org/repo/pull/42');
    const branchPr = pr('main', 7, 'https://github.com/org/repo/pull/7');
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'workspace_pull_requests') {
        return { branch: 'main', pullRequests: [workPr, branchPr] };
      }
      return null;
    });

    const active = makeSession('s-1', {
      agentWork: { branches: ['feat/agent'], pullRequestUrls: [workPr.url] },
    });

    const { result, rerender } = renderHook((props: PullRequestsWiringDeps) => usePullRequestsWiring(props), {
      initialProps: makeDeps({ sessions: [active], activeSession: active }),
    });

    await waitFor(() => expect(result.current.pullRequest).toEqual(workPr));
    expect(result.current.pullRequestOf(active)).toEqual(workPr);

    // Once listedPullRequest is known, later turns do not fall back to session_pull_request.
    invoke.mockClear();
    rerender(makeDeps({ sessions: [active], activeSession: active, turnsEnded: 1 }));
    await act(async () => undefined);
    expect(invoke).not.toHaveBeenCalledWith('session_pull_request', expect.anything());
  });

  it('falls back to session_pull_request only when listedPullRequest is null and isRepository is true', async () => {
    const fallbackPr = pr('feat/outside', 99);
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'workspace_pull_requests') return { branch: 'main', pullRequests: [] };
      if (cmd === 'session_pull_request') return fallbackPr;
      return null;
    });

    const { result, rerender } = renderHook((props: PullRequestsWiringDeps) => usePullRequestsWiring(props), {
      initialProps: makeDeps({ branch: 'feat/outside', isRepository: true }),
    });

    await waitFor(() => expect(result.current.pullRequest).toEqual(fallbackPr));
    expect(invoke).toHaveBeenCalledWith('session_pull_request', { path: '/w/app' });

    invoke.mockClear();
    rerender(makeDeps({ branch: 'feat/outside', isRepository: false }));
    await act(async () => undefined);
    expect(invoke).not.toHaveBeenCalledWith('session_pull_request', expect.anything());
  });

  it('suppresses repo_pull_requests errors when suppressRepoError is true and reports otherwise', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'workspace_pull_requests') return { branch: 'main', pullRequests: [] };
      if (cmd === 'repo_pull_requests') throw new Error('gh auth missing');
      return null;
    });

    const suppressedError = vi.fn();
    renderHook(() =>
      usePullRequestsWiring(
        makeDeps({ changesFolderPath: '/w/app', suppressRepoError: true, reportError: suppressedError }),
      ),
    );

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('repo_pull_requests', { path: '/w/app' }));
    await act(async () => undefined);
    expect(suppressedError).not.toHaveBeenCalled();

    const reportError = vi.fn();
    renderHook(() =>
      usePullRequestsWiring(
        makeDeps({ changesFolderPath: '/w/other', suppressRepoError: false, reportError }),
      ),
    );
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
  });

  it('openPullRequest invokes open_external_url and notices failures', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'workspace_pull_requests') return { branch: 'main', pullRequests: [] };
      if (cmd === 'open_external_url') throw new Error('blocked');
      return null;
    });
    const setNotice = vi.fn();
    const { result } = renderHook(() => usePullRequestsWiring(makeDeps({ setNotice })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('workspace_pull_requests', { path: '/w/app' }));
    await act(async () => undefined);

    await act(async () => {
      result.current.openPullRequest('https://github.com/org/repo/pull/1');
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://github.com/org/repo/pull/1' });
    expect(setNotice).toHaveBeenCalledWith('Could not open the pull request: Error: blocked');
  });
});
