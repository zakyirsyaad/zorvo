import type { Env } from "./config";
import { sha256Hex } from "./crypto";
import { error } from "./http";

export const BEARER = /^Bearer (\S+)$/;

export function ledgerOf(env: Env) {
  return env.LEDGER.get(env.LEDGER.idFromName("ledger"));
}

/** Resolves the device a request belongs to from `Authorization: Bearer <secret>`, or the 401 to send. */
export async function authDevice(req: Request, env: Env): Promise<{ deviceId: string } | Response> {
  const secret = BEARER.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (!secret) return error("unauthorized", 401);
  const device = await ledgerOf(env).deviceBySecretHash(await sha256Hex(secret));
  return device ? { deviceId: device.id } : error("unauthorized", 401);
}
