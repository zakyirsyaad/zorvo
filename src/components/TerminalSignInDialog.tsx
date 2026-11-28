import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { TerminalSignInState } from "../hooks/useTerminalSignIn";
import type { PtyOutputStore } from "../lib/pty-output-store";
import { AgentTile } from "./ui/AgentTile";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

export interface TerminalSignInDialogProps {
  state: TerminalSignInState;
  /** The agent whose logo leads the heading; else the one the login runs for, if any. */
  profileId?: string;
  output: PtyOutputStore;
  /** Cancel, the X and Escape: ends the login and sends nothing. */
  onClose: () => void;
  /**
   * The user says the login is finished while it still runs (a setup that never exits on its own, a browser
   * sign-in the terminal waits on): Zorvo checks. Absent for a login that ends by itself (GitHub's).
   */
  onDone?: () => void;
  /** Absent when the method cannot be run again: a failed sign-in then offers Close only. */
  onTryAgain?: () => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

/** What the user does while the terminal runs, for a login that ends by itself: Zorvo checks when it does. */
const RUNNING_LINE = "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this.";
/** The same for a login the user ends with the done button (`onDone`). */
const SETUP_DONE_LINE = "Pick with ↑ ↓ and Return in the terminal. Press I'm done when the setup is finished.";
const SIGN_IN_DONE_LINE = "Finish in the terminal or the browser it opens. Press I've signed in when you are done.";

/** The done button's words: a setup is finished, a sign-in is signed in. */
export function doneLabel(isSetup: boolean | undefined): string {
  return isSetup ? "I'm done" : "I've signed in";
}

function runningLine(isSetup: boolean | undefined, hasDone: boolean): string {
  if (!hasDone) return RUNNING_LINE;
  return isSetup ? SETUP_DONE_LINE : SIGN_IN_DONE_LINE;
}

function statusText({ phase, agentName, error, note, isSetup }: TerminalSignInState, hasDone: boolean): string {
  switch (phase) {
    case "starting":
      return `Starting ${agentName}…`;
    case "running":
      return note ?? runningLine(isSetup, hasDone);
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
  onDone,
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
  // While the login runs, Cancel and the done button replace Close.
  const asksDone = state.phase === "running" && onDone !== undefined;
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
        className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-border bg-surface-2 text-fg-secondary shadow-dialog"
      >
        <header className="flex items-center gap-2.5 px-5 py-4">
          {profileId && <AgentTile profileId={profileId} name="" size={22} />}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {state.isSetup ? `Set up ${state.agentName}` : `Sign in to ${state.agentName}`}
          </h2>
          <IconButton label="Cancel sign-in" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </header>

        {/* TerminalView insets xterm itself (14/12), so the box adds no padding of its own. */}
        <div data-sign-in-terminal="" className="mx-5 flex h-[380px] overflow-hidden rounded-md border border-border bg-terminal-bg">
          <TerminalView
            sessionId={state.terminalId}
            output={output}
            isLive={state.phase === "running"}
            onInput={onInput}
            onResize={onResize}
          />
        </div>

        <footer className="flex items-center gap-3 px-5 py-4">
          <p role="status" className={`min-w-0 flex-1 text-ui-sm ${isFailed ? "text-danger" : "text-fg-muted"}`}>
            {statusText(state, onDone !== undefined)}
          </p>
          {asksDone ? (
            <>
              <Button variant="ghost" tone="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={onDone}>
                {doneLabel(state.isSetup)}
              </Button>
            </>
          ) : (
            <Button ref={isFailed && canTryAgain ? undefined : primaryRef} onClick={onClose}>
              <span className="text-fg">Close</span>
            </Button>
          )}
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
