import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { NO_CHOICES, type AcpChoices } from '../lib/acp-draft';
import { NO_SUCH_HANDLE } from '../lib/agent-tools';
import {
  isOpenLink,
  taskRoute,
  openDelegatesOf,
  sendBlockedReason as pairSendBlockedReason,
  sourceBlockedReason,
  sourceOf,
} from '../lib/delegation';
import { buildForkHandoff } from '../lib/fork-handoff';
import {
  agentNameIn,
  blockedReasonFor,
  HANDOFF_NOTE,
  HANDOFF_TITLE,
  lastMessage,
  lastUserMessage,
  lastWholeMessage,
  handoverPendingReason,
  type StartWorkerInput,
  type StartWorkerResult,
  workerLaunch,
  workerNameOf,
} from '../lib/delegation-helpers';
import { createId } from '../lib/ids';
import { createSessionWorktree } from '../lib/session-worktree';
import { isArchived } from '../lib/session-helpers';
import type { StartPlaces } from '../lib/start-places';
import { atWorkCount, cleanFiles, isReportOwed, cleanSummary, isReportOf, issuedWorkerHandles, nextWorkerHandle, startRefusal, withNewTask, withOutcome, withTurnEnd, workerHandleOf } from '../lib/workers';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { AgentProfile, ChatMessage, DelegationLink, Session, SessionWorktree, WorkerTurnEnd } from '../types';
import type { AttentionReason, FirstMessage } from './session-engine/useAcpEngine';
import { useLatest } from './useLatest';
import { useWorkerReports } from './useWorkerReports';

export interface DelegationDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  isBusy: (sessionId: string) => boolean;
  /** Running, not in a turn, not waiting on a permission, elicitation or sign-in, agent installed. */
  canPrompt: (sessionId: string) => boolean;
  /** Waiting on the user: a permission, a question or an elicitation. */
  isWaiting: (sessionId: string) => boolean;
  /** Shared with every other way a coordinator starts a session, so one limit covers all. */
  places: StartPlaces;
  send: (
    sessionId: string,
    text: string,
    attachments?: readonly string[],
    marks?: Pick<ChatMessage, 'delegationReport' | 'delegationTask' | 'workerReport'>,
  ) => Promise<boolean>;
  /** A session's messages, loaded or saved; null when they cannot be read. */
  messagesOf: (sessionId: string) => Promise<ChatMessage[] | null>;
  /** `options.choices` are the dialog's picks; `changesToApply` applies them before the first prompt. */
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  selectSession: (sessionId: string) => void;
  /** Changes the link the state holds now for a session; two changes in one tick compose. */
  updateLink: (sessionId: string, change: (link: DelegationLink) => DelegationLink) => void;
  giveBack: (sessionId: string, text: string) => void;
  onNotice: (message: string) => void;
}

export type DelegationState =
  | 'working'
  | 'needs-answer'
  | 'reported'
  | 'failed'
  | 'source-gone'
  | 'ended'
  | 'source-working';

export interface DelegationView {
  role: 'source' | 'delegate';
  /** null when the source is gone. */
  otherSessionId: string | null;
  /** The other session's name. */
  otherName: string;
  /** B's agent on A's line, A's agent on B's line. */
  agentName: string;
  task: string;
  state: DelegationState;
  /** When B's current turn started (for "working"), else null. */
  workingSince: number | null;
  reportedAt: number | null;
}

/** What giving a task led to: a new delegate, a further task for the one that agent has, or a refusal. */
export type GiveTaskResult =
  | { ok: true; kind: 'started' | 'sent'; sessionId: string; sessionName: string; handle?: string }
  | {
      ok: false;
      /** What the caller is told; never an error's own text. */
      reason: string;
      /** Zorvo failed, not a rule: an agent is told only that it did not work. */
      isInternal?: true;
      /** The error itself, for the user's notice. It may hold a path, so it never goes to an agent. */
      detail?: string;
    };

