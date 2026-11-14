/** A private agent's request for the user to approve a top-up. */
export interface PrivateTopupRequest {
  sessionId: string;
  requestId: string;
  /** The Worker's package in whole US dollars; the backend validated it. */
  usd: number;
  /** The credits that package adds; the backend read it from the Worker. */
  credits: number;
  /** The agent's sentence, plain text; the card escapes it and never parses it. */
  reason: string;
}

/** The proxy's event name; the main window is its only listener. */
export const PRIVATE_TOPUP_REQUEST_EVENT = 'private-topup-request';

/**
 * Reads the event payload, or null when it is not one. The values are shape-checked here because
 * events cross the IPC boundary; the numbers must be usable before the card draws them.
 */
export function parsePrivateTopupRequest(value: unknown): PrivateTopupRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { sessionId, requestId, usd, credits, reason } = record;
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  if (typeof requestId !== 'string' || requestId === '') return null;
  if (typeof usd !== 'number' || !Number.isInteger(usd) || usd <= 0) return null;
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits <= 0) return null;
  if (typeof reason !== 'string') return null;
  return {
    sessionId,
    requestId,
    usd,
    credits,
    // The backend caps and strips; a second cut here keeps a malformed sender from drawing more.
    reason: reason.slice(0, 200),
  };
}