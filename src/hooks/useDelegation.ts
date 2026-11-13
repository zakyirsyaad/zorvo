import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NO_CHOICES, type AcpChoices } from '../lib/acp-draft';
import {
  answerOf,
  buildDelegatePrompt,
  delegateBlockedReason as delegationBlockedReason,
  delegateSessionName,
  isOpenLink,
  taskRoute,
  openDelegatesOf,
  reportMessage,
  reportedFiles,
  sendBlockedReason as pairSendBlockedReason,
  sourceOf,
} from '../lib/delegation';
import { buildForkHandoff } from '../lib/fork-handoff';
import { createId } from '../lib/ids';
import { isArchived } from '../lib/session-helpers';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { AgentProfile, ChatMessage, Session } from '../types';
import type { AttentionReason, FirstMessage } from './session-engine/useAcpEngine';
import { useLatest } from './useLatest';

/** The handoff's heading: a delegation, not a fork. */
const HANDOFF_TITLE = '# Delegation handoff';

/** The line under the heading, before the conversation and the task. */
const HANDOFF_NOTE =
  "Another agent's session delegated a task to you and waits for your answer. The task is in the message that follows.";

export interface DelegationDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  isBusy: (sessionId: string) => boolean;
  /** Running, not in a turn, not waiting on a permission, elicitation or sign-in, agent installed. */
  canPrompt: (sessionId: string) => boolean;
  /** Waiting on the user: a permission, a question or an elicitation. */
  isWaiting: (sessionId: string) => boolean;
  send: (
    sessionId: string,
    text: string,
    attachments?: readonly string[],
    marks?: Pick<ChatMessage, 'delegationReport' | 'delegationTask'>,
  ) => Promise<boolean>;
  /** `options.choices` are the dialog's picks; `changesToApply` applies them before the first prompt. */
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  selectSession: (sessionId: string) => void;
  patchSession: (sessionId: string, patch: Partial<Session>) => void;
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
  | { ok: true; kind: 'started' | 'sent'; sessionId: string; sessionName: string }
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

interface DelegationOutcome {
  kind: 'reported' | 'failed';
  at: number;
}

function agentNameIn(agents: readonly AgentProfile[], profileId: string): string {
  return agents.find((agent) => agent.id === profileId)?.name ?? profileId;
}

/** Why A cannot delegate, with the latest sessions and transcripts. */
function blockedReasonFor(deps: DelegationDeps, sourceId: string, agentId?: string): string | null {
  const source = deps.sessions.find((session) => session.id === sourceId);
  // A session that is gone has no delegation item to show.
  if (source === undefined) return '';
  return delegationBlockedReason({
    source,
    ...(agentId !== undefined ? { agentId } : {}),
    sessions: deps.sessions,
    isBusy: deps.isBusy,
    isWaiting: deps.isWaiting,
    hasMessages: (deps.transcripts[sourceId] ?? []).length > 0,
    agentNameOf: (profileId) => agentNameIn(deps.agents, profileId),
  });
}

function lastMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  return messages[messages.length - 1];
}

function lastUserMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return message;
  }
  return undefined;
}

