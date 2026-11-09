import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  parsePrivateTopupRequest,
  PRIVATE_TOPUP_REQUEST_EVENT,
  type PrivateTopupRequest,
} from '../lib/private-topup-request';

export interface PrivateTopupRequests {
  /** The pending request of each session, by app session id. */
  requests: Readonly<Record<string, PrivateTopupRequest>>;
  /** Records the user's answer; true when the backend took it. The card clears either way. */
  answer: (sessionId: string, requestId: string, approve: boolean) => Promise<boolean>;
  /** Drops a request locally, for a session that was deleted or went away. */
  dismiss: (sessionId: string) => void;
}

/**
 * Listens for private agents' top-up asks. Only the main window receives the event; a popout gets
 * the same request in its session snapshot and sends the answer back through the popout bridge.
 */
export function usePrivateTopupRequests(): PrivateTopupRequests {
  const [requests, setRequests] = useState<Record<string, PrivateTopupRequest>>({});

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen<unknown>(PRIVATE_TOPUP_REQUEST_EVENT, ({ payload }) => {
      const request = parsePrivateTopupRequest(payload);
      if (request === null) return;
      setRequests((prev) => ({ ...prev, [request.sessionId]: request }));
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const dismiss = useCallback((sessionId: string) => {
    setRequests((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const answer = useCallback(
    async (sessionId: string, requestId: string, approve: boolean): Promise<boolean> => {
      try {
        await invoke('private_answer_topup_request', { sessionId, requestId, approve });
        return true;
      } catch {
        return false;
      } finally {
        // A stale request is gone either way; the card must not stay stuck on screen.
        setRequests((prev) => {
          if (prev[sessionId]?.requestId !== requestId) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      }
    },
    [],
  );

  return { requests, answer, dismiss };
}