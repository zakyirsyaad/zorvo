import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseComputerUseStatus, type ComputerUseStatus, type PermissionPane } from "../lib/computer-use";

export interface ComputerUseSetting {
  /** null until the first read answers, and when the backend's answer cannot be read. */
  status: ComputerUseStatus | null;
  isChecking: boolean;
  check: () => void;
  /** Asks macOS for both permissions. Only the user's click calls it. */
  requestPermissions: () => void;
  openPane: (pane: PermissionPane) => void;
  /** After an update: forgets macOS's stale record and asks again. */
  allowAgain: () => void;
}

const ERROR = "Zorvo could not read the computer use permissions.";

/**
 * The state of Settings' Computer use group. It reads once when the group shows and again when
 * the window gets focus back, since the user allows the permissions in System Settings.
 */
export function useComputerUseSetting(onError: (message: string) => void): ComputerUseSetting {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isMounted = useRef(true);
  const running = useRef(0);

  const run = useCallback(
    (ask: () => Promise<unknown>) => {
      const turn = ++running.current;
      setIsChecking(true);
      ask()
        .then((answer) => {
          if (isMounted.current && turn === running.current) setStatus(parseComputerUseStatus(answer));
        })
        .catch(() => {
          if (isMounted.current && turn === running.current) onError(ERROR);
        })
        .finally(() => {
          if (isMounted.current && turn === running.current) setIsChecking(false);
        });
    },
    [onError],
  );

  const check = useCallback(() => run(() => invoke("computer_use_status")), [run]);

  useEffect(() => {
    isMounted.current = true;
    check();
    window.addEventListener("focus", check);
    return () => {
      isMounted.current = false;
      window.removeEventListener("focus", check);
    };
  }, [check]);

  const openPane = useCallback(
    (pane: PermissionPane) => {
      invoke("computer_use_open_pane", { pane })
        .then(check)
        .catch(() => onError("System Settings did not open."));
    },
    [check, onError],
  );

  return {
    status,
    isChecking,
    check,
    requestPermissions: useCallback(() => run(() => invoke("computer_use_request_permissions")), [run]),
    openPane,
    allowAgain: useCallback(() => run(() => invoke("computer_use_reset_permissions")), [run]),
  };
}
