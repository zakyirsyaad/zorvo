// Zorvo Private: wire types, credit math and wording. Pure: no invoke, no React.
// The types mirror the Rust backend in `src-tauri/src/private_mode/` (camelCase fields,
// snake_case enum values); an `Option` there is `T | null` here.
import { formatRelativeTime } from './relative-time';

/** Every code the backend sends as a command error (`PrivateError::code`). */
export const PRIVATE_ERROR_CODES = [
  'unreachable',
  'unauthorized',
  'bad_request',
  'not_found',
  'stock',
  'device_cap',
  'rate_limited',
  'upstream',
  'keychain',
  'no_device',
  'no_key',
  'key_lost',
  'bad_code',
  'not_qwen',
  'unknown_model',
  'bad_checkout_url',
  'has_own_credits',
  'storage',
  'open_failed',
  'private_session',
] as const;

export type PrivateErrorCode = (typeof PRIVATE_ERROR_CODES)[number];

/** `none`: no device on this Mac yet. `moved`: the credits moved to another Mac. */
export type DeviceState = 'none' | 'ready' | 'moved';

export interface Balance {
  credits: number;
  usedCredits: number;
  keyReady: boolean;
  updatedAt: string;
}

export interface LastBalance {
  credits: number;
  usedCredits: number;
  at: string;
}

export interface PendingTopup {
  topupId: string;
  expiresAt: string;
  credits: number;
}

export interface StockPackage {
  usd: number;
  credits: number;
  available: boolean;
  /** `stock` or `device_cap` when the package is not available; absent otherwise. */
  reason?: string;
}

export interface Stock {
  availableCredits: number;
  yourRoomCredits: number;
  packages: StockPackage[];
  updatedAt: string;
}

export interface ModelPrice {
  id: string;
  inputPerM: number;
  outputPerM: number;
}

export type TopupStatus = 'created' | 'paid' | 'credited' | 'expired' | 'failed' | 'paid_waiting_stock';

export interface TopupState {
  status: TopupStatus;
  credits: number;
}

export interface PromoResult {
  topupId: string;
  credits: number;
}

export interface PrivateStatus {
  device: DeviceState;
  keyReady: boolean;
  keyError: PrivateErrorCode | null;
  balance: Balance | null;
  balanceError: PrivateErrorCode | null;
  lastBalance: LastBalance | null;
  recoverySaved: boolean;
  recoveryPrompted: boolean;
  pendingTopup: PendingTopup | null;
}

/** What the backend puts in front of a refusal that needs credits or a key. */
export const PRIVATE_CREDITS_PREFIX = 'PRIVATE_CREDITS:';

export interface PrivateCreditsRefusal {
  reason: 'empty' | 'key';
}

function messageOf(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return null;
}

/** Reads a `PRIVATE_CREDITS:{"reason":…}` refusal; null for any other error. */
export function parsePrivateCredits(error: unknown): PrivateCreditsRefusal | null {
  const message = messageOf(error)?.trim();
  if (!message?.startsWith(PRIVATE_CREDITS_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(message.slice(PRIVATE_CREDITS_PREFIX.length));
    if (typeof parsed !== 'object' || parsed === null || !('reason' in parsed)) return null;
    return parsed.reason === 'empty' || parsed.reason === 'key' ? { reason: parsed.reason } : null;
  } catch {
    return null;
  }
}

/** A turn is priced as this many tokens in and out, a rough size of one agent turn. */
export const TURN_INPUT_TOKENS = 20_000;
export const TURN_OUTPUT_TOKENS = 1_000;
/** Credits charged per US dollar of model cost. */
export const CREDITS_PER_USD_COST = 120;

export function creditsPerTurn(model: ModelPrice): number {
  const usd = (model.inputPerM * TURN_INPUT_TOKENS + model.outputPerM * TURN_OUTPUT_TOKENS) / 1e6;
  return usd * CREDITS_PER_USD_COST;
}

/** Whole turns a balance buys; 0 for a model with no price. */
export function turnsFor(credits: number, model: ModelPrice): number {
  const perTurn = creditsPerTurn(model);
  if (!(perTurn > 0) || credits <= 0) return 0;
  // The epsilon keeps 99 / 9.9 from landing just under 10.
  return Math.floor(credits / perTurn + 1e-9);
}

export function modelLabel(id: string): string {
  return (id.split('/').pop() ?? id).replaceAll('-', ' ');
}

export function formatCredits(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`;
}

/** "≈ 0.3 credit a turn" under one credit, whole credits from there. */
export function perTurnLabel(model: ModelPrice): string {
  const perTurn = creditsPerTurn(model);
  const shown = perTurn < 1 ? Math.round(perTurn * 10) / 10 : Math.round(perTurn);
  return `≈ ${shown} ${shown > 0 && shown <= 1 ? 'credit' : 'credits'} a turn`;
}

const PACKAGE_REASONS: Readonly<Record<string, string>> = {
  stock: 'Not enough stock right now',
  device_cap: 'Over your 5,000-credit limit',
};

export function packageReason(reason?: string): string | undefined {
  return reason !== undefined && Object.hasOwn(PACKAGE_REASONS, reason) ? PACKAGE_REASONS[reason] : undefined;
}

/** "Updated just now", "Updated 1 min ago", "Updated 2 hours ago". */
export function updatedAgo(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Updated recently';
  const ago = formatRelativeTime(at, now).toLowerCase().replace(/\bminutes?\b/, 'min');
  return `Updated ${ago}`;
}

const GENERIC_ERROR = 'Something went wrong. Try again.';
const CHECKOUT_FAILED = "Couldn't open checkout. Nothing was held or charged.";
const NO_CREDITS = 'This Mac has no private credits yet.';
const RESTORE_FOR_KEY = 'Restore with your recovery code to get a new one.';

const ERROR_TEXT: Readonly<Record<PrivateErrorCode, string>> = {
  unreachable: "Couldn't reach the credits server.",
  unauthorized: 'Your credits moved to another Mac.',
  bad_request: "That didn't work. Check what you typed and try again.",
  not_found: GENERIC_ERROR,
  stock: 'Top-ups are paused for now.',
  device_cap: 'That would take you over your 5,000-credit limit.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  upstream: CHECKOUT_FAILED,
  keychain: `Couldn't save your key in the Keychain. ${RESTORE_FOR_KEY}`,
  no_device: NO_CREDITS,
  no_key: NO_CREDITS,
  key_lost: `Your private key didn't reach this Mac. ${RESTORE_FOR_KEY}`,
  bad_code: "That code didn't work. Check it and try again.",
  not_qwen: 'Private sessions run Qwen Code only for now.',
  unknown_model: "That model isn't offered anymore. Start a new private session to pick another.",
  bad_checkout_url: CHECKOUT_FAILED,
  has_own_credits: 'This Mac has credits of its own. Restoring another code here would lose access to them.',
  storage: "Couldn't save your settings on this Mac. Try again.",
  open_failed: "Couldn't open your browser. Your checkout is ready: open it again, or cancel.",
  private_session: 'This session ran privately. Reopen it as a private session.',
};

/** Plain words for a command error code; anything unknown reads as a generic failure. */
export function privateErrorText(code: string): string {
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code as PrivateErrorCode] : GENERIC_ERROR;
}
