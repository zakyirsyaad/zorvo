import { useEffect, useId, useRef, useState } from "react";
import { privateErrorText } from "../../lib/private-credits";
import { errorCodeOf } from "../../lib/private-flow";
import type { ActionResult } from "../../hooks/usePrivateCredits";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface RecoveryCodeDialogProps {
  revealCode: () => Promise<string>;
  markRecovery: (saved: boolean) => Promise<ActionResult>;
  /** A code the caller already has (a restore's new one): the stored code is not read. */
  initialCode?: string;
  onClose: () => void;
}

const COPIED_MS = 2_000;

/**
 * Asks the user to save the recovery code. The code is held in this component's state only while
 * the dialog is open, and never written anywhere else.
 */
export function RecoveryCodeDialog({ revealCode, markRecovery, initialCode, onClose }: RecoveryCodeDialogProps) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const checkboxId = useId();
  const copyRef = useRef<HTMLButtonElement>(null);
  const isAlive = useRef(true);

  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialCode !== undefined) return;
    let isStale = false;
    revealCode()
      .then((next) => {
        if (!isStale) setCode(next);
      })
      .catch((reason: unknown) => {
        if (!isStale) setLoadError(privateErrorText(errorCodeOf(reason)));
      });
    return () => {
      isStale = true;
    };
  }, [initialCode, revealCode]);

  // The dialog holds focus while the code loads (Copy is off then); once Copy works it is where the user goes
  // next, unless they have already moved on.
  useEffect(() => {
    const copyButton = copyRef.current;
    if (code === null || !copyButton) return;
    const dialog = copyButton.closest('[role="dialog"]');
    if (document.activeElement === dialog) copyButton.focus();
  }, [code]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const copy = () => {
    if (code === null) return;
    navigator.clipboard
      ?.writeText(code)
      .then(() => setIsCopied(true))
      .catch(() => setIsCopied(false));
  };

  const finish = async (saved: boolean) => {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    const result = await markRecovery(saved);
    if (!isAlive.current) return;
    setIsBusy(false);
    if (result.ok) onClose();
    else setError(result.text);
  };

  return (
    <PrivateDialog
      title="Save your recovery code"
      initialFocusRef={copyRef}
      // Escape is Remind me later for the stored code. A restore's new code is shown here for the first
      // time, so a stray key must not count as an answer: only a button does.
      onEscape={initialCode === undefined ? () => void finish(false) : undefined}
      footer={
        <>
          <Button variant="ghost" tone="secondary" disabled={isBusy} onClick={() => void finish(false)}>
            Remind me later
          </Button>
          <Button variant="primary" disabled={!isSaved || isBusy} onClick={() => void finish(true)}>
            Done
          </Button>
        </>
      }
    >
      <p className="text-ui text-fg-muted">
        It's the only way to move your credits to another Mac, or to get them back if this Mac is lost. Zorvo can't
        recover it for you.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-ground px-3 py-2">
        <span className="min-w-0 flex-1 select-text break-all font-mono text-ui text-fg">
          {code ?? (loadError ? "" : "Loading…")}
        </span>
        <Button ref={copyRef} disabled={code === null} onClick={copy}>
          {isCopied ? "Copied" : "Copy"}
        </Button>
      </div>
      {loadError && (
        <p role="alert" className="text-ui-sm text-danger">
          {loadError}
        </p>
      )}
      <p className="text-ui-sm text-fg-subtle">
        Anyone with this code can use your credits. Keep it in a password manager, not in a chat.
      </p>
      <label htmlFor={checkboxId} className="flex items-center gap-2 text-ui text-fg-secondary">
        <input
          id={checkboxId}
          type="checkbox"
          className="focus-ring size-3.5"
          checked={isSaved}
          disabled={code === null}
          onChange={(event) => setIsSaved(event.target.checked)}
        />
        I saved it somewhere safe
      </label>
      {error && (
        <p role="alert" className="text-ui-sm text-danger">
          {error}
        </p>
      )}
    </PrivateDialog>
  );
}
