/**
 * Where an agent stands on signing in:
 * `ready` was seen signed in, `needed` said it wants a sign-in, `unchecked` is installed but never asked.
 * Asking opens a real session in the agent, so an agent is only asked when someone picks it.
 */
export type SignInState = 'ready' | 'needed' | 'unchecked';

export function signInStateOf(
  profileId: string,
  signedIn: readonly string[] | undefined,
  needed: ReadonlySet<string>,
): SignInState {
  if (needed.has(profileId)) return 'needed';
  return signedIn?.includes(profileId) ? 'ready' : 'unchecked';
}

/** The sidebar chip's words for each state. */
export const SIGN_IN_LABELS: Readonly<Record<SignInState, string>> = {
  ready: 'Ready',
  needed: 'Sign in',
  unchecked: 'Not checked',
};

/** The chip's colours for each state; the sidebar and Settings → Agents draw the same one. */
export const SIGN_IN_CHIP_STYLES: Readonly<Record<SignInState, { text: string; dot: string }>> = {
  ready: { text: 'text-status-running', dot: 'bg-status-running' },
  needed: { text: 'text-status-attention', dot: 'bg-status-attention' },
  unchecked: { text: 'text-fg-muted', dot: 'bg-fg-subtle' },
};

/** The composer's placeholder while the draft's agent waits for a sign-in. */
export function signInPlaceholder(agentName: string, continuesSession: boolean): string {
  return `Sign in to ${agentName} to ${continuesSession ? 'continue this session' : 'send a message'}.`;
}

/** Said when a request to sign in to one agent is refused because another agent's sign-in is running. */
export const SIGN_IN_RUNNING_NOTICE = "Another agent's sign-in is running. Finish it, then try again.";
