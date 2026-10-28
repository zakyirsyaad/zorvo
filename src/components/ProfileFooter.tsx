import { Settings, User } from "lucide-react";
import type { GithubStatus } from "../lib/github";
import { GithubMark } from "./GithubMark";
import { IconButton } from "./ui/IconButton";

export interface ProfileFooterProps {
  /** `git config --global user.name`, when the user has one set. */
  name?: string;
  /** `git config --global user.email`, when the user has one set. */
  email?: string;
  /** The GitHub connection; its name and login win over git's while someone is signed in. */
  github?: GithubStatus | null;
  /** Bundled app version; the version line is omitted when unknown. */
  version?: string;
  onOpenSettings?: () => void;
  /** Agent updates waiting; puts a dot on the Settings button. */
  updateCount?: number;
}

const FALLBACK_DISPLAY_NAME = "Local user";

/** Uppercased initials taken from up to the first two words of `name`. */
function initialsFromName(name?: string): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** Uppercased first alphanumeric character of the email's local part. */
function initialFromEmail(email?: string): string | null {
  const localPart = (email ?? "").trim().split("@")[0] ?? "";
  const first = [...localPart].find((character) => /[A-Za-z0-9]/.test(character));
  return first ? first.toUpperCase() : null;
}

function settingsLabel(updateCount: number): string {
  if (updateCount === 0) return "Settings";
  return `Settings, ${updateCount} ${updateCount === 1 ? "update" : "updates"}`;
}

/** What the footer shows for the person, from GitHub while they are signed in to it, else from git. */
function identityOf(
  github: GithubStatus | null | undefined,
  gitName: string | undefined,
  gitEmail: string | undefined,
): { displayName: string; initials: string | null } {
  if (github?.state === "signed-in" && github.login) {
    const githubName = github.name?.trim() || undefined;
    return {
      displayName: githubName ?? `@${github.login}`,
      initials: initialsFromName(githubName) ?? initialFromEmail(github.login),
    };
  }
  return {
    displayName: gitName ?? gitEmail ?? FALLBACK_DISPLAY_NAME,
    initials: initialsFromName(gitName) ?? initialFromEmail(gitEmail),
  };
}

/**
 * The developer's identity: their GitHub name (or @login) while the GitHub CLI
 * is signed in, else what their global git config holds.
 *
 * Nothing here is invented: there is no plan or tier badge, and when neither
 * GitHub nor git knows who they are the footer says so with a neutral label
 * rather than showing a hardcoded person.
 */
export function ProfileFooter({
  name,
  email,
  github,
  version,
  onOpenSettings,
  updateCount = 0,
}: ProfileFooterProps) {
  const { displayName, initials } = identityOf(github, name?.trim() || undefined, email?.trim() || undefined);
  const isGithubConnected = github?.state === "signed-in" && Boolean(github.login);

  return (
    <footer className="flex items-center justify-between border-t border-border bg-bg p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative shrink-0">
          <span
            role="img"
            aria-label={`${displayName} avatar`}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface-hover text-[11px] font-semibold text-fg-secondary"
          >
            {initials ?? <User size={13} aria-hidden="true" />}
          </span>
          {isGithubConnected && (
            <span
              role="img"
              aria-label="Connected to GitHub"
              title="Connected to GitHub"
              className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border border-border-strong bg-bg text-fg-secondary"
            >
              <GithubMark size={8} />
            </span>
          )}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-fg-secondary">{displayName}</span>
          {version && (
            <span className="text-[10px] text-fg-subtle">
              Zorvo v{version}
            </span>
          )}
        </div>
      </div>

      {onOpenSettings && (
        <IconButton label={settingsLabel(updateCount)} onClick={onOpenSettings} className="relative">
          <Settings size={14} />
          {updateCount > 0 && (
            <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </IconButton>
      )}
    </footer>
  );
}
