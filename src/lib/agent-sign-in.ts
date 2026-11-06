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

/** The composer's placeholder while the draft's agent waits for a sign-in. */
export function signInPlaceholder(agentName: string, continuesSession: boolean): string {
  return `Sign in to ${agentName} to ${continuesSession ? 'continue this session' : 'send a message'}.`;
}

/** Said when a request to sign in to one agent is refused because another agent's sign-in is running. */
export const SIGN_IN_RUNNING_NOTICE = "Another agent's sign-in is running. Finish it, then try again.";

/** What a sign-in's failure says when the reason is not a plain sentence. */
const SIGN_IN_FAILED_FALLBACK = 'Zorvo could not finish the sign-in. Try again.';

/** A sign-in's failure reason, when it reads as a plain sentence; the agent's own output (paths, a stack) is not shown. */
export function plainReason(reason: string | undefined): string {
  const text = reason?.trim() ?? '';
  const isPlain = text !== '' && text.length <= 120 && !/[\n/\\]/.test(text);
  return isPlain ? text : SIGN_IN_FAILED_FALLBACK;
}
