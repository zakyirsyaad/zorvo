import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BackgroundTask } from '../lib/background-tasks';
import type { NextStepFacts } from '../lib/next-step';
import type { Session } from '../types';
import type { PullRequestStatus } from './usePullRequest';

interface FileStatAnswer {
  added: number;
  removed: number;
}

interface BranchStateAnswer {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  isDefaultBranch: boolean;
}

interface FactsArgs {
  session: Session | null;
  /** Only an active box is read for: an inert one hides its facts. */
  isActive: boolean;
  /** The session's pull request, from the sidebar's list. */
  pullRequest: PullRequestStatus | null;
  tasks: readonly BackgroundTask[];
}

/** What git says, read for one session; each part that fails to read is left out. */
interface ReadFacts {
  sessionId: string;
  changes?: NextStepFacts['changes'];
  branch?: string;
  ahead?: number;
  hasUpstream?: boolean;
  isDefaultBranch?: boolean;
}

async function readFacts(session: Session): Promise<ReadFacts> {
  const [stats, branch] = await Promise.allSettled([
    invoke<FileStatAnswer[]>('session_diff_stats', { path: session.cwd, target: 'head' }),
    invoke<BranchStateAnswer>('session_branch_state', { cwd: session.cwd }),
  ]);
  const facts: ReadFacts = { sessionId: session.id };
  if (stats.status === 'fulfilled' && Array.isArray(stats.value) && stats.value.length > 0) {
    facts.changes = {
      files: stats.value.length,
      added: stats.value.reduce((sum, file) => sum + file.added, 0),
      removed: stats.value.reduce((sum, file) => sum + file.removed, 0),
    };
  }
  if (branch.status === 'fulfilled' && branch.value && typeof branch.value === 'object') {
    const state = branch.value;
    if (typeof state.branch === 'string') facts.branch = state.branch;
    facts.ahead = state.ahead;
    facts.hasUpstream = state.upstream !== null;
    facts.isDefaultBranch = state.isDefaultBranch;
  }
  return facts;
}

/**
 * The facts a next-step box shows for `session`: its uncommitted changes, branch and unpushed
 * commits (read when the box becomes active and on window focus while it stays so), the pull
 * request the sidebar already knows, and a dev server one of its shell commands started.
 * Nothing is read, and nothing returned, while the box is inactive. Facts are never stored.
 */
export function useNextStepFacts({ session, isActive, pullRequest, tasks }: FactsArgs): NextStepFacts {
  const [read, setRead] = useState<ReadFacts | null>(null);
  const sessionId = session?.id ?? null;
  const cwd = session?.cwd ?? null;

  useEffect(() => {
    if (!isActive || session === null) return undefined;
    let isCurrent = true;
    const load = () => {
      void readFacts(session).then((facts) => {
        if (isCurrent) setRead(facts);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      isCurrent = false;
      window.removeEventListener('focus', load);
    };
    // The session object changes on every update; its id and folder are what the reads depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionId, cwd]);

  if (!isActive || session === null) return {};
  const own = read?.sessionId === session.id ? read : null;
  const ports = tasks
    .filter((task) => task.kind === 'shell' && task.sessionId === session.id && (task.ports?.length ?? 0) > 0)
    .flatMap((task) => (task.ports ?? []).map((port) => ({ port, command: task.name })))
    .sort((a, b) => a.port - b.port);
  return {
    ...(own?.changes ? { changes: own.changes } : {}),
    ...(own?.branch !== undefined ? { branch: own.branch } : {}),
    ...(own?.ahead !== undefined ? { ahead: own.ahead } : {}),
    ...(own?.hasUpstream !== undefined ? { hasUpstream: own.hasUpstream } : {}),
    ...(own?.isDefaultBranch !== undefined ? { isDefaultBranch: own.isDefaultBranch } : {}),
    ...(pullRequest
      ? {
          pr: {
            number: pullRequest.number,
            url: pullRequest.url,
            state: pullRequest.state,
            checks: pullRequest.checks,
            ...(pullRequest.mergeState ? { mergeState: pullRequest.mergeState } : {}),
          },
        }
      : {}),
    ...(ports.length > 0 ? { preview: ports[0] } : {}),
  };
}
