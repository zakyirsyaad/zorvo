// Zorvo Private: small rules the Settings screen shares. Pure: no invoke, no React.
import type { TopupFlow } from '../hooks/usePrivateCredits';

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
