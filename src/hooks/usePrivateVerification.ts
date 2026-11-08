import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { foldVerifications, type VerificationRecord } from '../lib/private-verification';
import type { ChatMessage } from '../types';

export interface PrivateVerificationDeps {
  updateMessages: (sessionId: string, change: (prev: ChatMessage[]) => ChatMessage[]) => void;
  /** Writes the transcript after the badge lands; a failed check leaves the next turn to retry. */
  saveSoon?: (sessionId: string) => void;
  /** A session deleted while a check was in flight no longer takes its result. */
  isKnownSession?: (sessionId: string) => boolean;
}

/** Asks for the session's private call states and puts them on the replies they belong to. */
export function usePrivateVerification({ updateMessages, saveSoon, isKnownSession }: PrivateVerificationDeps) {
  const verifyTurn = useCallback(
    (sessionId: string) => {
      void invoke<VerificationRecord[]>('private_verify', { sessionId })
        .then((records) => {
          if (records.length === 0 || isKnownSession?.(sessionId) === false) return;
          updateMessages(sessionId, (prev) => foldVerifications(prev, records));
          saveSoon?.(sessionId);
        })
        .catch(() => {
          // No key, or the app is closing: the next turn end tries again.
        });
    },
    [updateMessages, saveSoon, isKnownSession],
  );

  return { verifyTurn };
}