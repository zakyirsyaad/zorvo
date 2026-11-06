import type { Ref } from "react";
import { GITHUB_CLI_INSTALL_COMMAND, GITHUB_CLI_URL, type GithubStatus } from "../../lib/github";
import { initialsFromName } from "../../lib/initials";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { SettingsGroup, SettingsHeader, SettingsRow } from "./SettingsGroup";

export interface GithubSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
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

/** What a screen reader hears when the row changes, in few words (the row itself is longer). */
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

function CheckAgain({ isChecking, onCheck }: Pick<GithubSectionProps, "isChecking" | "onCheck">) {
  return (
    <Button size="md" onClick={onCheck} disabled={isChecking}>
      {isChecking ? "Checking…" : "Check again"}
    </Button>
  );
}

function ConnectButton({ onConnect }: Pick<GithubSectionProps, "onConnect">) {
  return (
    <Button variant="primary" size="md" onClick={onConnect}>
      Connect
    </Button>
  );
}

/** The one row of the Connection group, for the state the user's own `gh` reports. */
function ConnectionRow({ status, isChecking, onCheck, onConnect, onOpenUrl }: GithubSectionProps) {
  if (status === null) {
    return <SettingsRow isTight label={<span className="text-fg-subtle">Checking your GitHub connection…</span>} />;
  }
  switch (status.state) {
    case "signed-in": {
      const login = status.login ?? "";
      const initials = initialsFromName(status.name) ?? login.charAt(0).toUpperCase();
      return (
        <SettingsRow
          isTight
          leading={
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-ui-sm font-semibold text-fg-secondary"
            >
              {initials}
            </span>
          }
          label={status.name ?? `@${login}`}
          description={<StatusLine status="ready">{`Connected as @${login} on github.com`}</StatusLine>}
          control={<CheckAgain isChecking={isChecking} onCheck={onCheck} />}
        />
      );
    }
    case "signed-out":
      return (
        <SettingsRow
          isTight
          label="Not connected"
          description="Connect to see pull requests in the Changes tab and the top bar."
          control={<ConnectButton onConnect={onConnect} />}
        />
      );
    case "not-installed":
      return (
        <SettingsRow
          isTight
          label="Install the GitHub CLI first"
          description={
            <>
              Run{" "}
              <span className="select-text font-mono text-caption text-fg-secondary">{GITHUB_CLI_INSTALL_COMMAND}</span> in a
              terminal, or get it from{" "}
              <button
                type="button"
                onClick={() => onOpenUrl(GITHUB_CLI_URL)}
                className="rounded-sm text-fg-secondary underline underline-offset-2 focus-ring"
              >
                cli.github.com
              </button>
              . Then check again.
            </>
          }
          control={<CheckAgain isChecking={isChecking} onCheck={onCheck} />}
        />
      );
    case "unknown": {
      // A rejected token in an environment variable is not fixed by Connect: gh will not log in while it is set.
      const canConnect = status.canConnect !== false;
      return (
        <SettingsRow
          isTight
          label={canConnect ? "Could not check GitHub" : "GitHub turned down your token"}
          description={status.message}
          control={
            <>
              {canConnect && <ConnectButton onConnect={onConnect} />}
              <CheckAgain isChecking={isChecking} onCheck={onCheck} />
            </>
          }
        />
      );
    }
  }
}

/**
 * Settings → GitHub: whether the user's own GitHub CLI is installed and signed in, and how to get
 * from one state to the next. Sign-in happens in `gh` itself; Zorvo shows the result and holds no token.
 */
export function GithubSection({ ref, titleRef, titleId, ...props }: GithubSectionProps) {
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-4 rounded-xl focus-ring">
      <SettingsHeader title="GitHub" titleRef={titleRef} titleId={titleId}>
        Optional. Zorvo reads pull requests through your own <code className="font-mono text-ui-sm">gh</code> and keeps no
        token.
      </SettingsHeader>
      {/* Always there, so a screen reader hears each change: the answer that replaces "Checking…". */}
      <p role="status" className="sr-only">
        {announcementOf(props.status, props.isChecking)}
      </p>
      <SettingsGroup heading="Connection">
        <ConnectionRow {...props} />
      </SettingsGroup>
    </div>
  );
}
