import { UPSTREAM_TIMEOUT_MS } from "./http";

/** The part of the NEAR AI Cloud API the credits server uses. Amounts it returns are scale 9 (nano-USD) in the results. */

const NANO_SCALE = 9;
const PAGE_SIZE = 100;
/** A key list longer than this many pages is treated as a fault, not paged through. */
const MAX_KEY_PAGES = 50;
/** The model list is read for at most this many pages; what was read by then is used. */
const MAX_MODEL_PAGES = 10;
const TOKENS_PER_MILLION = 1e6;
/** An upstream error code is kept only as this many safe characters, so a log line cannot be flooded or forged. */
const MAX_CODE_LENGTH = 64;
const UNSAFE_CODE_CHARACTERS = /[^A-Za-z0-9_.:-]/g;
/** The largest nano-USD amount a JSON number carries exactly. */
const MAX_JSON_NANO = BigInt(Number.MAX_SAFE_INTEGER);

/** A non-2xx answer from NEAR AI, or none in time (`status` 0). The message names the request, never a token. */
export class NearAiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "NearAiError";
  }
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The raw code in a NEAR AI error body: `{ "error": "code" }`, `{ "code": "code" }` or `{ "error": { "code": "code" } }`. */
function rawErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.error === "string") return body.error;
  if (typeof body.code === "string") return body.code;
  if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code;
  return undefined;
}

/** The error code, reduced to at most 64 of `[A-Za-z0-9_.:-]`; none when nothing of it is left. */
function errorCode(body: unknown): string | undefined {
  const code = rawErrorCode(body)?.replace(UNSAFE_CODE_CHARACTERS, "").slice(0, MAX_CODE_LENGTH);
  return code === undefined || code === "" ? undefined : code;
}

/** A path segment from an id, so an id holding `/`, `?` or `#` cannot reach another route. */
function segment(id: string): string {
  return encodeURIComponent(id);
}

function unexpected(what: string): never {
  throw new Error(`Unexpected NEAR AI response: ${what}`);
}

/**
 * A whole number from JSON (a number or a digit string) as a bigint. A fraction is refused, never
 * rounded. An integer too big for a double to hold exactly (an unlimited key) is taken as it reads.
 */
function wholeNumber(value: unknown, what: string): bigint {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return BigInt(value);
  return unexpected(`${what} is not a whole number`);
}

/**
 * `{ amount, scale }` (the value is amount / 10^scale dollars) or a bare whole number of nano-USD, as
 * nano-USD. A finer amount (scale over 9) is rounded to a whole nano-USD in the direction that is
 * safe for what it is: `up` for usage, so spend is never under-counted; `down` for limits and
 * balances, so nothing is promised that is not there.
 */
function toNano(value: unknown, what: string, round: "up" | "down"): bigint {
  if (!isRecord(value)) return wholeNumber(value, what);
  const amount = wholeNumber(value.amount, `${what}.amount`);
  const scale = Number(wholeNumber(value.scale, `${what}.scale`));
  if (scale < 0) return unexpected(`${what}.scale is negative`);
  if (scale <= NANO_SCALE) return amount * 10n ** BigInt(NANO_SCALE - scale);
  const divisor = 10n ** BigInt(scale - NANO_SCALE);
  const down = amount / divisor;
  return round === "up" && amount % divisor > 0n ? down + 1n : down;
}

/** Dollars per token from `{ amount, scale }`, for display only; null when it is not a price. */
function dollars(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const { amount, scale } = value;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) return null;
  if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > 30) return null;
  return amount / 10 ** scale;
}

/** A verifiable model with its prices per million tokens, or null for one that is not, or is malformed. */
function verifiableModel(model: unknown): { id: string; inputPerM: number; outputPerM: number } | null {
  if (!isRecord(model) || !isRecord(model.metadata) || model.metadata.verifiable !== true) return null;
  const input = dollars(model.inputCostPerToken);
  const output = dollars(model.outputCostPerToken);
  if (typeof model.modelId !== "string" || model.modelId === "" || input === null || output === null) return null;
  return { id: model.modelId, inputPerM: input * TOKENS_PER_MILLION, outputPerM: output * TOKENS_PER_MILLION };
}

/**
 * A spend limit as NEAR AI takes it. Below 1 nano-USD is refused before any request: NEAR AI reads a
 * `null` limit as unlimited and does not document 0, so a key must never be sent one. Above 2^53 − 1
 * (about $9 million) is refused too: a JSON number would carry another value than the one meant.
 */
function spendLimitBody(limitNano: bigint): { spendLimit: { amount: number; currency: "USD" } } {
  if (limitNano < 1n) throw new RangeError("spend limit below 1 nano-USD");
  if (limitNano > MAX_JSON_NANO) throw new RangeError("spend limit above what a JSON number holds exactly");
  return { spendLimit: { amount: Number(limitNano), currency: "USD" } };
}

/** A workspace key as the list shows it; `name` when NEAR AI states one. */
export type ListedKey = { id: string; name?: string; limitNano: bigint | null; usageNano: bigint };

export class NearAiClient {
  private readonly base: string;

  constructor(
    base: string,
    private readonly fetcher: typeof fetch,
    private readonly timeoutMs: number = UPSTREAM_TIMEOUT_MS,
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  private async request(method: string, path: string, token: string | undefined, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      text = await response.text();
    } catch (error) {
      if (signal.aborted) throw new NearAiError(0, `NEAR AI ${method} ${path.split("?")[0]} timed out after ${this.timeoutMs} ms`);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      throw new NearAiError(response.status, `NEAR AI ${method} ${path.split("?")[0]} failed with ${response.status}`, errorCode(parsed));
    }
    return parsed;
  }