/** A path as A sees it: relative to its folder when the tool named it inside. */
function relativeTo(cwd: string, path: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The side effects of delegating: starts B from a fork-style handoff of A's
 * conversation, ends the link, and sends a finished B turn back to A. The
 * same-tick decisions (Send refused while a report is on its way) read refs,
 * so they hold before React renders; the revision only triggers the drain.
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
  end: (delegateId: string) => void;
  onTurnEnded: (sessionId: string, reason: AttentionReason) => void;
  sendBlockedReason: (sessionId: string) => string | null;
  viewFor: (sessionId: string) => DelegationView | null;
  /** A source's lines, one per open delegate, oldest first; a delegate's own line. */
  viewsFor: (sessionId: string) => DelegationView[];
} {
  const { sessions, agents, transcripts } = deps;
  const latest = useLatest(deps);
  // Each finished delegate whose report waits for its source, by delegate id, in arrival order.
  const pending = useRef(new Map<string, string>());
  // The delegates whose report is being sent right now.
  const delivering = useRef(new Set<string>());
  // What each delegate's last turn led to: a report, or a failed turn. Memory only.
  const outcomes = useRef(new Map<string, DelegationOutcome>());
  // The delegates being started, by source and agent, with the new session's id once it is known.
  // A session is in `sessions` only after React commits, so a second task for the same agent in
  // the same tick would otherwise start a second delegate.
  const starting = useRef(new Map<string, string | null>());
  // The delegates a further task is on its way to. Busy is React state, so it is not
  // observable in the tick the task is sent; this is, from before the send until the
  // delegate is seen busy or its turn ends.
  const sendingTo = useRef(new Set<string>());
  // When the hand-over began, for B's line while the report is still on its way.
  const handoverSince = useRef(new Map<string, number>());
  // Bumped when a turn ends or a hand-over settles, so the drain runs and the lines read again.
  const [revision, setRevision] = useState(0);

  const agentNameOf = (profileId: string) => agentNameIn(agents, profileId);

  const dropHandover = useCallback((delegateId: string) => {
    delivering.current.delete(delegateId);
    handoverSince.current.delete(delegateId);
  }, []);

  /** B's report has not reached A yet: it waits for A's turn, or is being sent. */
  const isHandingOver = (delegateId: string) =>
    pending.current.has(delegateId) || delivering.current.has(delegateId);

  const delegateBlockedReason = (sourceId: string, agentId?: string): string | null =>
    blockedReasonFor(deps, sourceId, agentId);

  /** A works on B's report: it is on its way, or A's last prompt is B's report. */
  const isWorkingOnReport = (sourceId: string, delegateId: string): boolean => {
    if (delivering.current.has(delegateId)) return true;
    const delegate = sessions.find((candidate) => candidate.id === delegateId);
    const report = lastUserMessage(transcripts[sourceId] ?? [])?.delegationReport;
    return delegate !== undefined && report?.agentId === delegate.profileId;
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
        if (delivering.current.has(session.id)) return `${sourceName} is working on ${delegateName}'s report.`;
        if (pending.current.has(session.id)) return `${delegateName}'s report waits for ${sourceName} to finish.`;
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

  /** A's line for one of its delegates, or null when that delegate has nothing to show. */
  const sourceViewOf = (delegate: Session): DelegationView | null => {
    const outcome = outcomes.current.get(delegate.id);
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
      const outcome = outcomes.current.get(session.id);
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
      const isReportFromDelegate = report?.delegationReport?.agentId === session.profileId;
      if (isHandingOver(session.id) || (deps.isBusy(source.id) && isReportFromDelegate)) {
        return {
          ...base,
          state: 'source-working',
          workingSince: isReportFromDelegate
            ? (report?.timestamp ?? null)
            : (handoverSince.current.get(session.id) ?? null),
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

  const onTurnEnded = (sessionId: string, reason: AttentionReason): void => {
    const session = latest.current.sessions.find((candidate) => candidate.id === sessionId);
    const link = session?.delegatedFrom;
    // Its turn is over, whatever the outcome: it can take a further task again.
    sendingTo.current.delete(sessionId);
    // A source's turn ended: a report that waited for it may go out now.
    if ([...pending.current.values()].includes(sessionId)) setRevision((current) => current + 1);
    // An archived delegate's link is ended with it: a late turn end has nothing to report.
    if (session === undefined || isArchived(session) || link === null || link === undefined || !isOpenLink(link)) return;

    if (reason === 'finished') {
      // Set before anything can await or render: Send in B is refused from now on.
      pending.current.set(session.id, link.sessionId);
      handoverSince.current.set(session.id, Date.now());
      setRevision((current) => current + 1);
    } else if (reason === 'failed') {
      outcomes.current.set(session.id, { kind: 'failed', at: Date.now() });
      setRevision((current) => current + 1);
    }
  };

  const end = (delegateId: string): void => {
    const current = latest.current;
    const session = current.sessions.find((candidate) => candidate.id === delegateId);
    const link = session?.delegatedFrom;
    if (session === undefined || link === null || link === undefined) return;

    current.patchSession(delegateId, { delegatedFrom: { ...link, endedAt: Date.now() } });
    // A report still queued for A is dropped with the link.
    pending.current.delete(delegateId);
    dropHandover(delegateId);
  };

  /** The last message that is whole: a reply still streaming (it holds the tool call) is left out. */
  const lastWholeMessage = (messages: readonly ChatMessage[]): ChatMessage | undefined => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'agent' || message.isComplete === true) return message;
    }
    return undefined;
  };

  const startDelegate = async (
    source: Session,
    agent: AgentProfile,
    task: string,
    options: GiveTaskOptions,
  ): Promise<GiveTaskResult> => {
    const current = latest.current;
    const messages = current.transcripts[source.id] ?? [];
    const last = options.byAgent === true ? lastWholeMessage(messages) : lastMessage(messages);
    // A source with no messages is refused by the route; this keeps the handoff honest.
    if (last === undefined) return { ok: false, reason: '' };

    const id = createId('s');
    const now = Date.now();
    try {
      const content = buildForkHandoff(messages, last.id, {
        sourceSessionName: source.name,
        agentName: agentNameIn(current.agents, source.profileId),
        cwd: source.cwd,
        createdAt: now,
        title: HANDOFF_TITLE,
        note: HANDOFF_NOTE,
      });
      const handoffPath = await invoke<string>('write_fork_handoff', { handoffId: id, content });
      const name = delegateSessionName(agent.name, task);
      const spec: SessionSpec = {
        id,
        agent,
        cwd: source.cwd,
        worktree: source.worktree,
        name,
        delegatedFrom: { sessionId: source.id, task, startedAt: now },
      };
      const first: FirstMessage = {
        text: task,
        ...(options.attachments !== undefined && options.attachments.length > 0
          ? { attachments: options.attachments }
          : {}),
        context: buildDelegatePrompt(handoffPath),
      };
      // The dialog's picks, or the defaults: the draft's own choices stay with the draft.
      const choices = options.choices ?? NO_CHOICES;
      if (options.byAgent === true) {
        // The agent started it: the user keeps looking at what they were looking at.
        current.startSession(spec, first, { choices, focus: false });
      } else {
        current.startSession(spec, first, { choices });
        current.selectSession(id);
      }
      return { ok: true, kind: 'started', sessionId: id, sessionName: name };
    } catch (error) {
      return { ok: false, reason: 'The task could not be handed over.', isInternal: true, detail: String(error) };
    }
  };

  const sendFurtherTask = async (
    source: Session,
    delegate: Session,
    task: string,
    options: GiveTaskOptions,
  ): Promise<GiveTaskResult> => {
    const current = latest.current;
    const link = delegate.delegatedFrom;
    const delegateName = agentNameIn(current.agents, delegate.profileId);
    const refusal: GiveTaskResult = { ok: false, reason: `${delegateName} did not take the task.` };
    if (link === null || link === undefined) return refusal;
    if (sendingTo.current.has(delegate.id)) {
      return { ok: false, reason: `${delegateName} is still working on the previous task.` };
    }
    // Held before anything awaits: a second task in the same tick must not reach the same turn.
    sendingTo.current.add(delegate.id);
    let isTaken: boolean;
    try {
      isTaken = await current.send(delegate.id, task, options.attachments ?? [], {
        delegationTask: { agentName: agentNameIn(current.agents, source.profileId), agentId: source.profileId },
      });
    } catch {
      isTaken = false;
    }
    if (!isTaken) {
      sendingTo.current.delete(delegate.id);
      return refusal;
    }
    // The next report quotes the task it answers.
    current.patchSession(delegate.id, { delegatedFrom: { ...link, task } });
    return { ok: true, kind: 'sent', sessionId: delegate.id, sessionName: delegate.name };
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
    if (source === undefined) return { ok: false, reason: 'this session no longer exists.' };
    if (agent === undefined) return { ok: false, reason: 'the agent is not available.' };
    const startKey = `${sourceId}\n${agentId}`;
    if (starting.current.has(startKey)) {
      return { ok: false, reason: `${agent.name} is still working on the previous task.` };
    }

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
      // Its agent is gone (the app restarted, the session ended): a task sent there reaches
      // nobody. The old link ends and the task starts a new delegate.
      if (delegate.status !== 'terminated') {
        if (isHandingOver(delegate.id)) {
          // A task sent now would become the delegate's last message, and the answer that
          // still waits to be reported would be lost.
          return {
            ok: false,
            reason: `${agent.name}'s last answer has not reached this session yet. Give it the next task after its report arrives.`,
          };
        }
        return sendFurtherTask(source, delegate, task, options);
      }
      end(delegate.id);
    }

    // Held from here, before anything awaits, until the new session is listed.
    starting.current.set(startKey, null);
    const started = await startDelegate(source, agent, task, options);
    if (started.ok) starting.current.set(startKey, started.sessionId);
    else starting.current.delete(startKey);
    return started;
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
    latest.current.onNotice(why === '' ? 'Could not delegate.' : `Could not delegate: ${why}`);
    return false;
  };

  // Once a delegate is seen busy the route refuses by itself (also when its turn is later
  // cancelled, which ends without a turn-end notice); a delegate that is gone needs no hold.
  useEffect(() => {
    for (const delegateId of [...sendingTo.current]) {
      const isListed = sessions.some((session) => session.id === delegateId);
      if (!isListed || deps.isBusy(delegateId)) sendingTo.current.delete(delegateId);
    }
  });

  // A delegate that is listed no longer needs its start held: the rules see the session itself.
  useEffect(() => {
    for (const [key, sessionId] of [...starting.current]) {
      if (sessionId !== null && sessions.some((session) => session.id === sessionId)) starting.current.delete(key);
    }
  }, [sessions]);

  useEffect(() => {
    const deliver = async (delegateId: string): Promise<void> => {
      const current = latest.current;
      try {
        const session = current.sessions.find((candidate) => candidate.id === delegateId);
        const link = session?.delegatedFrom;
        // B is gone, archived, or its link is no longer open: nothing to send.
        if (session === undefined || isArchived(session) || link === null || link === undefined || !isOpenLink(link)) return;

        const messages = current.transcripts[delegateId] ?? [];
        const last = lastMessage(messages);
        const answer = answerOf(last);
        // A turn with no answer text (tool calls only) reports nothing.
        if (last === undefined || answer === '') return;

        const source = sourceOf(session, current.sessions);
        if (source === undefined) return;

        const agentName = agentNameIn(current.agents, session.profileId);
        const files = [
          ...new Set(reportedFiles(last).map((path) => relativeTo(source.cwd, path))),
        ];
        const report = reportMessage({ agentName, task: link.task, answer, files });

        if (!current.canPrompt(source.id)) {
          // Waiting in A's composer is delivery: A's line shows the report, not a running turn.
          outcomes.current.set(delegateId, { kind: 'reported', at: Date.now() });
          current.giveBack(source.id, report);
          current.onNotice(`${agentName}'s report is in the composer of ${source.name}.`);
          return;
        }

        const at = Date.now();
        let isSent: boolean;
        try {
          isSent = await current.send(source.id, report, [], {
            delegationReport: { agentName, agentId: session.profileId },
          });
        } catch {
          isSent = false;
        }
        if (isSent) {
          outcomes.current.set(delegateId, { kind: 'reported', at });
          return;
        }
        // The agent refused the prompt: the report waits in A's composer, as when A cannot take one.
        outcomes.current.set(delegateId, { kind: 'reported', at: Date.now() });
        current.giveBack(source.id, report);
        current.onNotice(`${agentName}'s report is in the composer of ${source.name}.`);
      } finally {
        dropHandover(delegateId);
        // The hand-over is over either way: Send in B may be judged again.
        setRevision((currentRevision) => currentRevision + 1);
      }
    };

    const drain = async (): Promise<void> => {
      // One report per source per pass: taking it starts the source's next turn.
      const served = new Set<string>();
      for (const [delegateId, sourceId] of [...pending.current]) {
        if (served.has(sourceId)) continue;
        const current = latest.current;
        // The source is in a turn, or waits for the user: the report waits too. It goes
        // out when that changes (the transcripts, the sessions or a turn end bring us back).
        if (current.isBusy(sourceId) || current.isWaiting(sourceId)) continue;
        // Deleted first: a second run (StrictMode) must not send the report again.
        if (!pending.current.delete(delegateId)) continue;
        delivering.current.add(delegateId);
        served.add(sourceId);
        await deliver(delegateId);
      }
    };
    void drain();
    // The triggers are the transcript, the sessions, and a turn that ended; `latest`
    // and `dropHandover` never change. The deps themselves come through `latest`, so
    // a queued report sends with the freshest functions rather than the render that
    // queued it.
  }, [transcripts, sessions, revision, latest, dropHandover]);

  return { delegateBlockedReason, start, giveTask, end, onTurnEnded, sendBlockedReason, viewFor, viewsFor };
}