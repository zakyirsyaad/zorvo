import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  type AppUpdateInfo,
  type AppUpdateProgress,
} from '../lib/app-update';

export interface AppUpdate {
  /** A newer Zorvo the user has not hidden for this run; null when none. */
  update: AppUpdateInfo | null;
  isInstalling: boolean;
  progress: AppUpdateProgress | null;
  /** Downloads the update, installs it and restarts Zorvo. A failure goes to `onError`. */
  install: () => Promise<void>;
  /** Hides the notice for this version until Zorvo is started again. */
  dismiss: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Checks for a newer Zorvo shortly after startup and then about once a day. Only the main window
 * mounts it (popouts render `PopoutApp`). A failed check stays silent: being offline is normal and
 * the next check tries again. Installing is the user's click; its failure is reported.
 */
export function useAppUpdate(onError: (message: string) => void): AppUpdate {
  const [found, setFound] = useState<AppUpdateInfo | null>(null);
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const isInstallingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const check = async () => {
      if (isInstallingRef.current) return;
      try {
        const info = await invoke<AppUpdateInfo | null>('app_update_check');
        if (isMounted) setFound(info ?? null);
      } catch {
        // Offline or the releases repository is unreachable: try again at the next check.
      }
    };
    const first = window.setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
    const daily = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearTimeout(first);
      window.clearInterval(daily);
    };
  }, []);

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
      // On success the backend restarts Zorvo and this call never returns.
      await invoke('app_update_install');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      isInstallingRef.current = false;
      setIsInstalling(false);
      setProgress(null);
    }
  }, [onError]);

  const dismiss = useCallback(() => setHiddenVersion(found?.version ?? null), [found]);

  const update = found && found.version !== hiddenVersion ? found : null;
  return { update, isInstalling, progress, install, dismiss };
}
