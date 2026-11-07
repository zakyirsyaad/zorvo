import { useEffect, useId, useRef, useState } from "react";
import { privateErrorText } from "../../lib/private-credits";
import { errorCodeOf } from "../../lib/private-flow";
import { Button } from "../ui/Button";
import { SettingsGroup, SettingsRow } from "../settings/SettingsGroup";

export interface RecoveryCardProps {
  revealCode: () => Promise<string>;
  /** False until this Mac has a device whose code can be read. */
  isAvailable: boolean;
  /** Why Restore is off right now (a top-up holds credits); absent when it may run. */
  restoreBlockedReason?: string;
  onRestore: () => void;
}

/** The masked code is always the same: the secret is not read until the user asks for it. */
const MASKED_CODE = "ZRV-••••-••••-••••-••••";
const SHOWN_MS = 30_000;
const COPIED_MS = 2_000;

/**
 * Settings → Private mode → Recovery code. The code is read on Show or Copy only, and kept in
 * state only while shown (hidden again by a second press, after 30 seconds, or on unmount). Copy
 * puts it on the clipboard without ever holding it in state.
 */
export function RecoveryCard({ revealCode, isAvailable, restoreBlockedReason, onRestore }: RecoveryCardProps) {
  const reasonId = useId();
  const [shown, setShown] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every press and by unmount: an answer that comes back late is dropped.
  const press = useRef(0);

  useEffect(
    () => () => {
      press.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (shown === null) return;
    const timer = setTimeout(() => setShown(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const toggle = async () => {
    const mine = ++press.current;
    setError(null);
    if (shown !== null) {
      setShown(null);
      return;
    }
    try {
      const code = await revealCode();
      if (mine === press.current) setShown(code);
    } catch (reason) {
      if (mine === press.current) setError(privateErrorText(errorCodeOf(reason)));
    }
  };

  const copy = async () => {
    const mine = ++press.current;
    setError(null);
    try {
      const code = await revealCode();
      await navigator.clipboard.writeText(code);
      if (mine === press.current) setIsCopied(true);
    } catch (reason) {
      if (mine === press.current) {
        setError(reason instanceof DOMException ? "Couldn't copy the code." : privateErrorText(errorCodeOf(reason)));
      }
    }
  };

  return (
    <SettingsGroup heading="Recovery code">
      <SettingsRow
        label={<span className="select-text font-mono">{shown ?? MASKED_CODE}</span>}
        description={
          <>
            Moves your credits to another Mac. Anyone with this code can use your credits, so keep it somewhere safe.
            {!isAvailable && " It is available after your first top-up."}
            {error && (
              <span role="alert" className="mt-1 block text-danger">
                {error}
              </span>
            )}
          </>
        }
        control={
          <>
            <Button disabled={!isAvailable} onClick={() => void toggle()}>
              {shown === null ? "Show" : "Hide"}
            </Button>
            <Button disabled={!isAvailable} onClick={() => void copy()}>
              {isCopied ? "Copied" : "Copy"}
            </Button>
          </>
        }
      />
      <SettingsRow
        label="Restore on this Mac"
        description="Enter a code from another Mac. That Mac stops using these credits, and you get a new code."
        control={
          <>
            {restoreBlockedReason && (
              <span id={reasonId} className="sr-only">
                {restoreBlockedReason}
              </span>
            )}
            <Button
              disabled={restoreBlockedReason !== undefined}
              title={restoreBlockedReason}
              aria-describedby={restoreBlockedReason ? reasonId : undefined}
              onClick={onRestore}
            >
              Restore…
            </Button>
          </>
        }
      />
    </SettingsGroup>
  );
}
