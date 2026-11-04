import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import { errorMessage } from '../lib/files';
import { deleteTranscript, loadTranscript, saveTranscript } from '../lib/persistence';
import { useLatest } from './useLatest';

type Transcripts = Record<string, ChatMessage[]>;

/**
 * A streaming agent changes its transcript many times a second; the whole
 * transcript is written at most this often, and still during a long stream.
 */
const TRANSCRIPT_SAVE_INTERVAL_MS = 1000;
/**
 * Every write is the whole file, so a long session waits longer between writes: about this
 * many bytes a second while it streams. A 7 MB session written every second came to 2 GB in
 * 20 minutes.
 */
const TRANSCRIPT_WRITE_BYTES_PER_SECOND = 128 * 1024;
/** The longest wait, so a crash loses at most this much of a long session's stream. */
const TRANSCRIPT_MAX_SAVE_INTERVAL_MS = 10_000;
/**
 * How soon `saveSoon` writes: a turn that ended or a question to the user is kept at once, whatever
 * the size. Not zero: the write reads the transcript after React has applied the change.
 */
const TRANSCRIPT_SOON_SAVE_MS = 100;

/** How long to wait before the next write of a transcript whose last write was `bytes` long. */
export function transcriptSaveInterval(bytes: number | undefined): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return TRANSCRIPT_SAVE_INTERVAL_MS;
  const paced = Math.ceil((bytes / TRANSCRIPT_WRITE_BYTES_PER_SECOND) * 1000);
  return Math.min(TRANSCRIPT_MAX_SAVE_INTERVAL_MS, Math.max(TRANSCRIPT_SAVE_INTERVAL_MS, paced));
}

