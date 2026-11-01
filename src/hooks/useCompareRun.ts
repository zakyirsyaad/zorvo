import { useCallback, useEffect, useRef, useState } from 'react';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { useLatest } from './useLatest';
import type { AuthMethod } from '../lib/acp-auth';
import { createId } from '../lib/ids';
import { NO_CHOICES, withPreferred, type AgentOptions } from '../lib/acp-draft';
import { attachmentsFor, createSessionWorktree } from '../lib/session-worktree';
import { titleFor, type SessionSpec, type StartSessionOptions } from '../lib/session-start';
import {
  compareRuns,
  isRunSettled,
  rowFactsOf,
  rowStatus,
  runFinishedBody,
  runOfSession,
  type CompareRun,
  type RowFacts,
  type RowSources,
} from '../lib/compare-run';
import type { AttentionNotice } from '../lib/notify';
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
  /** The sessions as last rendered: what the rows are read from. */
  sessions: readonly Session[];
  sources: Omit<RowSources, 'signInNeeded'>;
  /** Asks for the sign-in of a session on screen, with the message its agent refused. */
  askSignIn: (session: Session, methods: AuthMethod[], unsent?: FirstMessage) => void;
  notifyRun: (notice: AttentionNotice) => void;
}

/** An agent's refusal, kept on its row: memory only, so after a restart the row reads Stopped. */
export interface RefusedSignIn {
  methods: AuthMethod[];
  unsent?: FirstMessage;
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
  /** Runs started here that have not settled yet: the only ones that notify, so a restored run never does. */
  const watchedRuns = useRef(new Set<string>());
  const [signInNeeded, setSignInNeeded] = useState<ReadonlyMap<string, RefusedSignIn>>(new Map());
  // An engine calls back from the render that started it: these read the newest one.
  const latest = useLatest({ deps, signInNeeded });

  const { sessions } = deps;
  // An archived or deleted session asks for nothing more; the last one of a run stays, and its chat asks.
  useEffect(() => {
    setSignInNeeded((prev) => {
      const kept = [...prev].filter(([id]) => sessions.some((session) => session.id === id && isListed(session)));
      return kept.length === prev.size ? prev : new Map(kept);
    });
  }, [sessions]);

  useEffect(() => {
    if (watchedRuns.current.size === 0) return;
    for (const run of compareRuns(sessions)) {
      if (!watchedRuns.current.has(run.id)) continue;
      const statuses = rowFactsOf(run, { ...deps.sources, signInNeeded }).map(rowStatus);
      if (!isRunSettled(statuses)) continue;
      watchedRuns.current.delete(run.id);
      deps.notifyRun({ title: run.name, body: runFinishedBody(statuses.filter((status) => status === 'done').length) });
    }
  });

  /** Whether the session is part of a run: its agents can be refused together, and its panel hides the composer. */
  const isInRun = useCallback(
    (sessionId: string) => runOfSession(latest.current.deps.readSessions(), sessionId) !== null,
    [latest],
  );

  /** Whether the session's end of a turn is left to its run's one notice, which is still to come. */
  const awaitsRunNotice = useCallback(
    (sessionId: string) => {
      const run = runOfSession(latest.current.deps.readSessions(), sessionId);
      return run !== null && watchedRuns.current.has(run.id);
    },
    [latest],
  );

  const keepSignIn = useCallback((sessionId: string, refused: RefusedSignIn) => {
    setSignInNeeded((prev) => new Map(prev).set(sessionId, refused));
  }, []);

  /** The message went out, so the row no longer waits and cannot send it again. */
  const dropSignIn = useCallback((sessionId: string) => {
    setSignInNeeded((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  /** Asks for the session's sign-in. The refusal stays until the message goes out: a sign-in can fail, or be blocked or left. */
  const takeSignIn = useCallback(
    (sessionId: string) => {
      const refused = latest.current.signInNeeded.get(sessionId);
      const session = latest.current.deps.readSessions().find((s) => s.id === sessionId);
      if (refused && session) latest.current.deps.askSignIn(session, refused.methods, refused.unsent);
    },
    [latest],
  );

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
      if (runId) watchedRuns.current.add(runId);
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
    // The user has answered the run: agents stopped for it must not read as a run that finished.
    watchedRuns.current.delete(run.id);
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

  return { startRun, pick, signInNeeded, isInRun, awaitsRunNotice, keepSignIn, dropSignIn, takeSignIn };
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