export interface GiveTaskOptions {
  attachments?: readonly string[];
  choices?: AcpChoices;
  /** The source's own agent asks, from inside its turn: a busy source is no reason to refuse, and the user stays where they are. */
  byAgent?: boolean;
}

export type { StartWorkerInput, StartWorkerResult };

/**
 * The side effects of delegating: starts B from a fork-style handoff of A's
 * conversation, ends the link, and sends a finished B turn back to A. The
 * same-tick decisions (Send refused while a report is on its way) read refs,
 * so they hold before React renders; the report queue's revision (in
 * `useWorkerReports`) only triggers its drain.
 */
export function useDelegation(deps: DelegationDeps): {
  /** Why `sourceId` cannot give a task; with `agentId`, why it cannot give that agent one. */
  delegateBlockedReason: (sourceId: string, agentId?: string) => string | null;
  start: (
    sourceId: string,
    agentId: string,
    task: string,
    options?: { attachments?: readonly string[]; choices?: AcpChoices },
  ) => Promise<boolean>;
  /** Gives agent `agentId` a task from `sourceId`: starts its delegate, or sends the task to the one it has. */
  giveTask: (sourceId: string, agentId: string, task: string, options?: GiveTaskOptions) => Promise<GiveTaskResult>;
  /** Starts a worker for `coordinatorId`, in its folder or in a worktree of its own. */
  startWorker: (coordinatorId: string, input: StartWorkerInput) => Promise<StartWorkerResult>;
  /** Gives an idle worker of `coordinatorId` a further task. */
  sendToWorker: (
    coordinatorId: string,
    workerId: string,
    task: string,
    options?: { attachments?: readonly string[] },
  ) => Promise<GiveTaskResult>;
  /** Records a worker's `done` on its link; false when it has no open task. */
  recordDone: (
    workerId: string,
    done: { result: 'succeeded' | 'failed'; summary: string; files?: string[] },
  ) => boolean;
  end: (delegateId: string) => void;
  onTurnEnded: (sessionId: string, reason: AttentionReason) => void;
  /** How a worker's turn ended, written on its open link. */
  onTurnSettled: (sessionId: string, end: { how: WorkerTurnEnd; reason?: string }) => void;
  sendBlockedReason: (sessionId: string) => string | null;
  viewFor: (sessionId: string) => DelegationView | null;
  /** A source's lines, one per open delegate, oldest first; a delegate's own line. */
  viewsFor: (sessionId: string) => DelegationView[];
} {
  const { sessions, agents, transcripts } = deps;
  const latest = useLatest(deps);
  const reports = useWorkerReports(deps);
  // The workers being started, by a token per start: the coordinator, the new session's id once
  // it is known, its handle, and the call that frees its place. A session is in `sessions` only
  // after React commits, so starts in one tick need this to get different handles.
  const starting = useRef(
    new Map<string, { coordinatorId: string; sessionId: string | null; handle: string; free: () => void }>(),
  );
  // The delegates a further task is on its way to, with the call that frees the place the send
  // holds. Busy is React state, so it is not observable in the tick the task is sent; this is,
  // from before the send until the delegate is seen busy or its turn ends.
  const sendingTo = useRef(new Map<string, () => void>());
  const stopSending = (delegateId: string): void => {
    sendingTo.current.get(delegateId)?.();
    sendingTo.current.delete(delegateId);
  };
  // The newest worker handle each coordinator was given in this run.
  const lastHandle = useRef(new Map<string, string>());

  const agentNameOf = (profileId: string) => agentNameIn(agents, profileId);

  /** B's report is owed to A (its last turn ended after the last report), or is being sent. */
  const isOwed = (delegateId: string) =>
    isReportOwed(sessions.find((candidate) => candidate.id === delegateId)?.delegatedFrom);
  const isHandingOver = (delegateId: string) => isOwed(delegateId) || reports.isDelivering(delegateId);

  /** Whether a message of A's carries B's report, in the current or the older mark. */
  const isReportFrom = (message: ChatMessage | undefined, delegate: Session): boolean =>
    message?.delegationReport !== undefined && isReportOf(message.delegationReport, delegate)
      ? true
      : (message?.workerReport?.workers.some((worker) => isReportOf(worker, delegate)) ?? false);

  const delegateBlockedReason = (sourceId: string, agentId?: string): string | null =>
    blockedReasonFor(deps, sourceId, agentId);

  /** A works on B's report: it is on its way, or A's last prompt is B's report. */
  const isWorkingOnReport = (sourceId: string, delegateId: string): boolean => {
    if (reports.isDelivering(delegateId)) return true;
    const delegate = sessions.find((candidate) => candidate.id === delegateId);
    return delegate !== undefined && isReportFrom(lastUserMessage(transcripts[sourceId] ?? []), delegate);
  };

  const sendBlockedReason = (sessionId: string): string | null => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    const link = session?.delegatedFrom;
    if (session !== undefined && link !== null && link !== undefined && isOpenLink(link)) {
      const source = sessions.find((candidate) => candidate.id === link.sessionId);
      if (source !== undefined) {
        const delegateName = agentNameOf(session.profileId);
        const sourceName = agentNameOf(source.profileId);
        // Its last answer is on its way to A: B must not send over it.
        if (reports.isDelivering(session.id)) return `${sourceName} is working on ${delegateName}'s report.`;
        if (isOwed(session.id)) return `${delegateName}'s report waits for ${sourceName} to finish.`;
      }
    }
    return pairSendBlockedReason({
      sessionId,
      sessions,
      isBusy: deps.isBusy,
      agentNameOf,
      isWorkingOnReport,
    });
  };

  /** What the link says about its last turn, for the lines: a failed turn, or a finished one that was reported. */
  const settledOutcomeOf = (
    link: DelegationLink | null | undefined,
  ): { kind: 'reported' | 'failed'; at: number } | undefined => {
    if (link?.lastTurn?.how === 'failed') return { kind: 'failed', at: link.lastTurn.endedAt };
    if (link?.lastTurn?.how === 'finished' && link.reportedAt != null && !isReportOwed(link)) {
      return { kind: 'reported', at: link.reportedAt };
    }
    return undefined;
  };

  /** A's line for one of its delegates, or null when that delegate has nothing to show. */
  const sourceViewOf = (delegate: Session): DelegationView | null => {
    const outcome = settledOutcomeOf(delegate.delegatedFrom);
    // A delegate that is not running has no live turn: its last turn's outcome is
    // the whole story, and without one (a restart, an exited agent) there is no line.
    const state: DelegationState | null = deps.isWaiting(delegate.id)
      ? 'needs-answer'
      : deps.isBusy(delegate.id)
        ? 'working'
        : (outcome?.kind ?? null);
    if (state === null) return null;
    const workingSince =
      state === 'working'
        ? (lastUserMessage(transcripts[delegate.id] ?? [])?.timestamp ??
           delegate.delegatedFrom?.startedAt ??
           null)
        : null;
    return {
      role: 'source',
      otherSessionId: delegate.id,
      otherName: delegate.name,
      agentName: agentNameOf(delegate.profileId),
      task: delegate.delegatedFrom?.task ?? '',
      state,
      workingSince,
      reportedAt: outcome?.kind === 'reported' ? outcome.at : null,
    };
  };

  const viewFor = (sessionId: string): DelegationView | null => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined) return null;

    const link = session.delegatedFrom;
    if (link !== null && link !== undefined) {
      const source = sourceOf(session, sessions);
      const outcome = settledOutcomeOf(link);
      const reportedAt = outcome?.kind === 'reported' ? outcome.at : null;
      if (source === undefined) {
        return {
          role: 'delegate',
          otherSessionId: null,
          otherName: '',
          agentName: '',
          task: link.task,
          state: 'source-gone',
          workingSince: null,
          reportedAt,
        };
      }
      const base = {
        role: 'delegate' as const,
        otherSessionId: source.id,
        otherName: source.name,
        agentName: agentNameOf(source.profileId),
        task: link.task,
        reportedAt,
      };
      if (!isOpenLink(link)) return { ...base, state: 'ended', workingSince: null };

      const report = lastUserMessage(transcripts[source.id] ?? []);
      const isReportFromDelegate = isReportFrom(report, session);
      if (isHandingOver(session.id) || (deps.isBusy(source.id) && isReportFromDelegate)) {
        return {
          ...base,
          state: 'source-working',
          workingSince: isReportFromDelegate
            ? (report?.timestamp ?? null)
            : (link.lastTurn?.endedAt ?? null),
        };
      }
      return { ...base, state: outcome?.kind ?? 'working', workingSince: null };
    }

    // The newest delegate's line; `viewsFor` lists them all.
    const newest = openDelegatesOf(sessionId, sessions).at(-1);
    return newest === undefined ? null : sourceViewOf(newest);
  };

  /** A source's lines, one per open delegate, oldest first; a delegate's own single line. */
  const viewsFor = (sessionId: string): DelegationView[] => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined) return [];
    if (session.delegatedFrom !== null && session.delegatedFrom !== undefined) {
      const own = viewFor(sessionId);
      return own === null ? [] : [own];
    }
    return openDelegatesOf(sessionId, sessions).flatMap((delegate) => {
      const view = sourceViewOf(delegate);
      return view === null ? [] : [view];
    });
  };

  const onTurnEnded = (sessionId: string): void => {
    // Its turn is over, whatever the outcome: it can take a further task again.
    stopSending(sessionId);
    // A coordinator's turn ended: reports owed to it may go out now. What a worker's turn led
    // to is written by `onTurnSettled`, and that is what makes a report owed.
    reports.recheck(sessionId);
  };

  const onTurnSettled = (sessionId: string, end: { how: WorkerTurnEnd; reason?: string }): void => {
    const current = latest.current;
    const session = current.sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined || isArchived(session) || !isOpenLink(session.delegatedFrom)) return;
    const at = Date.now();
    // The link as it is when the write lands, so a `done` recorded just before is seen.
    current.updateLink(sessionId, (latestLink) => (isOpenLink(latestLink) ? withTurnEnd(latestLink, { ...end, at }) : latestLink));
  };

  /** A worker's `done`: the outcome goes on its link, whether or not its turn still runs. */
  const recordDone = (
    workerId: string,
    done: { result: 'succeeded' | 'failed'; summary: string; files?: string[] },
  ): boolean => {
    const current = latest.current;
    const session = current.sessions.find((candidate) => candidate.id === workerId);
    const link = session?.delegatedFrom;
    if (session === undefined || isArchived(session) || link === null || link === undefined || !isOpenLink(link)) {
      return false;
    }
    const files = cleanFiles(done.files);
    const summary = cleanSummary(done.summary);
    if (summary === '') return false;
    const outcome = {
      result: done.result,
      at: Date.now(),
      summary,
      ...(files !== undefined ? { files } : {}),
    };
    // The link as it is when the write lands: a worker ended meanwhile stays ended and gets no outcome.
    current.updateLink(workerId, (latestLink) => (isOpenLink(latestLink) ? withOutcome(latestLink, outcome) : latestLink));
    return true;
  };

  const end = (delegateId: string): void => {
    const current = latest.current;
    const session = current.sessions.find((candidate) => candidate.id === delegateId);
    const link = session?.delegatedFrom;
    if (session === undefined || link === null || link === undefined) return;

    const endedAt = Date.now();
    current.updateLink(delegateId, (latestLink) => (latestLink.endedAt == null ? { ...latestLink, endedAt } : latestLink));
    reports.drop(delegateId);
  };

  const startWorker = async (coordinatorId: string, input: StartWorkerInput): Promise<StartWorkerResult> => {
    const current = latest.current;
    const source = current.sessions.find((session) => session.id === coordinatorId);
    const agent = current.agents.find((candidate) => candidate.id === input.agentId);
    if (source === undefined) return { ok: false, reason: 'This session no longer exists.' };
    if (agent === undefined) return { ok: false, reason: 'The agent is not available.' };
    const messages = current.transcripts[source.id] ?? [];
    const blocked = sourceBlockedReason({
      source,
      isBusy: current.isBusy,
      hasMessages: messages.length > 0,
      isSourceBusyAllowed: input.byAgent === true,
      agentNameOf: (profileId) => agentNameIn(current.agents, profileId),
    });
    if (blocked !== null) return { ok: false, reason: blocked };
    const refusal = startRefusal(
      atWorkCount({
        coordinatorId,
        sessions: current.sessions,
        isBusy: current.isBusy,
        isWaiting: current.isWaiting,
        underWay: current.places.underWay(coordinatorId),
      }),
    );
    if (refusal !== null) return { ok: false, reason: refusal };
    const last = input.byAgent === true ? lastWholeMessage(messages) : lastMessage(messages);
    // A source with no messages is refused above; this keeps the handoff honest.
    if (last === undefined) return { ok: false, reason: '' };

    // Held from here, before anything awaits: the place and the handle.
    const token = createId('start');
    const handle = nextWorkerHandle([
      // The newest handle given in this run: an ended worker's handle must not pass to the next one.
      ...(lastHandle.current.has(coordinatorId) ? [lastHandle.current.get(coordinatorId) as string] : []),
      // Every handle the coordinator's saved conversation may name, open or not, after a restart too.
      ...issuedWorkerHandles(coordinatorId, current.sessions),
      ...[...starting.current.values()].filter((entry) => entry.coordinatorId === coordinatorId).map((entry) => entry.handle),
    ]);
    lastHandle.current.set(coordinatorId, handle);
    const free = current.places.take(coordinatorId);
    starting.current.set(token, { coordinatorId, sessionId: null, handle, free });
    const release = () => {
      free();
      starting.current.delete(token);
    };

    const { task } = input;
    const name = workerNameOf(agent.name, task, input.title);
    let cwd = source.cwd;
    let worktree: SessionWorktree | null = source.worktree ?? null;
    let madeWorktree: SessionWorktree | null = null;
    if (input.hasOwnWorktree === true) {
      const worktreeTitle = input.title ?? name.slice(agent.name.length + 2);
      try {
        // A coordinator in a worktree works on its own branch: the worker starts from that branch,
        // not from whatever the repository's main checkout has out.
        ({ worktree, cwd } = await createSessionWorktree(
          source.worktree?.repoPath ?? source.cwd,
          worktreeTitle,
          source.worktree?.branch,
        ));
        madeWorktree = worktree;
      } catch (error) {
        release();
        return { ok: false, reason: 'A worktree could not be made for this worker.', isInternal: true, detail: String(error) };
      }
    }
    // Nothing ran in a worktree made for a start that is withdrawn; the backend keeps its branch,
    // and a failed removal leaves a worktree to remove by hand.
    const removeMadeWorktree = (): void => {
      if (madeWorktree === null) return;
      void invoke('remove_session_worktree', { repoPath: madeWorktree.repoPath, path: madeWorktree.path }).catch(
        () => undefined,
      );
    };
    const withdraw = (): StartWorkerResult => {
      release();
      removeMadeWorktree();
      return { ok: false, reason: '' };
    };
    const isWithdrawn = () =>
      input.isCancelled?.() === true || !latest.current.sessions.some((session) => session.id === coordinatorId);
    if (isWithdrawn()) return withdraw();

    // The conversation as it is now: git took a while.
    const freshMessages = latest.current.transcripts[source.id] ?? messages;
    const freshLast = input.byAgent === true ? lastWholeMessage(freshMessages) : lastMessage(freshMessages);
    if (freshLast === undefined) return withdraw();

    const id = createId('s');
    const now = Date.now();
    try {
      const content = buildForkHandoff(freshMessages, freshLast.id, {
        sourceSessionName: source.name,
        agentName: agentNameIn(current.agents, source.profileId),
        cwd,
        createdAt: now,
        title: HANDOFF_TITLE,
        note:
          madeWorktree === null
            ? HANDOFF_NOTE
            : `${HANDOFF_NOTE} You work in ${cwd}, a worktree of ${madeWorktree.repoPath}. Make your changes there, not in the folder of the session that gave you this task.`,
      });
      const handoffPath = await invoke<string>('write_fork_handoff', { handoffId: id, content });
      if (isWithdrawn()) return withdraw();
      const { spec, first } = workerLaunch({
        id, agent, source, cwd, worktree, name, task, handle, now, handoffPath,
        ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      });
      // The dialog's picks, or the defaults: the draft's own choices stay with the draft.
      const choices = input.choices ?? NO_CHOICES;
      starting.current.set(token, { coordinatorId, sessionId: id, handle, free });
      // The agent started it: the user keeps looking at what they were looking at.
      latest.current.startSession(spec, first, input.byAgent === true ? { choices, focus: false } : { choices });
    } catch (error) {
      release();
      // No session was recorded, so nothing else would ever remove a worktree made for it.
      removeMadeWorktree();
      return { ok: false, reason: 'The task could not be handed over.', isInternal: true, detail: String(error) };
    }
    // The session is recorded: a failure to show it is no reason to report the start as failed.
    if (input.byAgent !== true) {
      try {
        latest.current.selectSession(id);
      } catch (error) {
        latest.current.onNotice(`The worker started but could not be opened: ${String(error)}`);
      }
    }
    return { ok: true, sessionId: id, sessionName: name, handle, folder: cwd };
  };

  const sendFurtherTask = async (
    source: Session,
    delegate: Session,
    task: string,
    options: GiveTaskOptions,
    stillWorking: string,
  ): Promise<GiveTaskResult> => {
    const current = latest.current;
    const link = delegate.delegatedFrom;
    const delegateName = agentNameIn(current.agents, delegate.profileId);
    const refusal: GiveTaskResult = { ok: false, reason: `${delegateName} did not take the task.` };
    if (link === null || link === undefined) return refusal;
    if (sendingTo.current.has(delegate.id)) return { ok: false, reason: stillWorking };
    const limit = startRefusal(
      atWorkCount({
        coordinatorId: source.id,
        sessions: current.sessions,
        isBusy: current.isBusy,
        isWaiting: current.isWaiting,
        underWay: current.places.underWay(source.id),
      }),
    );
    if (limit !== null) return { ok: false, reason: limit };
    // Held before anything awaits: a second task in the same tick must not reach the same turn,
    // and the send takes a place, so it counts against the limit until the delegate is at work.
    sendingTo.current.set(delegate.id, current.places.take(source.id));
    const sentAt = Date.now();
    let isTaken: boolean;
    try {
      isTaken = await current.send(delegate.id, task, options.attachments ?? [], {
        delegationTask: { agentName: agentNameIn(current.agents, source.profileId), agentId: source.profileId },
      });
    } catch {
      isTaken = false;
    }
    if (!isTaken) {
      stopSending(delegate.id);
      return refusal;
    }
    // The next report quotes the task it answers.
    current.updateLink(delegate.id, (latestLink) => withNewTask(latestLink, task, sentAt));
    return { ok: true, kind: 'sent', sessionId: delegate.id, sessionName: delegate.name };
  };

  const sendToWorker = async (
    coordinatorId: string,
    workerId: string,
    task: string,
    options: { attachments?: readonly string[] } = {},
  ): Promise<GiveTaskResult> => {
    const current = latest.current;
    const source = current.sessions.find((session) => session.id === coordinatorId);
    if (source === undefined) return { ok: false, reason: 'This session no longer exists.' };
    const worker = openDelegatesOf(coordinatorId, current.sessions).find((candidate) => candidate.id === workerId);
    if (worker === undefined) return { ok: false, reason: NO_SUCH_HANDLE };
    const handle = workerHandleOf(worker) ?? worker.profileId;
    const stillWorking = `${handle} is still working. Send this when it reports.`;
    if (current.isBusy(worker.id) || current.isWaiting(worker.id) || sendingTo.current.has(worker.id)) {
      return { ok: false, reason: stillWorking };
    }
    if (isHandingOver(worker.id)) {
      // A task sent now would become the worker's last message, and the answer that
      // still waits to be reported would be lost.
      return { ok: false, reason: `${handle}'s last result has not reached this session yet. Give it the next task after its report arrives.` };
    }
    // Its agent is gone (the app restarted, the session ended): a task sent there reaches nobody.
    if (worker.status === 'terminated') {
      end(worker.id);
      return { ok: false, reason: `${handle} can't take more work. Start a new worker.` };
    }
    return sendFurtherTask(source, worker, task, options, stillWorking);
  };

  const giveTask = async (
    sourceId: string,
    agentId: string,
    task: string,
    options: GiveTaskOptions = {},
  ): Promise<GiveTaskResult> => {
    const current = latest.current;
    const source = current.sessions.find((session) => session.id === sourceId);
    const agent = current.agents.find((candidate) => candidate.id === agentId);
    if (source === undefined) return { ok: false, reason: 'This session no longer exists.' };
    if (agent === undefined) return { ok: false, reason: 'The agent is not available.' };

    const route = taskRoute({
      source,
      agentId,
      sessions: current.sessions,
      isBusy: current.isBusy,
      isWaiting: current.isWaiting,
      hasMessages: (current.transcripts[source.id] ?? []).length > 0,
      isSourceBusyAllowed: options.byAgent === true,
      agentNameOf: (profileId) => agentNameIn(current.agents, profileId),
    });
    if (route.kind === 'blocked') return { ok: false, reason: route.reason };

    if (route.kind === 'follow-up') {
      const { delegate } = route;
      if (delegate.status !== 'terminated') {
        if (isHandingOver(delegate.id)) {
          return { ok: false, reason: handoverPendingReason(agent.name) };
        }
        return sendFurtherTask(source, delegate, task, options, `${agent.name} is still working on the previous task.`);
      }
      // The old link ends and the task starts a new worker.
      end(delegate.id);
    }

    const started = await startWorker(sourceId, {
      agentId,
      task,
      ...(options.attachments !== undefined ? { attachments: options.attachments } : {}),
      ...(options.choices !== undefined ? { choices: options.choices } : {}),
      ...(options.byAgent !== undefined ? { byAgent: options.byAgent } : {}),
    });
    if (!started.ok) return started;
    return { ok: true, kind: 'started', sessionId: started.sessionId, sessionName: started.sessionName, handle: started.handle };
  };

  /** The dialog's and the mention's way in: a refusal is a notice. */
  const start = async (
    sourceId: string,
    agentId: string,
    task: string,
    options: { attachments?: readonly string[]; choices?: AcpChoices } = {},
  ): Promise<boolean> => {
    const result = await giveTask(sourceId, agentId, task, options);
    if (result.ok) return true;
    const why = result.detail ?? result.reason;
    latest.current.onNotice(why === '' ? 'Could not delegate.' : `Could not delegate. ${why}`);
    return false;
  };

  // Once a delegate is seen busy the route refuses by itself (also when its turn is later
  // cancelled, which ends without a turn-end notice); a delegate that is gone needs no hold.
  useEffect(() => {
    for (const delegateId of [...sendingTo.current.keys()]) {
      const isListed = sessions.some((session) => session.id === delegateId);
      if (!isListed || deps.isBusy(delegateId)) stopSending(delegateId);
    }
  });

  // A worker that is listed no longer needs its place held: the rules see the session itself.
  useEffect(() => {
    for (const [token, entry] of [...starting.current]) {
      if (entry.sessionId !== null && sessions.some((session) => session.id === entry.sessionId)) {
        entry.free();
        starting.current.delete(token);
      }
    }
  }, [sessions]);

  return { delegateBlockedReason, start, giveTask, startWorker, sendToWorker, recordDone, end, onTurnEnded, onTurnSettled, sendBlockedReason, viewFor, viewsFor };
}