  /**
   * Spends `refreshToken` and returns the new pair: the old refresh token is dead afterwards. An empty
   * refresh token is refused (nothing could be refreshed with it). An empty access token is returned
   * as it is, so the caller can still keep the new refresh token; `refreshOperator` refuses to use it.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt?: string }> {
    const body = await this.request("POST", "/users/me/access-tokens", refreshToken);
    if (!isRecord(body)) return unexpected("refresh answer");
    const { access_token: accessToken, refresh_token: newRefreshToken, refresh_token_expiration: expiration } = body;
    // Only the two tokens are required: the old refresh token is already spent, so the new pair must never be discarded.
    if (typeof accessToken !== "string" || typeof newRefreshToken !== "string" || newRefreshToken === "") {
      return unexpected("refresh answer fields");
    }
    return { accessToken, refreshToken: newRefreshToken, refreshExpiresAt: typeof expiration === "string" ? expiration : undefined };
  }

  async createKey(access: string, ws: string, name: string, limitNano: bigint): Promise<{ id: string; key: string }> {
    const body = await this.request("POST", `/workspaces/${segment(ws)}/api-keys`, access, { name, ...spendLimitBody(limitNano) });
    if (!isRecord(body) || typeof body.id !== "string" || typeof body.key !== "string") return unexpected("created key");
    return { id: body.id, key: body.key };
  }

  async setSpendLimit(access: string, ws: string, keyId: string, limitNano: bigint): Promise<void> {
    await this.request("PATCH", `/workspaces/${segment(ws)}/api-keys/${segment(keyId)}/spend-limit`, access, spendLimitBody(limitNano));
  }

  async revokeKey(access: string, ws: string, keyId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${segment(ws)}/api-keys/${segment(keyId)}`, access);
  }

  /**
   * Every key of the workspace. Pages are read by offset, so a key created meanwhile can shift a row
   * onto the next page; keys are therefore collected by id. Stops on an empty page or one that adds
   * nothing new (a server that ignores the offset), and throws past `MAX_KEY_PAGES`.
   */
  async listKeys(access: string, ws: string): Promise<ListedKey[]> {
    const keys = new Map<string, ListedKey>();
    let rowsRead = 0;
    let total = Number.POSITIVE_INFINITY;
    for (let pages = 0; rowsRead < total; pages += 1) {
      if (pages === MAX_KEY_PAGES) throw new Error(`NEAR AI key list has more than ${MAX_KEY_PAGES} pages`);
      const page = await this.request("GET", `/workspaces/${segment(ws)}/api-keys?limit=${PAGE_SIZE}&offset=${rowsRead}`, access);
      if (!isRecord(page) || !Array.isArray(page.api_keys) || typeof page.total !== "number") return unexpected("key list");
      total = page.total;
      const sizeBefore = keys.size;
      for (const item of page.api_keys) {
        if (!isRecord(item) || typeof item.id !== "string") return unexpected("key list item");
        keys.set(item.id, {
          id: item.id,
          ...(typeof item.name === "string" ? { name: item.name } : {}),
          limitNano: item.spend_limit == null ? null : toNano(item.spend_limit, "spend_limit", "down"),
          usageNano: item.usage == null ? 0n : toNano(item.usage, "usage", "up"),
        });
      }
      rowsRead += page.api_keys.length;
      if (keys.size === sizeBefore) break;
    }
    return [...keys.values()];
  }

  /** What the organization has left to spend; `null` upstream counts as nothing. */
  async orgRemainingNano(access: string, orgId: string): Promise<bigint> {
    const body = await this.request("GET", `/organizations/${segment(orgId)}/usage/balance`, access);
    if (!isRecord(body)) return unexpected("balance");
    return body.remaining == null ? 0n : toNano(body.remaining, "remaining", "down");
  }

  /**
   * Public (no credentials): the models NEAR AI marks verifiable, with prices per million tokens in
   * USD. A malformed model is left out rather than failing the list. When an answer states a `total`
   * above what was read, the next page is asked for by offset (unverified: NEAR AI's list has fit
   * one page so far), for at most 10 pages, stopping on a page that names no model not seen before.
   */
  async verifiableModels(): Promise<{ id: string; inputPerM: number; outputPerM: number }[]> {
    const models = new Map<string, { id: string; inputPerM: number; outputPerM: number }>();
    const seen = new Set<unknown>();
    let rowsRead = 0;
    for (let pages = 0; pages < MAX_MODEL_PAGES; pages += 1) {
      const query = pages === 0 ? "" : `?limit=${PAGE_SIZE}&offset=${rowsRead}`;
      const body = await this.request("GET", `/model/list${query}`, undefined);
      if (!isRecord(body) || !Array.isArray(body.models)) return unexpected("model list");
      const seenBefore = seen.size;
      for (const item of body.models) {
        seen.add(isRecord(item) ? item.modelId : item);
        const model = verifiableModel(item);
        if (model && !models.has(model.id)) models.set(model.id, model);
      }
      rowsRead += body.models.length;
      const total = typeof body.total === "number" ? body.total : 0;
      if (body.models.length === 0 || rowsRead >= total || seen.size === seenBefore) break;
    }
    return [...models.values()];
  }
}
