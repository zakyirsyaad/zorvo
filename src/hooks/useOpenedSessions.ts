import { useEffect, useRef } from 'react';
import { NO_CHOICES } from '../lib/acp-draft';
import {
  nextSessionHandle,
  openRefusal,
  openedSessionsOf,
  sessionTitleOf,
  type ListedOpened,
} from '../lib/agent-tools';
import { createId } from '../lib/ids';
import type { SessionSpec, StartSessionOptions } from '../lib/session-start';
import { createSessionWorktree } from '../lib/session-worktree';
import type { AgentProfile, Session, SessionWorktree } from '../types';
import type { FirstMessage } from './session-engine/useAcpEngine';
import { useLatest } from './useLatest';

export interface OpenedSessionsDeps {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  isBusy: (sessionId: string) => boolean;
  startSession: (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => void;
}

/** What an agent asked for, already checked: the agent, the brief, and where. */
export interface OpenRequest {
  agentId: string;
  brief: string;
  title?: string;
  hasOwnWorktree: boolean;
  /** Another folder Zorvo knows; absent for the opener's own folder. */
  folderPath?: string;
}

export type OpenResult =
  | { ok: true; sessionId: string; sessionName: string; folder: string; handle: string }
  | {
      ok: false;
      /** What the caller is told; never an error's own text. */
      reason: string;
      /** Zorvo failed, not a rule. */
      isInternal?: true;
      /** The error itself, for the user. It may hold a path, so it never goes to an agent. */
      detail?: string;
    };

const NO_WORKTREE_REASON = 'A worktree could not be made there. Open the session without one, or in a repository.';

/**
 * Opens the independent sessions an agent asks for: an ordinary session that
 * records who opened it, with the brief as its first message. It is no
 * delegate: no handoff, no report, and the user stays where they are. Places
 * are counted in a ref, so the limit holds for calls that arrive in one tick.
 */
export function useOpenedSessions(deps: OpenedSessionsDeps): {
  open: (openerId: string, request: OpenRequest) => Promise<OpenResult>;
  /** The opener's sessions, for `list_agents`. */
  openedOf: (openerId: string) => ListedOpened[];
} {
  const latest = useLatest(deps);
  // Opens that are under way, by a token: the opener, and the new session's id once it is known.
  // A session is in `sessions` only after React commits, so it cannot be counted from there yet.
  const underWay = useRef(new Map<string, { openerId: string; sessionId: string | null; handle: string }>());

  // A session that is listed is counted from `sessions` from now on.
  const { sessions } = deps;
  useEffect(() => {
    for (const [token, entry] of [...underWay.current]) {
      if (entry.sessionId !== null && sessions.some((session) => session.id === entry.sessionId)) {
        underWay.current.delete(token);
      }
    }
  }, [sessions]);

  const open = async (openerId: string, request: OpenRequest): Promise<OpenResult> => {
    const current = latest.current;
    const opener = current.sessions.find((session) => session.id === openerId);
    const agent = current.agents.find((candidate) => candidate.id === request.agentId);
    if (opener === undefined) return { ok: false, reason: 'This session no longer exists.' };
    if (agent === undefined) return { ok: false, reason: 'The agent is not available.' };

    const working = openedSessionsOf(openerId, current.sessions).filter((session) => current.isBusy(session.id));
    const opening = [...underWay.current.values()].filter(
      (entry) => entry.openerId === openerId && !working.some((session) => session.id === entry.sessionId),
    );
    const refusal = openRefusal({ runningOpened: working.length + opening.length });
    if (refusal !== null) return { ok: false, reason: refusal };

    // Held from here, before anything awaits. The handle is taken with the place: sessions
    // opened in one tick are not listed yet, so the ones under way count as taken too.
    const token = createId('open');
    const handle = nextSessionHandle([
      ...current.sessions.flatMap((session) =>
        session.openedBy?.sessionId === openerId && session.openedBy.handle ? [session.openedBy.handle] : [],
      ),
      ...[...underWay.current.values()].filter((entry) => entry.openerId === openerId).map((entry) => entry.handle),
    ]);
    underWay.current.set(token, { openerId, sessionId: null, handle });

    const name = sessionTitleOf(agent.name, request.brief, request.title);
    const folder = request.folderPath ?? opener.cwd;
    let cwd = folder;
    // In its own folder the new session shares the opener's worktree, as a delegate does.
    let worktree: SessionWorktree | null = request.folderPath === undefined ? (opener.worktree ?? null) : null;
    if (request.hasOwnWorktree) {
      const repoPath = request.folderPath ?? opener.worktree?.repoPath ?? opener.cwd;
      try {
        ({ worktree, cwd } = await createSessionWorktree(repoPath, name));
      } catch (error) {
        underWay.current.delete(token);
        return { ok: false, reason: NO_WORKTREE_REASON, isInternal: true, detail: String(error) };
      }
    }

    const id = createId('s');
    underWay.current.set(token, { openerId, sessionId: id, handle });
    try {
      // No hidden context: the brief is all the new session knows.
      latest.current.startSession(
        { id, agent, cwd, worktree, name, openedBy: { sessionId: openerId, at: Date.now(), handle } },
        { text: request.brief },
        { choices: NO_CHOICES, focus: false },
      );
    } catch (error) {
      // No session was recorded, so nothing would ever free this place.
      underWay.current.delete(token);
      return { ok: false, reason: 'The session could not be started.', isInternal: true, detail: String(error) };
    }
    return { ok: true, sessionId: id, sessionName: name, folder: cwd, handle };
  };

  const openedOf = (openerId: string): ListedOpened[] =>
    openedSessionsOf(openerId, deps.sessions).map((session) => ({
      ...(session.openedBy?.handle ? { handle: session.openedBy.handle } : {}),
      agent: deps.agents.find((agent) => agent.id === session.profileId)?.name ?? session.profileId,
      title: session.name,
      state: deps.isBusy(session.id) ? 'working' : 'idle',
      folder: session.cwd,
    }));

  return { open, openedOf };
}
