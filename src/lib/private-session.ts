// Zorvo Private in the session engine: the model a private session runs, the words for a private
// refusal when a session opens, and the picks a private session never takes. Pure.
import type { AcpChange } from './acp-draft';
import { parsePrivateCredits, privateErrorText, PRIVATE_ERROR_CODES } from './private-credits';
import type { AcpOptions } from '../hooks/useAcpSessions';
import type { Session } from '../types';

export const CREDITS_RAN_OUT = 'Your credits ran out. Top up to continue.';
export const PRIVATE_KEY_STOPPED = "This Mac's private key stopped working. Restore it in Settings → Private mode.";
/** NEAR AI refused for credits, but the balance read right after still shows some: it may lag the refusal. */
export const CREDITS_MAY_BE_UPDATING =
  'NEAR AI refused for credits; your balance may still be updating. Try again in a minute.';
/** A private session's agent asked for a sign-in: Zorvo signs it in, so the user can only check Private mode. */
export const PRIVATE_SIGN_IN_FAILED = "Private mode couldn't sign in. Check Settings → Private mode.";

export type CreditsOutReason = 'empty' | 'key';

/** What a private session out of credits (`empty`) or with a key that stopped working (`key`) says. */
export function creditsOutText(reason: CreditsOutReason): string {
  return reason === 'empty' ? CREDITS_RAN_OUT : PRIVATE_KEY_STOPPED;
}

/** The private model a session runs on; undefined for an ordinary session. */
export function privateModelIdOf(session: Pick<Session, 'privateMode'>): string | undefined {
  return session.privateMode?.modelId;
}

export interface PrivateOpenError {
  text: string;
  /** Set for a refusal that needs credits or a key: the session is marked out of them. */
  creditsOut?: CreditsOutReason;
}

const PRIVATE_CODES: ReadonlySet<string> = new Set(PRIVATE_ERROR_CODES);

function plainCodeOf(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  return error instanceof Error ? error.message.trim() : '';
}

/**
 * The words for an error opening a session, when it is one of Zorvo Private's; null for any other, which
 * keeps its ordinary wording. Only a private session's open gives private codes, except `private_session`,
 * the refusal of a plain reopen of a session that ran privately.
 */
export function privateOpenError(error: unknown, isPrivate: boolean): PrivateOpenError | null {
  const refusal = parsePrivateCredits(error);
  if (refusal) return { text: creditsOutText(refusal.reason), creditsOut: refusal.reason };
  const code = plainCodeOf(error);
  if (!PRIVATE_CODES.has(code)) return null;
  return isPrivate || code === 'private_session' ? { text: privateErrorText(code) } : null;
}

/**
 * The picks without any model change: a private session runs the model Zorvo launched it on, in a TEE,
 * and a model remembered from an ordinary session must not move it off that model.
 */
export function withoutModelChanges(changes: readonly AcpChange[], info: AcpOptions): AcpChange[] {
  const isModelConfig = (configId: string) => info.configOptions.find((o) => o.id === configId)?.category === 'model';
  return changes.filter((change) => change.kind !== 'model' && !(change.kind === 'config' && isModelConfig(change.configId)));
}
