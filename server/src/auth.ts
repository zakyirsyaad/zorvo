import type { Env } from "./config";
import { sha256Hex } from "./crypto";
import { error } from "./http";
import { HOUR_MS } from "./time";

export const BEARER = /^Bearer (\S+)$/;
/** A device secret's SHA-256 as the API takes it: 64 lowercase hex digits. */
export const SECRET_HASH = /^[0-9a-f]{64}$/;
/** Wrong or unknown device secrets one address may send in an hour before it is answered 429. */
const FAILED_AUTH_PER_HOUR = 60;

export function ledgerOf(env: Env) {
  return env.LEDGER.get(env.LEDGER.idFromName("ledger"));
}

/** The caller's address as Cloudflare states it; requests without one share the "unknown" bucket. */
export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Resolves the device a request belongs to from `Authorization: Bearer <secret>`, or the answer to
 * send: 401, or 429 once the address has sent 60 wrong secrets within the hour. The lookup and the
 * count are one Ledger call, so a valid device is never counted or slowed down.
 */
export async function authDevice(req: Request, env: Env): Promise<{ deviceId: string } | Response> {
  const secret = BEARER.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (!secret) return error("unauthorized", 401);
  const result = await ledgerOf(env).authenticate(await sha256Hex(secret), `auth:${clientIp(req)}`, FAILED_AUTH_PER_HOUR, HOUR_MS);
  if ("deviceId" in result) return result;
  return result.error === "rate_limited" ? error("rate_limited", 429) : error("unauthorized", 401);
}
