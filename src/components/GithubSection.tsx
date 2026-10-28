import { useEffect, useId, useState, type ReactNode, type Ref } from "react";
import { CircleCheck, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { GITHUB_CLI_INSTALL_COMMAND, GITHUB_CLI_URL, type GithubStatus } from "../lib/github";
import { GithubMark } from "./GithubMark";
import { Button } from "./ui/Button";

export interface GithubSectionProps {
  /** null until the first check answers. */
  status: GithubStatus | null;
  isChecking: boolean;
  onCheck: () => void;
  onConnect: () => void;
  onOpenUrl: (url: string) => void;
  /**
   * The section itself, which can take focus: Settings gives it back there when the sign-in
   * dialog closes and the button that opened it is gone.
   */
  ref?: Ref<HTMLDivElement>;
}

/** How long Copy says "Copied" before it offers the command again. */
const COPIED_MS = 1500;

type CopyState = "idle" | "copied" | "failed";

function Card({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">{children}</div>;
}

function CheckAgainButton({ isChecking, onCheck }: Pick<GithubSectionProps, "isChecking" | "onCheck">) {
  return (
    <Button
      onClick={onCheck}
      disabled={isChecking}
      icon={<RefreshCw size={13} aria-hidden="true" className={isChecking ? "animate-spin" : undefined} />}
    >
      {isChecking ? "Checking…" : "Check again"}
    </Button>
  );
}

/** The command to run, as text to select, with a button that copies it and says whether it worked. */
function CopyableCommand({ command }: { command: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const commandId = useId();
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copyState]);
  const copy = () => {
    const written = navigator.clipboard?.writeText(command);
    if (!written) {
      setCopyState("failed");
      return;
    }
    written.then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <code
          id={commandId}
          className="select-all rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-fg"
        >
          {command}
        </code>
        <Button onClick={copy} aria-describedby={commandId} icon={<Copy size={13} aria-hidden="true" />}>
          {copyState === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {/* The button's name changes, which a screen reader does not announce: this says it. */}
      <p role="status" className={copyState === "failed" ? "text-xs text-danger" : "sr-only"}>
        {copyState === "copied" && "Copied to the clipboard."}
        {copyState === "failed" && "Could not copy. Select the command and copy it yourself."}
      </p>
    </div>
  );
}

/** What a screen reader hears when the card changes, in few words (the card itself is longer). */
function announcementOf(status: GithubStatus | null, isChecking: boolean): string {
  if (status === null || isChecking) return "Checking your GitHub connection.";
  switch (status.state) {
    case "signed-in":
      return `Connected to GitHub as ${status.name ?? `@${status.login}`}.`;
    case "signed-out":
      return "Not connected to GitHub.";
    case "not-installed":
      return "GitHub CLI not installed.";
    case "unknown":
      return "Could not tell whether GitHub is connected.";
  }
}

function Body({ status, isChecking, onCheck, onConnect, onOpenUrl }: GithubSectionProps & { status: GithubStatus }) {
  if (status.state === "signed-in") {
    const name = status.name ?? `@${status.login}`;
    return (
      <Card>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-hover text-fg-secondary">
            <GithubMark size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-fg">{name}</p>
            {status.name && status.login && <p className="truncate text-[11px] text-fg-subtle">@{status.login}</p>}
            <p className="flex items-center gap-1 text-[11px] text-status-running">
              <CircleCheck size={11} aria-hidden="true" />
              Connected to GitHub
            </p>
          </div>
          <CheckAgainButton isChecking={isChecking} onCheck={onCheck} />
        </div>
      </Card>
    );
  }

  if (status.state === "not-installed") {
    return (
      <Card>
        <p className="text-xs font-medium text-fg">The GitHub CLI is not installed.</p>
        <p className="text-xs text-fg-muted">
          Zorvo connects to GitHub through the GitHub CLI (gh), so it never holds your password or token. Install it with
          Homebrew:
        </p>
        <CopyableCommand command={GITHUB_CLI_INSTALL_COMMAND} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onOpenUrl(GITHUB_CLI_URL)} icon={<ExternalLink size={13} aria-hidden="true" />}>
            Get gh from cli.github.com
          </Button>
          <CheckAgainButton isChecking={isChecking} onCheck={onCheck} />
        </div>
      </Card>
    );
  }

  if (status.state === "signed-out") {
    return (
      <Card>
        <p className="text-xs font-medium text-fg">You are not connected to GitHub.</p>
        <p className="text-xs text-fg-muted">
          Connect opens a terminal where the GitHub CLI signs you in through your browser. Zorvo never sees your password
          or token.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onConnect} icon={<GithubMark size={13} />}>
            Connect
          </Button>
          <CheckAgainButton isChecking={isChecking} onCheck={onCheck} />
        </div>
      </Card>
    );
  }

  // Unknown. A rejected token in an environment variable is not fixed by Connect: gh will not log in while it is set.
  const canConnect = status.canConnect !== false;
  return (
    <Card>
      <p className="text-xs font-medium text-fg">
        {canConnect ? "Zorvo could not tell whether you are connected to GitHub." : "GitHub turned down your token."}
      </p>
      {status.message && <p className="text-xs text-fg-muted">{status.message}</p>}
      <div className="flex flex-wrap gap-2">
        <CheckAgainButton isChecking={isChecking} onCheck={onCheck} />
        {canConnect && (
          <Button onClick={onConnect} icon={<GithubMark size={13} />}>
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * The GitHub section of Settings: whether the user's own GitHub CLI is
 * installed and signed in, and how to get from one state to the next. Sign-in
 * happens in `gh` itself; Zorvo shows the result and never holds a token.
 */
export function GithubSection({ ref, ...props }: GithubSectionProps) {
  const { status, isChecking } = props;
  return (
    <div ref={ref} tabIndex={-1} className="rounded-lg focus-ring">
      {/* Always there, so a screen reader hears each change: the answer that replaces "Checking…". */}
      <p role="status" className="sr-only">
        {announcementOf(status, isChecking)}
      </p>
      {status === null ? (
        <Card>
          <p className="text-xs text-fg-muted">Checking GitHub…</p>
        </Card>
      ) : (
        <Body {...props} status={status} />
      )}
    </div>
  );
}
