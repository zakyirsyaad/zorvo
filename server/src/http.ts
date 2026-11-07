/** The `{ "error": "<code>" }` bodies the API answers with, and the status each code goes with. */
export type ErrorCode =
  | "unauthorized" // 401
  | "bad_request" // 400
  | "not_found" // 404
  | "stock" // 409
  | "device_cap" // 409
  | "rate_limited" // 429
  | "upstream"; // 502, or 503 when a webhook should be delivered again later

/** How long one request to NEAR AI or PingPay may take before it is given up. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function error(code: ErrorCode, status: number): Response {
  return json({ error: code }, status);
}
