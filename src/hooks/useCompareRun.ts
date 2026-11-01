import { useEffect, useRef } from 'react';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { createId } from '../lib/ids';
import { NO_CHOICES, withPreferred, type AgentOptions } from '../lib/acp-draft';
import { attachmentsFor, createSessionWorktree } from '../lib/session-worktree';
import { titleFor, type SessionSpec, type StartSessionOptions } from '../lib/session-start';
import { rowFactsOf, type CompareRun, type RowFacts, type RowSources } from '../lib/compare-run';
import { isListed } from '../lib/session-helpers';
import type { AgentProfile, Session, SessionWorktree } from '../types';

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
  /** Stops the session's agent and hides it; one whose agent cannot be stopped stays listed, with its own notice. */
  archiveSession: (sessionId: string, isArchived: boolean) => Promise<void>;
  /** The sessions as they are now: an archive that just finished may not have rendered yet. */
  readSessions: () => readonly Session[];
  openSession: (sessionId: string) => void;
  agentName: (profileId: string) => string;
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
  // Pick is asked from a panel that can remount: the guard cannot live there.
  const isPicking = useRef(false);

  const startRun = async (agents: readonly AgentProfile[], first: FirstMessage): Promise<void> => {
    if (isStarting.current || agents.length === 0) return;
    isStarting.current = true;
    deps.setIsBusy(true);
    const notices: string[] = [];
    let hasStartedSession = false;
    try {
      const name = titleFor(first);
      const { made, failures } = await makeWorktrees(agents, deps, name);
      notices.push(...failures);
      const ready: Array<Prepared & { message: FirstMessage }> = [];
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

      if (ready.length === 0) {
        deps.restoreMessage(first, agents[0].id);
        return;
      }
      // A run that ends with one session is a normal session: no run id, so no group.
      const runId = ready.length >= 2 ? createId('run') : undefined;
      const isOnDraft = deps.isOnDraft();
      const startedAt = Date.now();
      for (const [index, { agent, worktree, cwd, message }] of ready.entries()) {
        deps.startSession(
          { agent, cwd, name, worktree, createdAt: startedAt + index, ...(runId ? { compareRunId: runId } : {}) },
          message,
          {
            choices: withPreferred(NO_CHOICES, deps.agentOptions?.[agent.id]),
            // A run opens as a whole below, never one session at a time; a lone session opens like any other.
            focus: !runId && isOnDraft,
          },
        );
        hasStartedSession = true;
      }
      deps.onStarted();
      if (runId && isOnDraft) deps.openRun(runId);
    } catch (error) {
      // Nothing here may reject: the caller does not wait for the run. Worktrees already made stay on disk.
      notices.push(`Could not start the run: ${String(error)}`);
      if (!hasStartedSession) deps.restoreMessage(first, agents[0].id);
    } finally {
      if (notices.length > 0) deps.onNotice(notices.join('; '));
      deps.setIsBusy(false);
      isStarting.current = false;
    }
  };

  /** Keeps `winnerId`: archives the run's other sessions one at a time, then opens it. */
  const pick = async (run: CompareRun, winnerId: string): Promise<void> => {
    if (isPicking.current) return;
    isPicking.current = true;
    try {
      for (const session of run.sessions) {
        if (session.id !== winnerId) await deps.archiveSession(session.id, true);
      }
      const stayed = deps
        .readSessions()
        .filter((session) => session.compareRunId === run.id && session.id !== winnerId && isListed(session));
      if (stayed.length > 0) {
        // The run stays open on its panel, so the user can stop that agent and pick again.
        const names = stayed.map((session) => deps.agentName(session.profileId));
        const verb = names.length === 1 ? 'it is' : 'they are';
        deps.onNotice(`${names.join(' and ')} could not be stopped, so ${verb} still in the run.`);
        return;
      }
      deps.openSession(winnerId);
    } catch (error) {
      deps.onNotice(`Could not pick this agent: ${String(error)}`);
    } finally {
      isPicking.current = false;
    }
  };

  return { startRun, pick };
}

export interface RunRowDeps extends RowSources {
  /** Reads a session's saved chat; only the open session's is loaded on its own. */
  ensureLoaded: (sessionId: string) => void;
}

/** What the open run's panel shows for each agent; empty while no run is open. */
export function useCompareRunRows(run: CompareRun | null, deps: RunRowDeps): RowFacts[] {
  const { ensureLoaded } = deps;
  const sessionIds = run?.sessions.map((session) => session.id).join(',') ?? '';
  useEffect(() => {
    for (const id of sessionIds ? sessionIds.split(',') : []) ensureLoaded(id);
  }, [sessionIds, ensureLoaded]);
  return run ? rowFactsOf(run, deps) : [];
}
