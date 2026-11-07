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

/**
 * What a check says about an agent that opened a session but whose key variables are not set: it cannot be
 * confirmed signed in, and not called signed out either (a key saved by its own setup is not in the environment).
 */
export function unconfirmedMessage(agentName: string, variables: readonly string[]): string {
  const list = variables.join(', ');
  const isOne = variables.length === 1;
  const missing = isOne ? `${list} is not set in your shell.` : `None of ${list} is set in your shell.`;
  const exported = isOne ? `export ${list}` : 'export one of them';
  return (
    `${agentName} opened a session, but Zorvo cannot confirm a sign-in: ${missing} ` +
    `If you saved a key with ${agentName}'s own setup, Zorvo cannot see it. ` +
    `Otherwise run that setup or ${exported} (for example in ~/.zshrc), then check again.`
  );
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
