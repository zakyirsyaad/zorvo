import { useState } from "react";
import { NO_CHOICES, withPreferred, type AcpChoices, type AgentOptions } from "../lib/acp-draft";
import type { ForkOptions } from "./useSessionFork";
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

  const sessionOf = (sessionId: string) => sessions.find((session) => session.id === sessionId && !session.archivedAt);
  const pendingOf = (sessionId: string): PendingSwitch | undefined => {
    const picked = pending[sessionId];
    if (!picked || !sessionOf(sessionId)) return undefined;
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
    if (!picked || !agent || !last) return false;
    const firstMessage = message.attachments?.length ? { text: message.text, attachments: message.attachments } : { text: message.text };
    const isStarted = await forkSession(last.id, { agent, choices: picked.choices, firstMessage });
    if (isStarted) without(sessionId);
    return isStarted;
  };

  return { pendingOf, pick, keep: without, setChoices, send };
}
