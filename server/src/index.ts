import { authDevice, ledgerOf } from "./auth";
import type { Env } from "./config";
import { error, json } from "./http";

export { Ledger } from "./ledger/Ledger";

const REGISTRATIONS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
const SECRET_HASH = /^[0-9a-f]{64}$/;

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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/devices") return registerDevice(req, env);

    if (req.method === "GET" && pathname === "/v1/balance") {
      const device = await authDevice(req, env);
      if (device instanceof Response) return device;
      return json({ error: "not_implemented" }, 501); // Replaced by the balance endpoint.
    }
    return error("not_found", 404);
  },
} satisfies ExportedHandler<Env>;
