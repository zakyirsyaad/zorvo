import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Undo2 } from "lucide-react";
import type { RewindOptions } from "../../hooks/useSessionRewind";
import { REVEAL_ON_ROW } from "../../lib/sidebar-status";

export interface UserMessageBarProps {
  copied: boolean;
  onCopy: () => void;
  /** Takes the conversation back to before this message; offered only when the host can. */
  onRewind?: (options?: RewindOptions) => void;
  /** True when a pre-turn git checkpoint exists on this message, offering "Rewind + files?". */
  canRestoreFiles?: boolean;
}

const ICON_BUTTON =
  "rounded p-0.5 text-fg-subtle hover:text-fg-secondary focus-ring";

const CONFIRM_BUTTON =
  "rounded bg-danger-surface px-1.5 py-0.5 text-micro font-medium text-danger focus-ring";

/** How long Rewind waits for its confirming second click. */
const CONFIRM_REWIND_MS = 4000;

/**
 * Rewinding drops every message after this one for good, so it takes two
 * clicks: the icon turns into "Rewind?" (and "Rewind + files?" when a checkpoint exists);
 * it turns back by itself. Keeps the first button mounted across idle <-> confirming so
 * keyboard focus never drops off the row.
 */
function RewindButton({ onRewind, canRestoreFiles = false }: { onRewind: (options?: RewindOptions) => void; canRestoreFiles?: boolean }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const groupRef = useRef<HTMLSpanElement>(null);
  const mainButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      if (groupRef.current?.contains(document.activeElement) && document.activeElement !== mainButtonRef.current) {
        mainButtonRef.current?.focus();
      }
      setIsConfirming(false);
    }, CONFIRM_REWIND_MS);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const onConfirmKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setIsConfirming(false);
    mainButtonRef.current?.focus();
  };

  return (
    <span ref={groupRef} className="inline-flex items-center gap-1">
      <button
        ref={mainButtonRef}
        type="button"
        onClick={() => {
          if (!isConfirming) {
            setIsConfirming(true);
            return;
          }
          setIsConfirming(false);
          onRewind();
        }}
        onKeyDown={isConfirming ? onConfirmKeyDown : undefined}
        aria-label={isConfirming ? "Confirm rewind" : "Rewind to here"}
        title={isConfirming ? "Remove this message and everything after it, and put it back in the composer" : "Rewind to here"}
        className={isConfirming ? CONFIRM_BUTTON : ICON_BUTTON}
      >
        {isConfirming ? "Rewind?" : <Undo2 className="h-3.5 w-3.5" />}
      </button>
      {isConfirming && canRestoreFiles && (
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
            onRewind({ restoreFiles: true });
          }}
          onKeyDown={onConfirmKeyDown}
          aria-label="Confirm rewind and restore files"
          title="Remove this message and everything after it, and put back the files the agent changed since"
          className={CONFIRM_BUTTON}
        >
          Rewind + files?
        </button>
      )}
    </span>
  );
}

/**
 * Copy and Rewind under one of your messages, shown when you point at the message or tab
 * into it. The time is the bubble's tooltip, since the canvas draws none under it.
 */
export function UserMessageBar({ copied, onCopy, onRewind, canRestoreFiles }: UserMessageBarProps) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2 px-1 text-caption text-fg-muted">
      <span data-message-actions="" className={`flex items-center gap-1 ${REVEAL_ON_ROW}`}>
        <button type="button" onClick={onCopy} aria-label="Copy message" title="Copy" className={ICON_BUTTON}>
          {copied ? <Check className="h-3.5 w-3.5 text-status-running" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {onRewind && <RewindButton onRewind={onRewind} canRestoreFiles={canRestoreFiles} />}
      </span>
    </div>
  );
}
