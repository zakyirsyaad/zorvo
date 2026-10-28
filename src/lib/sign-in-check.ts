import { invoke } from '@tauri-apps/api/core';
import { parseAuthRequired } from './acp-auth';

/** What asking an agent showed: someone signed in, still nobody, or no answer either way. */
export type SignInCheck = 'signed-in' | 'signed-out' | 'unknown';

/**
 * Asks an agent, after a sign-in, whether it now has one. Only an agent that
 * shows someone signed in says `signed-in`, and only one that still asks for a
 * sign-in says `signed-out`. One that cannot be asked, or says nothing either
 * way (a missing npx, a crash, no account reported), is `unknown`: a sign-in
 * flow carries on as if signed in, and a later refusal opens the sign-in
 * again, but nothing treats it as seen signed in.
 */
export async function checkSignIn(profileId: string, cwd: string): Promise<SignInCheck> {
  try {
    const answer: unknown = await invoke('acp_probe_agent', { profileId, cwd, needsOptions: false });
    const isSeen = typeof answer === 'object' && answer !== null && (answer as { signInChecked?: unknown }).signInChecked === true;
    return isSeen ? 'signed-in' : 'unknown';
  } catch (error) {
    return parseAuthRequired(error) ? 'signed-out' : 'unknown';
  }
}

/**
 * Reads the agents and the login shell's environment afresh, so a key exported in the shell's
 * startup files after Zorvo started is seen by the next check. A refresh that fails (the failure
 * is reported by the caller's own handler) never stops the check that follows.
 */
export async function refreshQuietly(refresh: () => Promise<void>): Promise<void> {
  try {
    await refresh();
  } catch {
    // The check goes on with the environment it has.
  }
}
