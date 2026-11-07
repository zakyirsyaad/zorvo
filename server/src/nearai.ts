import { UPSTREAM_TIMEOUT_MS } from "./http";

/** The part of the NEAR AI Cloud API the credits server uses. Amounts it returns are scale 9 (nano-USD) in the results. */

const NANO_SCALE = 9;
const PAGE_SIZE = 100;
/** A key list longer than this many pages is treated as a fault, not paged through. */
const MAX_KEY_PAGES = 50;
const TOKENS_PER_MILLION = 1e6;

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

/** The error code in a NEAR AI error body: `{ "error": "code" }`, `{ "code": "code" }` or `{ "error": { "code": "code" } }`. */
function errorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.error === "string") return body.error;
  if (typeof body.code === "string") return body.code;
  if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code;
  return undefined;
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

/** `{ amount, scale }` (the value is amount / 10^scale dollars) or a bare whole number of nano-USD, as nano-USD. */
function toNano(value: unknown, what: string): bigint {
  if (!isRecord(value)) return wholeNumber(value, what);
  const amount = wholeNumber(value.amount, `${what}.amount`);
  const scale = Number(wholeNumber(value.scale, `${what}.scale`));
  if (scale < 0) return unexpected(`${what}.scale is negative`);
  return scale <= NANO_SCALE ? amount * 10n ** BigInt(NANO_SCALE - scale) : amount / 10n ** BigInt(scale - NANO_SCALE);
}

/** Dollars per token from `{ amount, scale }`, for display only. */
function dollars(value: unknown, what: string): number {
  if (!isRecord(value)) return unexpected(`${what} is not a price`);
  return Number(wholeNumber(value.amount, `${what}.amount`)) / 10 ** Number(wholeNumber(value.scale, `${what}.scale`));
}

function spendLimitBody(limitNano: bigint): { spendLimit: { amount: number; currency: "USD" } } {
  return { spendLimit: { amount: Number(limitNano), currency: "USD" } };
}

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

  /** Spends `refreshToken` and returns the new pair: the old refresh token is dead afterwards. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt?: string }> {
    const body = await this.request("POST", "/users/me/access-tokens", refreshToken);
    if (!isRecord(body)) return unexpected("refresh answer");
    const { access_token: accessToken, refresh_token: newRefreshToken, refresh_token_expiration: expiration } = body;
    // Only the two tokens are required: the old refresh token is already spent, so the new pair must never be discarded.
    if (typeof accessToken !== "string" || typeof newRefreshToken !== "string") return unexpected("refresh answer fields");
    return { accessToken, refreshToken: newRefreshToken, refreshExpiresAt: typeof expiration === "string" ? expiration : undefined };
  }

  async createKey(access: string, ws: string, name: string, limitNano: bigint): Promise<{ id: string; key: string }> {
    const body = await this.request("POST", `/workspaces/${ws}/api-keys`, access, { name, ...spendLimitBody(limitNano) });
    if (!isRecord(body) || typeof body.id !== "string" || typeof body.key !== "string") return unexpected("created key");
    return { id: body.id, key: body.key };
  }

  async setSpendLimit(access: string, ws: string, keyId: string, limitNano: bigint): Promise<void> {
    await this.request("PATCH", `/workspaces/${ws}/api-keys/${keyId}/spend-limit`, access, spendLimitBody(limitNano));
  }

  async revokeKey(access: string, ws: string, keyId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${ws}/api-keys/${keyId}`, access);
  }

  /**
   * Every key of the workspace. Pages are read by offset, so a key created meanwhile can shift a row
   * onto the next page; keys are therefore collected by id. Stops on an empty page or one that adds
   * nothing new (a server that ignores the offset), and throws past `MAX_KEY_PAGES`.
   */
  async listKeys(access: string, ws: string): Promise<{ id: string; limitNano: bigint | null; usageNano: bigint }[]> {
    const keys = new Map<string, { id: string; limitNano: bigint | null; usageNano: bigint }>();
    let rowsRead = 0;
    let total = Number.POSITIVE_INFINITY;
    for (let pages = 0; rowsRead < total; pages += 1) {
      if (pages === MAX_KEY_PAGES) throw new Error(`NEAR AI key list has more than ${MAX_KEY_PAGES} pages`);
      const page = await this.request("GET", `/workspaces/${ws}/api-keys?limit=${PAGE_SIZE}&offset=${rowsRead}`, access);
      if (!isRecord(page) || !Array.isArray(page.api_keys) || typeof page.total !== "number") return unexpected("key list");
      total = page.total;
      const sizeBefore = keys.size;
      for (const item of page.api_keys) {
        if (!isRecord(item) || typeof item.id !== "string") return unexpected("key list item");
        keys.set(item.id, {
          id: item.id,
          limitNano: item.spend_limit == null ? null : toNano(item.spend_limit, "spend_limit"),
          usageNano: item.usage == null ? 0n : toNano(item.usage, "usage"),
        });
      }
      rowsRead += page.api_keys.length;
      if (keys.size === sizeBefore) break;
    }
    return [...keys.values()];
  }

  /** What the organization has left to spend; `null` upstream counts as nothing. */
  async orgRemainingNano(access: string, orgId: string): Promise<bigint> {
    const body = await this.request("GET", `/organizations/${orgId}/usage/balance`, access);
    if (!isRecord(body)) return unexpected("balance");
    return body.remaining == null ? 0n : toNano(body.remaining, "remaining");
  }

  /** Public (no credentials): the models NEAR AI marks verifiable, with prices per million tokens in USD. */
  async verifiableModels(): Promise<{ id: string; inputPerM: number; outputPerM: number }[]> {
    const body = await this.request("GET", "/model/list", undefined);
    if (!isRecord(body) || !Array.isArray(body.models)) return unexpected("model list");
    return body.models.flatMap((model: unknown) => {
      if (!isRecord(model) || !isRecord(model.metadata) || model.metadata.verifiable !== true) return [];
      if (typeof model.modelId !== "string") return unexpected("model id");
      return [
        {
          id: model.modelId,
          inputPerM: dollars(model.inputCostPerToken, "inputCostPerToken") * TOKENS_PER_MILLION,
          outputPerM: dollars(model.outputCostPerToken, "outputCostPerToken") * TOKENS_PER_MILLION,
        },
      ];
    });
  }
}
