import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { TerminalSignInState } from "../hooks/useTerminalSignIn";
import type { PtyOutputStore } from "../lib/pty-output-store";
import { AgentLogo } from "./AgentLogo";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

export interface TerminalSignInDialogProps {
  state: TerminalSignInState;
  /** The agent whose logo leads the heading; else the one the login runs for, if any. */
  profileId?: string;
  output: PtyOutputStore;
  onClose: () => void;
  /** Absent when the method cannot be run again: a failed sign-in then offers Close only. */
  onTryAgain?: () => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

/**
 * What the user does while the terminal runs: most logins ask with a menu. Zorvo checks once the login's
 * program ends; Close cancels it, so the line must not promise a check on Close.
 */
const RUNNING_LINE = "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when the login finishes.";

function statusText({ phase, agentName, error, note }: TerminalSignInState): string {
  switch (phase) {
    case "starting":
      return `Starting ${agentName}…`;
    case "running":
      return note ?? RUNNING_LINE;
    case "checking":
      return "Checking your sign-in…";
    case "failed":
      return error ?? "";
  }
}

/** An agent's terminal login, shown over the app until it finishes or is cancelled. */
export function TerminalSignInDialog({
  state,
  profileId = state.profileId,
  output,
  onClose,
  onTryAgain,
  onInput,
  onResize,
}: TerminalSignInDialogProps) {
  const titleId = useId();
  const isFailed = state.phase === "failed";
  const dialogRef = useRef<HTMLDivElement>(null);
  // The button that takes focus: Try again after a failure, else Close.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const canTryAgain = onTryAgain !== undefined;
  useFocusTrap(dialogRef);

  // While the login runs, its terminal has focus.
  useEffect(() => {
    if (state.phase !== "running") primaryRef.current?.focus();
  }, [state.phase, canTryAgain]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-[760px] flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5 text-fg-secondary shadow-dialog"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {profileId && <AgentLogo profileId={profileId} name="" size={24} />}
            <div className="min-w-0">
              <h2 id={titleId} className="text-ui font-semibold text-fg">
                Sign in to {state.agentName}
              </h2>
              <p className="truncate text-caption text-fg-subtle">{state.methodName}</p>
            </div>
          </div>
          <IconButton label="Cancel sign-in" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        </header>

        <p role="status" className={`text-ui-sm ${isFailed ? "text-danger" : "text-fg-muted"}`}>
          {statusText(state)}
        </p>

        <div className="flex h-[380px] overflow-hidden rounded-lg border border-border bg-terminal-bg">
          <TerminalView
            sessionId={state.terminalId}
            output={output}
            isLive={state.phase === "running"}
            onInput={onInput}
            onResize={onResize}
          />
        </div>

        <footer className="flex justify-end gap-2">
          <Button ref={isFailed && canTryAgain ? undefined : primaryRef} onClick={onClose}>
            Close
          </Button>
          {isFailed && canTryAgain && (
            <Button ref={primaryRef} variant="primary" onClick={onTryAgain}>
              Try again
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
