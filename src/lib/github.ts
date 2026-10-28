/** Where the user's GitHub connection stands, as the backend reads it from their own GitHub CLI. */
export type GithubState = 'not-installed' | 'signed-out' | 'signed-in' | 'unknown';

export interface GithubStatus {
  state: GithubState;
  /** The signed-in account's login. */
  login?: string;
  /** The signed-in account's display name, when it has one. */
  name?: string;
  /** Why the state is unknown, in words for the user. */
  message?: string;
}

/** What Zorvo shows when the backend could not be asked at all. */
const CHECK_FAILED_MESSAGE = 'Could not check GitHub.';

export const GITHUB_CLI_INSTALL_COMMAND = 'brew install gh';
export const GITHUB_CLI_URL = 'https://cli.github.com';

export const GITHUB_CHECK_FAILED: GithubStatus = { state: 'unknown', message: CHECK_FAILED_MESSAGE };

const STATES: readonly GithubState[] = ['not-installed', 'signed-out', 'signed-in', 'unknown'];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The backend's answer as a status; anything that is not one reads as unknown, never as signed in. */
export function toGithubStatus(value: unknown): GithubStatus {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const state = STATES.find((known) => known === record.state);
  if (!state) return GITHUB_CHECK_FAILED;
  const login = text(record.login);
  // Someone signed in always has a login; without one the answer cannot be trusted.
  if (state === 'signed-in' && !login) return GITHUB_CHECK_FAILED;
  return { state, login, name: text(record.name), message: text(record.message) };
}

/** The signed-in account's name for the sidebar: its GitHub name, else `@login`; nothing when not signed in. */
export function githubDisplayName(status: GithubStatus | null): string | undefined {
  if (status?.state !== 'signed-in') return undefined;
  return status.name ?? (status.login ? `@${status.login}` : undefined);
}
