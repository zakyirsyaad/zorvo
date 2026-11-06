import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { errorMessage } from '../lib/files';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RETRY_AFTER_FAILURE_MS,
  type AppUpdateInfo,
  type AppUpdateProgress,
} from '../lib/app-update';

export interface AppUpdate {
  /** A newer Zorvo the user has not hidden for this run; null when none. */
  update: AppUpdateInfo | null;
  /** The newer Zorvo found, even when Later hid its notice (Settings still offers it). */
  available: AppUpdateInfo | null;
  /** A check made with `checkNow` is running. */
  isChecking: boolean;
  /** When the backend last answered a check (epoch ms), or null before the first answer. */
  checkedAt: number | null;
  /** The last check made with `checkNow` could not be made; automatic ones stay silent. */
  checkFailed: boolean;
  /** Checks now (Settings' Check now). Does nothing while a check or an install runs. */
  checkNow: () => Promise<void>;
  isInstalling: boolean;
  progress: AppUpdateProgress | null;
  /** Downloads the update, installs it, writes what the page holds and restarts Zorvo. A failure goes to `onError`. */
  install: () => Promise<void>;
  /** Hides the notice for this version until Zorvo is started again. */
  dismiss: () => void;
}

/**
 * Checks for a newer Zorvo shortly after startup and then about once a day, sooner after a check
 * that could not be made. Only the main window mounts it (popouts render `PopoutApp`). A failed
 * check stays silent: being offline is normal. Installing is the user's click; its failure is
 * reported.
 *
 * The backend restarts Zorvo without closing the page, so `pagehide` never fires: `beforeRestart`
 * writes whatever the page still holds (debounced state and transcripts) between the install and
 * the restart. If it fails, Zorvo stays open with the update already in place.
 */
export function useAppUpdate(
  onError: (message: string) => void,
  beforeRestart: () => Promise<void>,
): AppUpdate {
  const [found, setFound] = useState<AppUpdateInfo | null>(null);
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const isInstallingRef = useRef(false);
  const isCheckingRef = useRef(false);
  const isMountedRef = useRef(true);

  /** True when the backend answered (also "no update"), false when the question could not be asked. */
  const check = useCallback(async (): Promise<boolean> => {
    if (isInstallingRef.current) return true;
    try {
      const info = await invoke<AppUpdateInfo | null>('app_update_check');
      // An install that started meanwhile owns the banner: an answer arriving now could remove it.
      if (isMountedRef.current && !isInstallingRef.current) {
        setFound(info ?? null);
        setCheckedAt(Date.now());
        // Any answer, a scheduled one too, ends an earlier "could not check".
        setCheckFailed(false);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let timer: number | undefined;
    const checkAndSchedule = async () => {
      const answered = await check();
      if (!isMounted) return;
      timer = window.setTimeout(
        () => void checkAndSchedule(),
        answered ? CHECK_INTERVAL_MS : RETRY_AFTER_FAILURE_MS,
      );
    };
    timer = window.setTimeout(() => void checkAndSchedule(), FIRST_CHECK_DELAY_MS);
    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [check]);

  const checkNow = useCallback(async () => {
    if (isCheckingRef.current || isInstallingRef.current) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    try {
      const answered = await check();
      if (isMountedRef.current) setCheckFailed(!answered);
    } finally {
      isCheckingRef.current = false;
      if (isMountedRef.current) setIsChecking(false);
    }
  }, [check]);

  useEffect(() => {
    let isMounted = true;
    const unlisten = listen<AppUpdateProgress>('app-update-progress', (event) => {
      if (isMounted) setProgress(event.payload);
    }).catch(() => null);
    return () => {
      isMounted = false;
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  const install = useCallback(async () => {
    if (isInstallingRef.current) return;
    isInstallingRef.current = true;
    setIsInstalling(true);
    setProgress(null);
    try {
      await invoke('app_update_install');
      await beforeRestart().catch((error: unknown) => {
        throw new Error(
          `Zorvo did not restart because your sessions could not be saved first (${errorMessage(error)}). ` +
            'The update is installed and starts the next time you open Zorvo.',
        );
      });
      // On success the backend restarts Zorvo and this call never returns.
      await invoke('app_update_restart');
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      isInstallingRef.current = false;
      setIsInstalling(false);
      setProgress(null);
    }
  }, [onError, beforeRestart]);

  const dismiss = useCallback(() => setHiddenVersion(found?.version ?? null), [found]);

  const update = found && found.version !== hiddenVersion ? found : null;
  return { update, available: found, isChecking, checkedAt, checkFailed, checkNow, isInstalling, progress, install, dismiss };
}
