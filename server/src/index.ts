import { authDevice, BEARER, clientIp, ledgerOf, SECRET_HASH } from "./auth";
import { parseConfig, type Env } from "./config";
import { error, json } from "./http";
import { sha256Hex, timingSafeEqual } from "./crypto";
import { verifyWebhook } from "./pingpay";
import { HOUR_MS } from "./time";

export { Ledger } from "./ledger/Ledger";

const REGISTRATIONS_PER_HOUR = 10;
const TOPUPS_PER_HOUR = 10;
const PROMO_ATTEMPTS_PER_HOUR = 5;
const RECOVER_ATTEMPTS_PER_HOUR = 5;
/** Admin attempts per address and hour, right or wrong, so the token cannot be guessed at speed. */
const ADMIN_ATTEMPTS_PER_HOUR = 20;
/** A promo code as the admin may create it: 4 to 64 visible ASCII characters. */
const PROMO_CODE = /^[\x21-\x7E]{4,64}$/;
const MAX_PROMO_USES = 10_000;
/** Longest promo or recovery code the API reads; longer ones cannot be real. */
const MAX_CODE_LENGTH = 100;
const TOPUP_PATH = /^\/v1\/topups\/([0-9a-f-]{36})(\/cancel)?$/;
/** The PingPay events that settle a checkout; their `resourceId` is the checkout session id. */
const SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.expired"]);

async function registerDevice(req: Request, env: Env): Promise<Response> {
  const ledger = ledgerOf(env);
  const { allowed } = await ledger.rateLimit(`devices:${clientIp(req)}`, REGISTRATIONS_PER_HOUR, HOUR_MS);
  if (!allowed) return error("rate_limited", 429);

  const body: unknown = await req.json().catch(() => null);
  const secretHash = (body as { secretHash?: unknown } | null)?.secretHash;
  if (typeof secretHash !== "string" || !SECRET_HASH.test(secretHash)) return error("bad_request", 400);

  const result = await ledger.registerDevice(secretHash);
  return "error" in result ? error(result.error, 400) : json({ deviceId: result.deviceId }, 201);
}

/** Each top-up opens a PingPay checkout the alarm then polls, so a device gets 10 an hour. Cancel is not limited. */
async function createTopup(req: Request, env: Env, deviceId: string): Promise<Response> {
  const { allowed } = await ledgerOf(env).rateLimit(`topups:${deviceId}`, TOPUPS_PER_HOUR, HOUR_MS);
  if (!allowed) return error("rate_limited", 429);
  const body: unknown = await req.json().catch(() => null);
  const packageUsd = (body as { packageUsd?: unknown } | null)?.packageUsd;
  if (typeof packageUsd !== "number" || !parseConfig(env).packagesUsd.includes(packageUsd)) return error("bad_request", 400);

  const result = await ledgerOf(env).createTopup(deviceId, packageUsd, Date.now());
  if (!("error" in result)) return json(result, 201);
  return result.error === "upstream" ? error("upstream", 502) : error(result.error, 409);
}

async function topupRoute(env: Env, deviceId: string, topupId: string, cancel: boolean): Promise<Response> {
  const ledger = ledgerOf(env);
  const topup = cancel ? await ledger.cancelTopup(deviceId, topupId, Date.now()) : await ledger.topupFor(deviceId, topupId);
  return topup ? json(topup) : error("not_found", 404);
}

/** The device's NEAR AI key, once: the Ledger deletes it as it hands it over. Never cached on the way. */
async function handOverKey(env: Env, deviceId: string): Promise<Response> {
  const key = await ledgerOf(env).takeKey(deviceId);
  const response = key === null ? error("not_found", 404) : json({ key });
  response.headers.set("cache-control", "no-store");
  return response;
}

/** A positive whole number up to `max`, or null. */
function boundedInt(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
}

/** The admin token is a secret compared in constant time; without one configured nobody is admin. */
function isAdmin(req: Request, env: Env): boolean {
  const expected = env.ADMIN_TOKEN;
  if (expected === undefined || expected === "") return false;
  const given = BEARER.exec(req.headers.get("Authorization") ?? "")?.[1];
  return given !== undefined && timingSafeEqual(given, expected);
}

/** Admin: creates or updates a promo code. Only the code's hash is stored; the code is never logged. */
async function adminPromo(req: Request, env: Env): Promise<Response> {
  const ledger = ledgerOf(env);
  if (!(await ledger.rateLimit(`admin:${clientIp(req)}`, ADMIN_ATTEMPTS_PER_HOUR, HOUR_MS)).allowed) return error("rate_limited", 429);
  if (!isAdmin(req, env)) return error("unauthorized", 401);
  const body = ((await req.json().catch(() => null)) ?? {}) as { code?: unknown; credits?: unknown; maxUses?: unknown };
  const credits = boundedInt(body.credits, parseConfig(env).deviceCapCredits);
  const maxUses = boundedInt(body.maxUses, MAX_PROMO_USES);
  if (typeof body.code !== "string" || !PROMO_CODE.test(body.code) || credits === null || maxUses === null) return error("bad_request", 400);
  await ledger.addPromo(await sha256Hex(body.code), credits, maxUses);
  return json({ ok: true });
}

