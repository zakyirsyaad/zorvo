import { useEffect, useId, useRef, useState } from "react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import { Button } from "../ui/Button";
import { PrivateDialog } from "./PrivateDialog";

export interface RestoreDialogProps {
  recover: PrivateCredits["recover"];
  /** The restore worked: `newCode` is the code to save now. */
  onRestored: (newCode: string) => void;
  onClose: () => void;
}

const INPUT =
  "h-8 w-full rounded-lg border border-border-strong bg-bg px-2.5 font-mono text-ui text-fg " +
  "placeholder:text-fg-subtle focus-ring disabled:opacity-40";

/** Restores another Mac's credits onto this one from its recovery code. */
export function RestoreDialog({ recover, onRestored, onClose }: RestoreDialogProps) {
  const [code, setCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const isAlive = useRef(true);
  const trimmed = code.trim();

  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  const restore = async () => {
    if (isBusy || trimmed === "") return;
    setIsBusy(true);
    setError(null);
    const result = await recover(trimmed);
    if (!isAlive.current) return;
    setIsBusy(false);
    if (result.ok) {
      onRestored(result.newCode);
      onClose();
    } else {
      setError(result.text);
    }
  };

  return (
    <PrivateDialog
      title="Restore your credits"
      initialFocusRef={inputRef}
      // Closing mid-restore would hide its outcome.
      onEscape={isBusy ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" tone="secondary" disabled={isBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={trimmed === "" || isBusy} onClick={() => void restore()}>
            Restore
          </Button>
        </>
      }
    >
      <p className="text-ui text-fg-muted">
        The Mac that had these credits stops using them, and you get a new recovery code here. Your own NEAR AI key
        isn't moved; add it again on this Mac if you use one.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-ui-sm font-medium text-fg-secondary">
          Recovery code
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className={INPUT}
          placeholder="ZRV-…"
          value={code}
          disabled={isBusy}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void restore();
          }}
        />
      </div>
      <p role="status" className={`min-h-4 text-ui-sm ${error ? "text-danger" : "text-fg-muted"}`}>
        {error ?? (isBusy ? "Restoring…" : "")}
      </p>
    </PrivateDialog>
  );
}