export interface TranscriptsHandle {
  transcripts: Transcripts;
  ensureLoaded: (sessionId: string) => void;
  updateMessages: (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  /** Brings a session's waiting write forward to a moment from now; nothing when nothing is waiting. */
  saveSoon: (sessionId: string) => void;
  removeTranscript: (sessionId: string) => void;
  /** Whether each session's saved history has been read; absent while it loads. */
  transcriptStatus: Readonly<Record<string, 'ready' | 'failed'>>;
  /** Writes every transcript still waiting for its timer, and resolves once those writes are done. */
  flush: () => Promise<void>;
}

function omitKey(record: Transcripts, key: string): Transcripts {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/**
 * Chat messages per session: loaded lazily from disk the first time a session
 * is shown, and saved per session at most once per interval while it changes,
 * an interval that grows with the transcript's size.
 */
export function useTranscripts(onError: (message: string) => void): TranscriptsHandle {
  const [transcripts, setTranscripts] = useState<Transcripts>({});
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptsHandle['transcriptStatus']>({});
  const transcriptsRef = useLatest(transcripts);
  const onErrorRef = useLatest(onError);
  const requestedRef = useRef(new Set<string>());
  // Sessions whose file is being read: saving now would overwrite their history.
  const loadingRef = useRef(new Set<string>());
  // Sessions whose file could not be read: it may still be recoverable, so
  // this run never writes over it.
  const unreadableRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // When each waiting timer fires (Date.now() time), so saveSoon never pushes a nearer one back.
  const dueRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  // Writes in progress, so a flush can wait for the ones a timer started a moment ago.
  const writesRef = useRef(new Set<Promise<void>>());
  // Sessions whose latest write failed: their timer is gone, so a flush writes them again.
  const unwrittenRef = useRef(new Set<string>());
  // How many writes each session has started, so that only the latest one decides whether the
  // session counts as unwritten (an older write that ends late must not clear a newer failure).
  const writeCountRef = useRef(new Map<string, number>());
  // The size of each session's last write, in bytes, which spaces out its next one.
  const writtenSizeRef = useRef(new Map<string, number>());

  /** Writes the transcript now (never an unreadable one) and rejects when the write fails. */
  const write = useCallback(
    (sessionId: string): Promise<void> => {
      if (unreadableRef.current.has(sessionId)) return Promise.resolve();
      const count = (writeCountRef.current.get(sessionId) ?? 0) + 1;
      writeCountRef.current.set(sessionId, count);
      const writing = saveTranscript(sessionId, transcriptsRef.current[sessionId] ?? []).then((bytes) => {
        if (typeof bytes === 'number') writtenSizeRef.current.set(sessionId, bytes);
      });
      writesRef.current.add(writing);
      const settle = (written: boolean) => {
        writesRef.current.delete(writing);
        if (writeCountRef.current.get(sessionId) !== count) return;
        if (written) unwrittenRef.current.delete(sessionId);
        else unwrittenRef.current.add(sessionId);
      };
      writing.then(() => settle(true), () => settle(false));
      return writing;
    },
    [transcriptsRef],
  );

  /** Writes the transcript now, unless its file is still loading (retry later). A failure is reported. */
  const save = useCallback(
    (sessionId: string) => {
      if (loadingRef.current.has(sessionId)) {
        scheduleSaveRef.current(sessionId);
        return;
      }
      write(sessionId).catch((error) => {
        onErrorRef.current(`Failed to save the conversation: ${String(error)}`);
      });
    },
    // scheduleSaveRef is a ref declared below (save and scheduleSave call each other): stable, and not readable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write, onErrorRef],
  );

  /**
   * A throttle, not a debounce: a save already due writes the latest messages, so it is not pushed
   * back. The wait grows with the size of the last write (`transcriptSaveInterval`).
   */
  const arm = useCallback(
    (sessionId: string, delay: number) => {
      const timers = timersRef.current;
      dueRef.current.set(sessionId, Date.now() + delay);
      timers.set(
        sessionId,
        setTimeout(() => {
          timers.delete(sessionId);
          dueRef.current.delete(sessionId);
          save(sessionId);
        }, delay),
      );
    },
    [save],
  );

  const scheduleSave = useCallback(
    (sessionId: string) => {
      if (timersRef.current.has(sessionId)) return;
      arm(sessionId, transcriptSaveInterval(writtenSizeRef.current.get(sessionId)));
    },
    [arm],
  );
  const scheduleSaveRef = useLatest(scheduleSave);

  const saveSoon = useCallback(
    (sessionId: string) => {
      const timers = timersRef.current;
      if (!timers.has(sessionId)) return;
      const due = dueRef.current.get(sessionId) ?? Infinity;
      if (due - Date.now() <= TRANSCRIPT_SOON_SAVE_MS) return;
      clearTimeout(timers.get(sessionId));
      timers.delete(sessionId);
      arm(sessionId, TRANSCRIPT_SOON_SAVE_MS);
    },
    [arm],
  );

  /**
   * Writes what is still waiting for its timer, and what an earlier write failed to write,
   * now, and resolves once every write is done, also the ones a timer started a moment ago.
   * It rejects when a write failed (the session stays marked, so the next flush tries it
   * again), or when a transcript is still being read: its history is not in yet, so it is not
   * written over it and its normal save, which waits for the read, stays in charge.
   */
  const flush = useCallback(async (): Promise<void> => {
    const timers = timersRef.current;
    const waiting = [...new Set([...timers.keys(), ...unwrittenRef.current])];
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    dueRef.current.clear();
    const loading = waiting.filter((sessionId) => loadingRef.current.has(sessionId));
    loading.forEach((sessionId) => scheduleSaveRef.current(sessionId));
    waiting
      .filter((sessionId) => !loading.includes(sessionId))
      .forEach((sessionId) => void write(sessionId).catch(() => undefined));
    const results = await Promise.allSettled([...writesRef.current]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw new Error(String(failed.reason));
    if (loading.length > 0) {
      throw new Error('a conversation is still loading, so what it just received is not saved yet');
    }
  }, [write, scheduleSaveRef]);

  // Write what is still pending when the window goes away. A restart from the backend does not
  // close the window, so it calls `flush` itself and learns whether it worked.
  useEffect(() => {
    const onPageHide = () => {
      flush().catch((error) => {
        onErrorRef.current(`Failed to save the conversation: ${errorMessage(error)}`);
      });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flush, onErrorRef]);

  const ensureLoaded = useCallback(
    (sessionId: string) => {
      if (requestedRef.current.has(sessionId)) return;
      requestedRef.current.add(sessionId);
      loadingRef.current.add(sessionId);
      loadTranscript(sessionId)
        .then((loaded) =>
          // Messages that arrived while loading come after the saved history.
          setTranscripts((prev) => {
            const live = prev[sessionId] ?? [];
            const savedIds = new Set(loaded.map((m) => m.id));
            return { ...prev, [sessionId]: [...loaded, ...live.filter((m) => !savedIds.has(m.id))] };
          }),
        )
        .then(() => setTranscriptStatus((prev) => ({ ...prev, [sessionId]: 'ready' })))
        .catch((error) => {
          unreadableRef.current.add(sessionId);
          setTranscriptStatus((prev) => ({ ...prev, [sessionId]: 'failed' }));
          onErrorRef.current(
            `Failed to load the conversation; new messages will not be saved over it: ${String(error)}`,
          );
        })
        .finally(() => loadingRef.current.delete(sessionId));
    },
    [onErrorRef],
  );

  const updateMessages = useCallback(
    (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setTranscripts((prev) => ({ ...prev, [sessionId]: updater(prev[sessionId] ?? []) }));
      scheduleSave(sessionId);
    },
    [scheduleSave],
  );

  const removeTranscript = useCallback(
    (sessionId: string) => {
      clearTimeout(timersRef.current.get(sessionId));
      timersRef.current.delete(sessionId);
      dueRef.current.delete(sessionId);
      unwrittenRef.current.delete(sessionId);
      writeCountRef.current.delete(sessionId);
      writtenSizeRef.current.delete(sessionId);
      requestedRef.current.delete(sessionId);
      setTranscripts((prev) => omitKey(prev, sessionId));
      deleteTranscript(sessionId).catch((error) => {
        onErrorRef.current(`Failed to delete the conversation: ${String(error)}`);
      });
    },
    [onErrorRef],
  );

  return { transcripts, transcriptStatus, ensureLoaded, updateMessages, saveSoon, removeTranscript, flush };
}