/** Every attempt counts, wrong or malformed, so a code cannot be guessed at more than 5 an hour per device. */
async function redeemPromoRoute(req: Request, env: Env, deviceId: string): Promise<Response> {
  const ledger = ledgerOf(env);
  if (!(await ledger.rateLimit(`promo:${deviceId}`, PROMO_ATTEMPTS_PER_HOUR, HOUR_MS)).allowed) return error("rate_limited", 429);
  const code = ((await req.json().catch(() => null)) as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code === "" || code.length > MAX_CODE_LENGTH) return error("bad_request", 400);
  const result = await ledger.redeemPromo(deviceId, await sha256Hex(code), Date.now());
  if (!("error" in result)) return json(result, 201);
  return result.error === "bad_request" ? error("bad_request", 400) : error(result.error, 409);
}

/** The recovery code is the credential, so there is no Bearer; attempts are limited per address. */
async function recoverRoute(req: Request, env: Env): Promise<Response> {
  const ledger = ledgerOf(env);
  if (!(await ledger.rateLimit(`recover:${clientIp(req)}`, RECOVER_ATTEMPTS_PER_HOUR, HOUR_MS)).allowed) return error("rate_limited", 429);
  const body = (await req.json().catch(() => null)) as { recoveryCode?: unknown; newSecretHash?: unknown } | null;
  const { recoveryCode, newSecretHash } = body ?? {};
  if (typeof recoveryCode !== "string" || recoveryCode === "" || recoveryCode.length > MAX_CODE_LENGTH) return error("bad_request", 400);
  if (typeof newSecretHash !== "string" || !SECRET_HASH.test(newSecretHash)) return error("bad_request", 400);
  const result = await ledger.recover(await sha256Hex(recoveryCode), newSecretHash, Date.now());
  return "ok" in result ? json({ ok: true }) : error("bad_request", 400);
}

/** PingPay webhooks: the signature is checked on the raw body before anything is parsed or changed. */
async function pingPayWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  if (!(await verifyWebhook(rawBody, req.headers, env.PINGPAY_WEBHOOK_SECRET ?? "", Date.now()))) {
    return error("unauthorized", 401);
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return error("bad_request", 400);
  }
  const { id, type, resourceId } = (typeof event === "object" && event !== null ? event : {}) as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || typeof type !== "string") return error("bad_request", 400);
  if (!SESSION_EVENTS.has(type)) return json({ received: true });
  if (typeof resourceId !== "string" || resourceId === "") return error("bad_request", 400);

  const result = await ledgerOf(env).webhookEvent(resourceId, id, Date.now());
  if (!("error" in result)) return json({ received: true });
  // 502: PingPay could not be read. 503: the session is not settled yet. Either way PingPay redelivers.
  return error("upstream", result.error === "retry" ? 503 : 502);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/devices") return registerDevice(req, env);

    if (req.method === "GET" && pathname === "/v1/balance") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return json(await ledgerOf(env).balanceFor(device.deviceId, new URL(req.url).searchParams.get("fresh") === "1"));
    }
    if (req.method === "GET" && pathname === "/v1/models") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      const result = await ledgerOf(env).models();
      return "error" in result ? error("upstream", 502) : json(result);
    }
    if (req.method === "GET" && pathname === "/v1/stock") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return json(await ledgerOf(env).stockFor(device.deviceId));
    }
    if (req.method === "GET" && pathname === "/v1/key") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return handOverKey(env, device.deviceId);
    }
    if (req.method === "POST" && pathname === "/v1/admin/promos") return adminPromo(req, env);
    if (req.method === "POST" && pathname === "/v1/recover") return recoverRoute(req, env);
    if (req.method === "POST" && pathname === "/v1/promo") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return redeemPromoRoute(req, env, device.deviceId);
    }
    if (req.method === "POST" && pathname === "/v1/webhooks/pingpay") return pingPayWebhook(req, env);
    if (req.method === "POST" && pathname === "/v1/topups") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return createTopup(req, env, device.deviceId);
    }
    const topup = TOPUP_PATH.exec(pathname);
    if (topup && (topup[2] ? req.method === "POST" : req.method === "GET")) {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return topupRoute(env, device.deviceId, topup[1]!, topup[2] !== undefined);
    }
    return error("not_found", 404);
  },
} satisfies ExportedHandler<Env>;
