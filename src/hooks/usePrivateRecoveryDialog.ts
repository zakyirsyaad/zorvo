import { useCallback, useRef, useState } from 'react';

/** A recovery-code dialog asked for from Settings; `code` is a new one that came with a restore. */
export interface RecoveryRequest {
  /** A counter, so a new request is a new dialog without the code ever being a React key. */
  id: number;
  code?: string;
}

export interface PrivateRecoveryDialog {
  request: RecoveryRequest | null;
  show: (code?: string) => void;
  close: () => void;
  /** The Restore dialog is open or a restore is running. */
  setIsRestoring: (isRestoring: boolean) => void;
  /**
   * True while a restore, or the dialog that shows its new code, is on screen: the status can say
   * "prompt for the stored code" then (the restore resets the flags), and a second dialog would
   * stack on the first and read a code nobody asked for.
   */
  suppressStatusPrompt: boolean;
}

/** The app's one recovery-code dialog: who asked for it, and when the status-driven prompt must wait. */
export function usePrivateRecoveryDialog(): PrivateRecoveryDialog {
  const [request, setRequest] = useState<RecoveryRequest | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const nextId = useRef(0);

  const show = useCallback((code?: string) => {
    nextId.current += 1;
    setRequest({ id: nextId.current, code });
  }, []);
  const close = useCallback(() => setRequest(null), []);

  return {
    request,
    show,
    close,
    setIsRestoring,
    suppressStatusPrompt: isRestoring || request?.code !== undefined,
  };
}
