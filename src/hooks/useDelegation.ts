import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NO_CHOICES, type AcpChoices } from '../lib/acp-draft';
import {
  answerOf,
  buildDelegatePrompt,
  delegateBlockedReason as delegationBlockedReason,
  delegateSessionName,
  isOpenLink,
  openDelegateOf,
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
    marks?: Pick<ChatMessage, 'delegationReport'>,
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

interface DelegationOutcome {
  kind: 'reported' | 'failed';
  at: number;
}

function agentNameIn(agents: readonly AgentProfile[], profileId: string): string {
  return agents.find((agent) => agent.id === profileId)?.name ?? profileId;
}

/** Why A cannot delegate, with the latest sessions and transcripts. */
function blockedReasonFor(deps: DelegationDeps, sourceId: string): string | null {
  const source = deps.sessions.find((session) => session.id === sourceId);
  // A session that is gone has no delegation item to show.
  if (source === undefined) return '';
  return delegationBlockedReason({
    source,
    sessions: deps.sessions,
    isBusy: deps.isBusy,
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
  delegateBlockedReason: (sourceId: string) => string | null;
  start: (
    sourceId: string,
    agentId: string,
    task: string,
    options?: { attachments?: readonly string[]; choices?: AcpChoices },
  ) => Promise<boolean>;
  end: (delegateId: string) => void;
  onTurnEnded: (sessionId: string, reason: AttentionReason) => void;
  sendBlockedReason: (sessionId: string) => string | null;
  viewFor: (sessionId: string) => DelegationView | null;
} {
  const { sessions, agents, transcripts } = deps;
  const latest = useLatest(deps);
  // Each source whose report is on its way, by source id, with the delegate it belongs to.
  const handingOver = useRef(new Map<string, string>());
  // Each finished delegate whose report still has to go out, by delegate id, with its source.
  const pending = useRef(new Map<string, string>());
  // What each delegate's last turn led to: a report, or a failed turn. Memory only.
  const outcomes = useRef(new Map<string, DelegationOutcome>());
  // When the hand-over began, for B's line while the report is still on its way.
  const handoverSince = useRef(new Map<string, number>());
  // Bumped when a turn ends or a hand-over settles, so the drain runs and the lines read again.
  const [revision, setRevision] = useState(0);

  const agentNameOf = (profileId: string) => agentNameIn(agents, profileId);

  const dropHandover = useCallback((sourceId: string, delegateId: string) => {
    if (handingOver.current.get(sourceId) === delegateId) handingOver.current.delete(sourceId);
    handoverSince.current.delete(delegateId);
  }, []);

  const delegateBlockedReason = (sourceId: string): string | null => blockedReasonFor(deps, sourceId);

  const sendBlockedReason = (sessionId: string): string | null => {
    const reason = pairSendBlockedReason({
      sessionId,
      sessions,
      isBusy: deps.isBusy,
      agentNameOf,
    });
    if (reason !== null) return reason;

    const session = sessions.find((candidate) => candidate.id === sessionId);
    const link = session?.delegatedFrom;
    if (session === undefined || link === null || link === undefined || !isOpenLink(link)) return null;
    // Same tick as the turn ended: the report is not with A yet, but B must not send over it.
    if (handingOver.current.get(link.sessionId) !== session.id) return null;
    const source = sessions.find((candidate) => candidate.id === link.sessionId);
    if (source === undefined) return null;
    return `${agentNameOf(source.profileId)} is working on ${agentNameOf(session.profileId)}'s report.`;
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
      if (handingOver.current.get(source.id) === session.id || (deps.isBusy(source.id) && isReportFromDelegate)) {
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

    const delegate = openDelegateOf(sessionId, sessions);
    if (delegate === undefined) return null;
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

  const onTurnEnded = (sessionId: string, reason: AttentionReason): void => {
    const session = latest.current.sessions.find((candidate) => candidate.id === sessionId);
    const link = session?.delegatedFrom;
    // An archived delegate's link is ended with it: a late turn end has nothing to report.
    if (session === undefined || isArchived(session) || link === null || link === undefined || !isOpenLink(link)) return;

    if (reason === 'finished') {
      // Set before anything can await or render: Send in B is refused from now on.
      pending.current.set(session.id, link.sessionId);
      handingOver.current.set(link.sessionId, session.id);
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
    const sourceId = pending.current.get(delegateId) ?? link.sessionId;
    pending.current.delete(delegateId);
    dropHandover(sourceId, delegateId);
  };

  const start = async (
    sourceId: string,
    agentId: string,
    task: string,
    options: { attachments?: readonly string[]; choices?: AcpChoices } = {},
  ): Promise<boolean> => {
    const current = latest.current;
    const source = current.sessions.find((session) => session.id === sourceId);
    const agent = current.agents.find((candidate) => candidate.id === agentId);
    if (source === undefined) {
      current.onNotice('Could not delegate: this session no longer exists.');
      return false;
    }
    if (agent === undefined) {
      current.onNotice('Could not delegate: the agent is not available.');
      return false;
    }

    const blocked = blockedReasonFor(current, sourceId);
    if (blocked !== null) {
      current.onNotice(blocked === '' ? 'Could not delegate.' : `Could not delegate: ${blocked}`);
      return false;
    }

    const messages = current.transcripts[source.id] ?? [];
    const last = lastMessage(messages);
    // A source with no messages is blocked above; this keeps the handoff honest.
    if (last === undefined) {
      current.onNotice('Could not delegate.');
      return false;
    }

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
      const spec: SessionSpec = {
        id,
        agent,
        cwd: source.cwd,
        worktree: source.worktree,
        name: delegateSessionName(agent.name, task),
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
      current.startSession(spec, first, { choices: options.choices ?? NO_CHOICES });
      current.selectSession(id);
      return true;
    } catch (error) {
      current.onNotice(`Could not delegate: ${String(error)}`);
      return false;
    }
  };

  useEffect(() => {
    const deliver = async (delegateId: string, sourceId: string): Promise<void> => {
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
        dropHandover(sourceId, delegateId);
        // The hand-over is over either way: Send in B may be judged again.
        setRevision((currentRevision) => currentRevision + 1);
      }
    };

    const drain = async (): Promise<void> => {
      for (const [delegateId, sourceId] of [...pending.current]) {
        // Deleted first: a second run (StrictMode) must not send the report again.
        if (!pending.current.delete(delegateId)) continue;
        await deliver(delegateId, sourceId);
      }
    };
    void drain();
    // The triggers are the transcript, the sessions, and a turn that ended; `latest`
    // and `dropHandover` never change. The deps themselves come through `latest`, so
    // a queued report sends with the freshest functions rather than the render that
    // queued it.
  }, [transcripts, sessions, revision, latest, dropHandover]);

  return { delegateBlockedReason, start, end, onTurnEnded, sendBlockedReason, viewFor };
}