/** The `{ "error": "<code>" }` bodies the API answers with, and the status each code goes with. */
export type ErrorCode =
  | "unauthorized" // 401
  | "bad_request" // 400
  | "not_found" // 404
  | "stock" // 409
  | "device_cap" // 409
  | "rate_limited" // 429
  | "upstream"; // 502

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function error(code: ErrorCode, status: number): Response {
  return json({ error: code }, status);
}
