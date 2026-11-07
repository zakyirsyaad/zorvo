import { authDevice, ledgerOf } from "./auth";
import { parseConfig, type Env } from "./config";
import { error, json } from "./http";
import { verifyWebhook } from "./pingpay";

export { Ledger } from "./ledger/Ledger";

const REGISTRATIONS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
const SECRET_HASH = /^[0-9a-f]{64}$/;
const TOPUP_PATH = /^\/v1\/topups\/([0-9a-f-]{36})(\/cancel)?$/;
/** The PingPay events that settle a checkout; their `resourceId` is the checkout session id. */
const SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.expired"]);

async function registerDevice(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ledger = ledgerOf(env);
  const { allowed } = await ledger.rateLimit(`devices:${ip}`, REGISTRATIONS_PER_HOUR, HOUR_MS);
  if (!allowed) return error("rate_limited", 429);

  const body: unknown = await req.json().catch(() => null);
  const secretHash = (body as { secretHash?: unknown } | null)?.secretHash;
  if (typeof secretHash !== "string" || !SECRET_HASH.test(secretHash)) return error("bad_request", 400);

  const result = await ledger.registerDevice(secretHash);
  return "error" in result ? error(result.error, 400) : json({ deviceId: result.deviceId }, 201);
}

async function createTopup(req: Request, env: Env, deviceId: string): Promise<Response> {
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
      return json({ error: "not_implemented" }, 501); // Replaced by the balance endpoint.
    }
    if (req.method === "GET" && pathname === "/v1/stock") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return json(await ledgerOf(env).stockFor(device.deviceId));
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
