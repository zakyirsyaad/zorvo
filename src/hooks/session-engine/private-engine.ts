// Zorvo Private in the ACP engine: what a private session's refusal turns into. Pure.
import { parseAuthRequired } from '../../lib/acp-auth';
import { parsePrivateCredits } from '../../lib/private-credits';
import { PRIVATE_SIGN_IN_FAILED, privateOpenError, type CreditsOutReason } from '../../lib/private-session';

/** What a private session's refusal asks for: mark it out of credits, or tell the user in plain words. */
export type PrivateRefusal = { creditsOut: CreditsOutReason } | { report: string };

/**
 * A private turn's refusal: for credits or a key, or for a sign-in (Zorvo signs a private session's agent in,
 * so there is no sign-in of the user's to offer). Null for any other error.
 */
export function privateTurnRefusal(error: unknown, sessionCap?: number): PrivateRefusal | null {
  const creditsOut = parsePrivateCredits(error);
  if (creditsOut) {
    if (creditsOut.reason === 'empty' && sessionCap !== undefined) return { creditsOut: 'session_limit' };
    return { creditsOut: creditsOut.reason };
  }
  return parseAuthRequired(error) ? { report: PRIVATE_SIGN_IN_FAILED } : null;
}

/**
 * The refusal of opening a session, in Zorvo Private's words: marked out of credits when the caller can
 * (`canMarkCreditsOut`), else said as text; a sign-in request of a private session is said as text too.
 * Null for an error that keeps its ordinary wording.
 */
export function privateOpenOutcome(error: unknown, isPrivate: boolean, canMarkCreditsOut: boolean, sessionCap?: number): PrivateRefusal | null {
  const privateError = privateOpenError(error, isPrivate);
  if (privateError?.creditsOut) {
    const reason = privateError.creditsOut === 'empty' && sessionCap !== undefined ? 'session_limit' : privateError.creditsOut;
    if (canMarkCreditsOut) return { creditsOut: reason };
  }
  if (privateError) return { report: privateError.text };
  return isPrivate && parseAuthRequired(error) ? { report: PRIVATE_SIGN_IN_FAILED } : null;
}
