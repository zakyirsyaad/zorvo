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
  'model_locked',
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

function isUsablePrice(price: unknown): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0;
}

/** A model whose prices are finite and not negative; any other is never offered. */
export function isPricedModel(model: ModelPrice): boolean {
  return isUsablePrice(model.inputPerM) && isUsablePrice(model.outputPerM);
}

/** Credits one turn costs; 0 for a price that is negative or not a finite number. */
export function creditsPerTurn(model: ModelPrice): number {
  const { inputPerM, outputPerM } = model;
  if (!isPricedModel(model)) return 0;
  const usd = (inputPerM * TURN_INPUT_TOKENS + outputPerM * TURN_OUTPUT_TOKENS) / 1e6;
  const credits = usd * CREDITS_PER_USD_COST;
  return Number.isFinite(credits) ? credits : 0;
}

/** Whole turns a balance buys; 0 for a model with no price. */
export function turnsFor(credits: number, model: ModelPrice): number {
  const perTurn = creditsPerTurn(model);
  if (perTurn === 0 || !Number.isFinite(credits) || credits <= 0) return 0;
  // The epsilon keeps 99 / 9.9 from landing just under 10.
  return Math.floor(credits / perTurn + 1e-9);
}

export function modelLabel(id: string): string {
  return (id.split('/').pop() || id).replaceAll('-', ' ');
}

/** Whole credits, rounded: "1,240 credits", "1 credit"; anything not a positive number reads as 0. */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 credits';
  // `|| 0` turns the -0 that rounding a small negative gives into 0.
  const whole = Math.round(n) || 0;
  return `${whole.toLocaleString('en-US')} ${whole === 1 ? 'credit' : 'credits'}`;
}

/** What Zorvo says once a top-up's credits land: the notification's and the in-app notice's words. */
export function creditedNoticeText(credits: number): string {
  return `+${formatCredits(credits)}. Private sessions can use them now.`;
}

/** An RFC 3339 time with a fraction of seconds: the fraction, then the zone. */
const ISO_FRACTION = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(Z|[+-]\d{2}:\d{2})$/i;

/**
 * The time with its fraction cut to milliseconds. Servers may send nanoseconds, which the date
 * parser of every engine need not accept (ECMAScript only promises three digits); text that is not
 * such a time is returned as it is.
 */
export function normalizeIsoTime(iso: string): string {
  const match = ISO_FRACTION.exec(iso);
  if (!match) return iso;
  const [, seconds, fraction, zone] = match;
  return `${seconds}.${fraction.slice(0, 3)}${zone}`;
}

/** Epoch milliseconds of an RFC 3339 time, nanosecond ones included; NaN when it is not one. */
export function parseIsoTime(iso: string): number {
  return Date.parse(normalizeIsoTime(iso));
}

/** Below this, one decimal would round a paid model down to 0. */
const MIN_SHOWN_PER_TURN = 0.05;

/** "≈ 0.3 credit a turn" under one credit, whole credits from there; "< 0.1" never reads as free. */
export function perTurnLabel(model: ModelPrice): string {
  const perTurn = creditsPerTurn(model);
  if (perTurn > 0 && perTurn < MIN_SHOWN_PER_TURN) return '< 0.1 credit a turn';
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
  const at = parseIsoTime(iso);
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
  model_locked: 'Private sessions keep their model. Start a new session to pick another.',
};

/** Plain words for a command error code; anything unknown reads as a generic failure. */
export function privateErrorText(code: string): string {
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code as PrivateErrorCode] : GENERIC_ERROR;
}

export type PrivateAction = 'models' | 'stock' | 'cancel' | 'redeem' | 'forget' | 'recover' | 'mark';

const MODELS_FAILED = "Couldn't load the private models. Try again.";
const STOCK_FAILED = "Couldn't load the packages. Try again.";
const CANCEL_FAILED = "Couldn't cancel the checkout. Try again.";
const REDEEM_FAILED = "Couldn't redeem the code. Try again.";
const MARK_FAILED = "Couldn't save your answer. Try again.";

/**
 * Plain words for a command error in the context of one action. `privateErrorText`'s `upstream`
 * says nothing was held or charged, which is right when a checkout fails to open and wrong for
 * loading prices, cancelling a hold, redeeming a code, restoring or answering the recovery-code
 * dialog, so those say what failed instead.
 */
export function actionError(action: PrivateAction, code: string): string {
  if (code === 'unauthorized') return privateErrorText(code);
  switch (action) {
    case 'models':
      return MODELS_FAILED;
    case 'stock':
      return STOCK_FAILED;
    case 'cancel':
      return CANCEL_FAILED;
    case 'redeem':
      // The other codes tell the user what to change (a wrong code, too many tries).
      return code === 'upstream' || code === 'unreachable' ? REDEEM_FAILED : privateErrorText(code);
    case 'mark':
      // Only this Mac's state file is written: whatever the code, the answer was not kept.
      return MARK_FAILED;
    case 'forget':
    case 'recover':
      return code === 'upstream' ? GENERIC_ERROR : privateErrorText(code);
  }
}
