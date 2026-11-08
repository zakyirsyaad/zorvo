import { invoke } from '@tauri-apps/api/core';
import type { AcpEngine, FirstMessage } from './session-engine/useAcpEngine';
import { buildForkHandoff, buildForkPrompt, FORK_FIRST_MESSAGE } from '../lib/fork-handoff';
import { createId } from '../lib/ids';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import type { AcpChoices } from '../lib/acp-draft';
import type { AgentProfile, ChatMessage, Session } from '../types';

export interface SessionForkDeps {
  /** The session forked from: the one open. */
  source: Session | undefined;
  agents: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  acp: Pick<AcpEngine, 'canFork' | 'fork'>;
  recordSession: (spec: SessionSpec) => Session;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
  onNotice: (message: string) => void;
}

export interface ForkOptions {
  /**
   * Another agent to continue with, in an ordinary session: never private, even from a private session, and
   * always through a handoff file, since a native fork stays in the source's own agent process.
   */
  agent?: AgentProfile;
  /** What that agent starts with; without it, the draft's picks, which belong to another agent. */
  choices?: AcpChoices;
}

/**
 * Forks the open session at a message. From the latest message, an agent
 * that supports it forks its own live session. Otherwise the conversation is
 * written to a handoff file and the new agent is asked, in one line, to read it.
 */
export function useSessionFork(deps: SessionForkDeps): (messageId: string, options?: ForkOptions) => Promise<void> {
  const { source, agents, transcripts, acp, recordSession, startSession, onNotice } = deps;

  return async (messageId: string, options?: ForkOptions) => {
    const sourceAgent = agents.find((a) => a.id === source?.profileId);
    const isOtherAgent = options?.agent !== undefined;
    const agent = options?.agent ?? sourceAgent;
    if (!source || !agent?.detected) {
      onNotice(
        isOtherAgent
          ? `${agent?.name ?? 'That agent'} is not installed, so the session cannot continue there.`
          : 'The agent for this session is not installed, so it cannot be forked.',
      );
      return;
    }
    const messages = transcripts[source.id] ?? [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    const isLatest = index === messages.length - 1;
    const spec: SessionSpec = {
      id: createId('s'),
      agent,
      cwd: source.cwd,
      name: `${source.name} (fork)`,
      forkedFrom: source.id,
      // A fork works in the same checkout as its source.
      worktree: source.worktree,
      initialMessages: messages.slice(0, index + 1),
      // A fork of a private session stays private on its model: a native fork shares the source's private
      // process, and a handoff fork starts a fresh one, which must be private too. Another agent the user
      // picked to continue with, once told the conversation leaves the TEE, runs an ordinary session.
      ...(source.privateMode && !isOtherAgent
        ? {
            privateMode: {
              modelId: source.privateMode.modelId,
              ...(source.privateMode.ownKey ? { ownKey: true } : {}),
            },
          }
        : {}),
    };
    // A native fork needs the source agent alive; after it exited, fall back to a handoff.
    if (!isOtherAgent && source.status === 'running' && isLatest && acp.canFork(source.id)) {
      void acp.fork(source.id, recordSession(spec));
      return;
    }

    try {
      const content = buildForkHandoff(messages, messageId, {
        sourceSessionName: source.name,
        // Who held the conversation so far.
        agentName: sourceAgent?.name ?? source.profileId,
        cwd: source.cwd,
        createdAt: Date.now(),
      });
      const handoffPath = await invoke<string>('write_fork_handoff', { handoffId: spec.id, content });
      // The path stays hidden: the chat shows only the short continue message.
      const first = { text: FORK_FIRST_MESSAGE, context: buildForkPrompt(handoffPath) };
      if (options?.choices) startSession(spec, first, { choices: options.choices });
      else startSession(spec, first);
    } catch (error) {
      onNotice(`Could not fork the session: ${String(error)}`);
    }
  };
}
