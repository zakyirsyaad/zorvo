import { useRef } from 'react';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { NO_CHOICES, withPreferred, type AgentOptions } from '../lib/acp-draft';
import { attachmentsFor, createSessionWorktree } from '../lib/session-worktree';
import { titleFor, type SessionSpec, type StartSessionOptions } from '../lib/session-start';
import type { AgentProfile, SessionWorktree } from '../types';

export interface CompareRunDeps {
  /** The folder the run's worktrees are made from. */
  repoPath: string;
  /** The local branch the worktrees start from, or the folder's HEAD. */
  baseBranch: string | undefined;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  startSession: (spec: SessionSpec, first: FirstMessage, options: StartSessionOptions) => void;
  /** Read when asked, not when the run began: the user may have opened another session meanwhile. */
  isOnDraft: () => boolean;
  openRun: (runId: string) => void;
  /** The composer is busy from the first worktree until the last session is recorded. */
  setIsBusy: (isBusy: boolean) => void;
  /** Puts the message back in the composer of the draft it was written in. */
  restoreMessage: (first: FirstMessage, agentId: string) => void;
  /** The draft's picks went with the run (or the only session that started). */
  onStarted: () => void;
  onNotice: (message: string) => void;
}

interface Prepared {
  agent: AgentProfile;
  worktree: SessionWorktree;
  cwd: string;
}

/** Makes the worktrees one at a time: the git index of the repository is locked while one is made. */
async function makeWorktrees(
  agents: readonly AgentProfile[],
  { repoPath, baseBranch }: Pick<CompareRunDeps, 'repoPath' | 'baseBranch'>,
  name: string,
): Promise<{ made: Prepared[]; failures: string[] }> {
  const made: Prepared[] = [];
  const failures: string[] = [];
  for (const agent of agents) {
    try {
      made.push({ agent, ...(await createSessionWorktree(repoPath, name, baseBranch)) });
    } catch (error) {
      failures.push(`Could not create a worktree for ${agent.name}: ${String(error)}`);
    }
  }
  return { made, failures };
}

/** Starts one prompt on several agents, each in its own worktree. */
export function useCompareRun(deps: CompareRunDeps) {
  // A second Send before the first run has its sessions would make a second set of worktrees.
  const isStarting = useRef(false);

  const startRun = async (agents: readonly AgentProfile[], first: FirstMessage): Promise<void> => {
    if (isStarting.current || agents.length === 0) return;
    isStarting.current = true;
    deps.setIsBusy(true);
    const notices: string[] = [];
    const ready: Array<Prepared & { message: FirstMessage }> = [];
    const name = titleFor(first);
    try {
      const { made, failures } = await makeWorktrees(agents, deps, name);
      notices.push(...failures);
      for (const item of made) {
        let message = first;
        try {
          // The composer attached paths in the main folder: each agent gets its own worktree's files instead.
          message = { ...first, attachments: await attachmentsFor(deps.repoPath, item.cwd, first.attachments) };
        } catch (error) {
          notices.push(`Could not point the attachments into the worktree of ${item.agent.name}: ${String(error)}`);
        }
        ready.push({ ...item, message });
      }
    } finally {
      deps.setIsBusy(false);
      isStarting.current = false;
    }

    if (notices.length > 0) deps.onNotice(notices.join('; '));
    if (ready.length === 0) {
      deps.restoreMessage(first, agents[0].id);
      return;
    }

    // A run that ends with one session is a normal session: no run id, so no group.
    const runId = ready.length >= 2 ? crypto.randomUUID() : undefined;
    const isOnDraft = deps.isOnDraft();
    const startedAt = Date.now();
    ready.forEach(({ agent, worktree, cwd, message }, index) => {
      deps.startSession(
        { agent, cwd, name, worktree, createdAt: startedAt + index, ...(runId ? { compareRunId: runId } : {}) },
        message,
        {
          choices: withPreferred(NO_CHOICES, deps.agentOptions?.[agent.id]),
          // A run opens as a whole below, never one session at a time; a lone session opens like any other.
          focus: !runId && isOnDraft,
        },
      );
    });
    deps.onStarted();
    if (runId && isOnDraft) deps.openRun(runId);
  };

  return { startRun };
}
