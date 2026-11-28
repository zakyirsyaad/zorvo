import { useRef, useState } from "react";
import { NO_CHOICES, withPreferred, type AcpChoices, type AgentOptions } from "../lib/acp-draft";
import type { ForkOptions } from "./useSessionFork";
import { switchHiddenFor } from "../lib/agent-switch";
import type { AgentProfile, ChatMessage, Session } from "../types";

/** Another agent picked in a session's composer, waiting for Send to start its session. */
export interface PendingSwitch {
  agentId: string;
  /** What the new agent starts with; the composer's chips edit these, never the running session. */
  choices: AcpChoices;
}

export interface AgentSwitch {
  pendingOf: (sessionId: string) => PendingSwitch | undefined;
  /** The session's own agent clears the pick. */
  pick: (sessionId: string, agentId: string) => void;
  keep: (sessionId: string) => void;
  setChoices: (sessionId: string, choices: AcpChoices) => void;
  /** Starts the picked agent's session from the last message, the typed message going first; false when it did not start. */
  send: (sessionId: string, message: { text: string; attachments?: readonly string[] }) => Promise<boolean>;
}

export interface AgentSwitchDeps {
  sessions: readonly Session[];
  agentsInUse: readonly AgentProfile[];
  transcripts: Readonly<Record<string, ChatMessage[]>>;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  forkSession: (messageId: string, options?: ForkOptions) => Promise<boolean>;
}

/**
 * The composer's pick of another agent, per session and in memory only, like the composer's text. A pick whose
 * session is gone or archived, or whose agent is no longer in use, reads as no pick.
 */
export function useAgentSwitch({ sessions, agentsInUse, transcripts, agentOptions, forkSession }: AgentSwitchDeps): AgentSwitch {
  const [pending, setPending] = useState<Readonly<Record<string, PendingSwitch>>>({});
  // Sessions whose switch is starting: a second Send in that window would start a second session.
  const starting = useRef(new Set<string>());

  const sessionOf = (sessionId: string) => sessions.find((session) => session.id === sessionId && !session.archivedAt);
  const pendingOf = (sessionId: string): PendingSwitch | undefined => {
    const picked = pending[sessionId];
    const session = sessionOf(sessionId);
    if (!picked || !session) return undefined;
    // A session that stopped offering other agents (rewound to nothing, joined a compare run) drops its pick.
    if (switchHiddenFor(session, (transcripts[sessionId] ?? []).length, false)) return undefined;
    return agentsInUse.some((agent) => agent.id === picked.agentId) ? picked : undefined;
  };

  const without = (sessionId: string) =>
    setPending((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)));

  const pick = (sessionId: string, agentId: string) => {
    if (sessionOf(sessionId)?.profileId === agentId) {
      without(sessionId);
      return;
    }
    setPending((current) => ({ ...current, [sessionId]: { agentId, choices: withPreferred(NO_CHOICES, agentOptions?.[agentId]) } }));
  };

  const setChoices = (sessionId: string, choices: AcpChoices) =>
    setPending((current) => (current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], choices } } : current));

  const send = async (sessionId: string, message: { text: string; attachments?: readonly string[] }) => {
    const picked = pendingOf(sessionId);
    const agent = picked && agentsInUse.find((candidate) => candidate.id === picked.agentId);
    const last = (transcripts[sessionId] ?? []).at(-1);
    if (!picked || !agent || !last || starting.current.has(sessionId)) return false;
    const firstMessage = message.attachments?.length ? { text: message.text, attachments: message.attachments } : { text: message.text };
    starting.current.add(sessionId);
    try {
      const isStarted = await forkSession(last.id, { agent, choices: picked.choices, firstMessage });
      if (isStarted) without(sessionId);
      return isStarted;
    } finally {
      starting.current.delete(sessionId);
    }
  };

  return { pendingOf, pick, keep: without, setChoices, send };
}
