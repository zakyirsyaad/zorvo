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
  /**
   * Whether Connect can put it right; absent means it can. False for a rejected
   * token in an environment variable: gh refuses to log in while that variable is set.
   */
  canConnect?: boolean;
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
  return {
    state,
    login,
    name: text(record.name),
    message: text(record.message),
    // Connect is offered unless the backend says it cannot help.
    canConnect: record.canConnect !== false,
  };
}
