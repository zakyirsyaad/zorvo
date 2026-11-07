import type { Ledger } from "./ledger/Ledger";

/**
 * Worker bindings. The plain variables are set in wrangler.jsonc, the secrets with
 * `wrangler secret put` (never in the repository). Each variable below feeds one `Config` field.
 */
export interface Env {
  /** Credits a user gets per USD paid, e.g. "100". */
  CREDITS_PER_USD_PAID: string;
  /** Credits burned per USD of NEAR AI cost, e.g. "120" (a 20% margin). */
  BURN_PER_USD_COST: string;
  /** Comma-separated package prices in USD, e.g. "5,10,25". */
  PACKAGES_USD: string;
  /** Most credits one device may hold plus have reserved, e.g. "5000". */
  DEVICE_CAP_CREDITS: string;
  /** Stock kept back from sale, in nano-USD (scale 9), e.g. "2000000000" for $2; "0" keeps nothing back. */
  STOCK_BUFFER_NANO: string;
  /** Comma-separated model allowlist; only those NEAR AI also lists as verifiable are offered. */
  MODELS: string;
  /** NEAR AI Cloud workspace the user keys are created in. */
  WORKSPACE_ID: string;
  /** NEAR AI Cloud organization that pays for the keys. */
  ORGANIZATION_ID: string;
  /** NEAR account of the operator who owns that organization. */
  OPERATOR_ACCOUNT: string;
  /** NEAR AI Cloud API base, e.g. "https://cloud-api.near.ai/v1". */
  NEAR_AI_BASE: string;
  /** PingPay API base, e.g. "https://pay.pingpay.io/api". */
  PINGPAY_BASE: string;
  /** Optional https page PingPay sends a payer to after paying; the README's "Checkout paid" section by default. */
  CHECKOUT_PAID_URL?: string;
  /** Optional https page PingPay sends a payer to after cancelling; the README's "Checkout cancelled" section by default. */
  CHECKOUT_CANCELLED_URL?: string;

  LEDGER: DurableObjectNamespace<Ledger>;

  // Secrets (wrangler secret put).
  OPERATOR_REFRESH_TOKEN?: string;
  KEY_ENCRYPTION_KEY?: string;
  PINGPAY_API_KEY?: string;
  PINGPAY_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
  ALERT_URL?: string;
}

export type Config = {
  creditsPerUsdPaid: number;
  burnPerUsdCost: number;
  packagesUsd: number[];
  deviceCapCredits: number;
  /** Nano-USD (scale 9). */
  stockBufferNano: bigint;
  models: string[];
  workspaceId: string;
  organizationId: string;
  operatorAccount: string;
  nearAiBase: string;
  pingPayBase: string;
  checkoutPaidUrl: string;
  checkoutCancelledUrl: string;
};

/** Where PingPay sends the payer after the checkout unless configured: the README's "After a checkout" section. */
const DEFAULT_CHECKOUT_PAID_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-paid";
const DEFAULT_CHECKOUT_CANCELLED_URL = "https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-cancelled";

/** The plain variables `parseConfig` reads: the required strings of `Env`, never a binding or a secret. */
type VarName = { [K in keyof Env]-?: undefined extends Env[K] ? never : Env[K] extends string ? K : never }[keyof Env];

function invalid(name: string, why: string): never {
  throw new Error(`Invalid config variable ${name}: ${why}`);
}

function positiveInt(env: Env, name: VarName): number {
  const raw = String(env[name] ?? "").trim();
  if (!/^[0-9]+$/.test(raw) || Number(raw) <= 0 || !Number.isSafeInteger(Number(raw))) {
    invalid(name, "expected a positive whole number");
  }
  return Number(raw);
}

/** A whole number of 0 or more, read as a bigint so a nano-USD amount never passes through a double. */
function nonNegativeBigInt(env: Env, name: VarName): bigint {
  const raw = String(env[name] ?? "").trim();
  if (!/^[0-9]{1,18}$/.test(raw)) invalid(name, "expected a whole number of 0 or more");
  return BigInt(raw);
}

function list(env: Env, name: VarName): string[] {
  const items = String(env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0) invalid(name, "expected a comma-separated list");
  return items;
}

function text(env: Env, name: VarName): string {
  const value = String(env[name] ?? "").trim();
  if (value === "") invalid(name, "must not be empty");
  return value;
}

/** An optional https URL variable, or `fallback` when it is unset or empty. */
function httpsUrl(env: Env, name: "CHECKOUT_PAID_URL" | "CHECKOUT_CANCELLED_URL", fallback: string): string {
  const raw = String(env[name] ?? "").trim();
  if (raw === "") return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid(name, "expected an https URL");
  }
  if (url.protocol !== "https:") invalid(name, "expected an https URL");
  return url.toString();
}

export function parseConfig(env: Env): Config {
  const packagesUsd = list(env, "PACKAGES_USD").map(Number);
  if (!packagesUsd.every((usd) => Number.isInteger(usd) && usd > 0)) {
    invalid("PACKAGES_USD", "expected positive whole dollar amounts");
  }
  return {
    creditsPerUsdPaid: positiveInt(env, "CREDITS_PER_USD_PAID"),
    burnPerUsdCost: positiveInt(env, "BURN_PER_USD_COST"),
    packagesUsd,
    deviceCapCredits: positiveInt(env, "DEVICE_CAP_CREDITS"),
    stockBufferNano: nonNegativeBigInt(env, "STOCK_BUFFER_NANO"),
    models: list(env, "MODELS"),
    workspaceId: text(env, "WORKSPACE_ID"),
    organizationId: text(env, "ORGANIZATION_ID"),
    operatorAccount: text(env, "OPERATOR_ACCOUNT"),
    nearAiBase: text(env, "NEAR_AI_BASE"),
    pingPayBase: text(env, "PINGPAY_BASE"),
    checkoutPaidUrl: httpsUrl(env, "CHECKOUT_PAID_URL", DEFAULT_CHECKOUT_PAID_URL),
    checkoutCancelledUrl: httpsUrl(env, "CHECKOUT_CANCELLED_URL", DEFAULT_CHECKOUT_CANCELLED_URL),
  };
}
