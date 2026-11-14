// Zorvo Private: small rules the Settings screen shares. Pure: no invoke, no React.
import type { TopupFlow } from '../hooks/usePrivateCredits';
import { privateErrorText } from './private-credits';

/**
 * The flow's error code once polling gave up on a waiting top-up the server could not be reached about.
 * Not a backend code: a later status read that still holds the top-up follows it again, as a restart does.
 */
export const TOPUP_UNCHECKED = 'topup_unchecked';

const TOPUP_UNCHECKED_TEXT = "Couldn't check your top-up. Refresh your balance later to check again.";

/** Plain words for the error that stopped a top-up: a backend code, or `TOPUP_UNCHECKED`. */
export function topupErrorText(code: string): string {
  return code === TOPUP_UNCHECKED ? TOPUP_UNCHECKED_TEXT : privateErrorText(code);
}

/** A top-up is being created or followed: the packages and the promo field must stay out of the way. */
export function isTopupActive(flow: TopupFlow): boolean {
  return (
    flow.kind === 'opening' || flow.kind === 'waiting' || flow.kind === 'paid' || flow.kind === 'waiting-stock'
  );
}

/** The backend rejects with a plain snake_case code, as a string or an Error. */
export function errorCodeOf(error: unknown): string {
  if (typeof error === 'string') return error;
  return error instanceof Error ? error.message : '';
}

/**
 * Codes that end a top-up before any hold or payment exists, so nothing can still go through.
 * `upstream` is here because its words say nothing was held, which is true only of these.
 */
const NO_HOLD_CODES: ReadonlySet<string> = new Set([
  'stock',
  'device_cap',
  'rate_limited',
  'bad_request',
  'bad_checkout_url',
  'upstream',
]);

/** After this error a payment the user started may still be credited. */
export function mayStillBePaid(code: string): boolean {
  return !NO_HOLD_CODES.has(code);
}
