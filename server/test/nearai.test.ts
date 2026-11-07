import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { spendLimitNano } from "../src/credits";
import { decrypt } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { NearAiClient, NearAiError } from "../src/nearai";
import { hangUntilAborted } from "./fakes";

const ledgerEnv = env as unknown as Env;
const cfg = parseConfig(ledgerEnv);
const BASE = "https://near.test/v1";
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const KEY = btoa("k".repeat(32));
const SEED = "seed-refresh-token";

type Call = { url: string; method: string; headers: Headers; body: unknown };
type Route = (call: Call) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A `fetch` that records every request and answers it from `route`. */
function stubFetch(route: Route): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

function callAt(calls: Call[], index: number): Call {
  const call = calls[index];
  if (!call) throw new Error(`expected a request at index ${index}, saw ${calls.length}`);
  return call;
}

describe("NearAiClient", () => {
  it("refreshes with the refresh token and maps the response", async () => {
    const { fetcher, calls } = stubFetch(() =>
      json({ access_token: "acc-1", refresh_token: "ref-2", refresh_token_expiration: "2026-12-01T00:00:00Z" }),
    );
    const result = await new NearAiClient(BASE, fetcher).refresh("ref-1");
    expect(result).toEqual({ accessToken: "acc-1", refreshToken: "ref-2", refreshExpiresAt: "2026-12-01T00:00:00Z" });
    expect(calls).toHaveLength(1);
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/users/me/access-tokens`, method: "POST" });
    expect(callAt(calls, 0).headers.get("authorization")).toBe("Bearer ref-1");
  });

  it("creates a key with a spend limit in nano-USD", async () => {
    const { fetcher, calls } = stubFetch(() => json({ id: "key-1", key: "sk-secret" }));
    const result = await new NearAiClient(BASE, fetcher).createKey("acc", "ws-1", "zorvo-d1", spendLimitNano(500, cfg));
    expect(result).toEqual({ id: "key-1", key: "sk-secret" });
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/workspaces/ws-1/api-keys`, method: "POST" });
    expect(callAt(calls, 0).headers.get("authorization")).toBe("Bearer acc");
    expect(callAt(calls, 0).body).toEqual({ name: "zorvo-d1", spendLimit: { amount: 4166666666, currency: "USD" } });
  });

  it("sets an absolute spend limit with PATCH", async () => {
    const { fetcher, calls } = stubFetch(() => json({}));
    await new NearAiClient(BASE, fetcher).setSpendLimit("acc", "ws-1", "key-1", 8_333_333_333n);
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/workspaces/ws-1/api-keys/key-1/spend-limit`, method: "PATCH" });
    expect(callAt(calls, 0).headers.get("authorization")).toBe("Bearer acc");
    expect(callAt(calls, 0).body).toEqual({ spendLimit: { amount: 8333333333, currency: "USD" } });
  });

  it("revokes a key with DELETE", async () => {
    const { fetcher, calls } = stubFetch(() => new Response(null, { status: 204 }));
    await new NearAiClient(BASE, fetcher).revokeKey("acc", "ws-1", "key-1");
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/workspaces/ws-1/api-keys/key-1`, method: "DELETE" });
    expect(callAt(calls, 0).headers.get("authorization")).toBe("Bearer acc");
  });

  it("lists keys across pages and converts prices to nano-USD", async () => {
    const { fetcher, calls } = stubFetch(({ url }) => {
      const offset = new URL(url).searchParams.get("offset");
      if (offset === "0") {
        return json({
          api_keys: [
            { id: "a", spend_limit: { amount: 5_000_000_000, scale: 9 }, usage: { amount: 25, scale: 2 } },
            { id: "b", spend_limit: null, usage: { amount: 0, scale: 9 } },
          ],
          total: 3,
        });
      }
      return json({ api_keys: [{ id: "c", spend_limit: { amount: 2, scale: 0 }, usage: { amount: 123456789012, scale: 11 } }], total: 3 });
    });
    const keys = await new NearAiClient(BASE, fetcher).listKeys("acc", "ws-1");
    expect(keys).toEqual([
      { id: "a", limitNano: 5_000_000_000n, usageNano: 250_000_000n },
      { id: "b", limitNano: null, usageNano: 0n },
      { id: "c", limitNano: 2_000_000_000n, usageNano: 1_234_567_890n },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/workspaces/ws-1/api-keys?limit=100&offset=0`,
      `${BASE}/workspaces/ws-1/api-keys?limit=100&offset=2`,
    ]);
    expect(calls.every((call) => call.method === "GET" && call.headers.get("authorization") === "Bearer acc")).toBe(true);
  });

  it("keeps a new refresh token that arrives without an expiry", async () => {
    const { fetcher } = stubFetch(() => json({ access_token: "acc-1", refresh_token: "ref-2" }));
    const result = await new NearAiClient(BASE, fetcher).refresh("ref-1");
    expect(result).toEqual({ accessToken: "acc-1", refreshToken: "ref-2", refreshExpiresAt: undefined });
  });

  it("drops a key that reappears on the next page", async () => {
    const item = (id: string) => ({ id, spend_limit: null, usage: null });
    const { fetcher } = stubFetch(({ url }) =>
      new URL(url).searchParams.get("offset") === "0"
        ? json({ api_keys: [item("a"), item("b")], total: 3 })
        : json({ api_keys: [item("b"), item("c")], total: 3 }),
    );
    const keys = await new NearAiClient(BASE, fetcher).listKeys("acc", "ws-1");
    expect(keys.map((key) => key.id)).toEqual(["a", "b", "c"]);
  });

  it("stops on an empty page even when total promises more", async () => {
    const { fetcher, calls } = stubFetch(({ url }) =>
      new URL(url).searchParams.get("offset") === "0"
        ? json({ api_keys: [{ id: "a", spend_limit: null, usage: null }], total: 5 })
        : json({ api_keys: [], total: 5 }),
    );
    const keys = await new NearAiClient(BASE, fetcher).listKeys("acc", "ws-1");
    expect(keys.map((key) => key.id)).toEqual(["a"]);
    expect(calls).toHaveLength(2);
  });

  it("stops when the server ignores the offset and repeats the first page", async () => {
    const { fetcher, calls } = stubFetch(() =>
      json({ api_keys: [{ id: "a", spend_limit: null, usage: null }, { id: "b", spend_limit: null, usage: null }], total: 10 }),
    );
    const keys = await new NearAiClient(BASE, fetcher).listKeys("acc", "ws-1");
    expect(keys.map((key) => key.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });

  it("throws past the page cap instead of looping", async () => {
    let n = 0;
    const { fetcher, calls } = stubFetch(() => json({ api_keys: [{ id: `k${(n += 1)}`, spend_limit: null, usage: null }], total: 1_000_000 }));
    await expect(new NearAiClient(BASE, fetcher).listKeys("acc", "ws-1")).rejects.toThrow(/more than 50 pages/);
    expect(calls).toHaveLength(50);
  });

  it("reads the organization balance, with null counting as zero", async () => {
    const { fetcher, calls } = stubFetch(() => json({ remaining: { amount: 12_500_000_000, scale: 9 } }));
    expect(await new NearAiClient(BASE, fetcher).orgRemainingNano("acc", "org-1")).toBe(12_500_000_000n);
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/organizations/org-1/usage/balance`, method: "GET" });
    expect(callAt(calls, 0).headers.get("authorization")).toBe("Bearer acc");

    const empty = stubFetch(() => json({ remaining: null }));
    expect(await new NearAiClient(BASE, empty.fetcher).orgRemainingNano("acc", "org-1")).toBe(0n);

    const plain = stubFetch(() => json({ remaining: 7_000_000_000 }));
    expect(await new NearAiClient(BASE, plain.fetcher).orgRemainingNano("acc", "org-1")).toBe(7_000_000_000n);
  });

  it("lists only verifiable models, with prices per million tokens and no credentials", async () => {
    const { fetcher, calls } = stubFetch(() =>
      json({
        models: [
          { modelId: "m/one", inputCostPerToken: { amount: 15, scale: 8 }, outputCostPerToken: { amount: 3, scale: 7 }, metadata: { verifiable: true } },
          { modelId: "m/two", inputCostPerToken: { amount: 1, scale: 6 }, outputCostPerToken: { amount: 1, scale: 6 }, metadata: { verifiable: false } },
        ],
      }),
    );
    const models = await new NearAiClient(BASE, fetcher).verifiableModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("m/one");
    expect(models[0]?.inputPerM).toBeCloseTo(0.15, 10);
    expect(models[0]?.outputPerM).toBeCloseTo(0.3, 10);
    expect(callAt(calls, 0)).toMatchObject({ url: `${BASE}/model/list`, method: "GET" });
    expect(callAt(calls, 0).headers.has("authorization")).toBe(false);
  });

  it("throws a NearAiError with the status and code on a non-2xx answer", async () => {
    const { fetcher } = stubFetch(() => json({ error: "invalid_token" }, 401));
    const failure = await new NearAiClient(BASE, fetcher).orgRemainingNano("acc", "org-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NearAiError);
    expect(failure).toMatchObject({ status: 401, code: "invalid_token" });
    expect(String((failure as Error).message)).not.toContain("acc");
  });

  it("throws a NearAiError without a code when the body is not JSON", async () => {
    const { fetcher } = stubFetch(() => new Response("bad gateway", { status: 502 }));
    const failure = await new NearAiClient(BASE, fetcher).revokeKey("acc", "ws", "k").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NearAiError);
    expect((failure as NearAiError).status).toBe(502);
    expect((failure as NearAiError).code).toBeUndefined();
  });

  it("gives up on a request that never answers, as a NearAiError that does not name the token", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return hangUntilAborted(init?.signal);
    }) as typeof fetch;
    const failure = await new NearAiClient(BASE, fetcher, 20).orgRemainingNano("secret-access", "org-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NearAiError);
    expect((failure as Error).message).toMatch(/timed out/);
    expect((failure as Error).message).not.toContain("secret-access");
    expect(signals[0]?.aborted).toBe(true);
  });
});

const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

/** Runs `body` inside the Ledger with test secrets and the stubbed `fetch` in place. */
async function withLedger<T>(
  fetcher: typeof fetch,
  body: (ledger: Ledger, sql: SqlStorage) => Promise<T> | T,
  secrets: Partial<Env> = { KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: SEED },
): Promise<T> {
  return runInDurableObject(stub(), async (ledger: Ledger, state) => {
    (ledger as unknown as { env: Env }).env = { ...ledgerEnv, ...secrets };
    ledger.fetcher = fetcher;
    return body(ledger, state.storage.sql);
  });
}

beforeEach(async () => {
  await runInDurableObject(stub(), (_ledger, state) => {
    for (const table of ["operator", "key_usage", "snapshot", "devices"]) state.storage.sql.exec(`DELETE FROM ${table}`);
  });
});

describe("Ledger.accessToken", () => {
  const refreshRoute = (n: { value: number }): Route => () => {
    n.value += 1;
    return json({
      access_token: `acc-${n.value}`,
      refresh_token: `ref-${n.value}`,
      refresh_token_expiration: "2026-12-01T00:00:00Z",
    });
  };

  it("seeds from the secret, stores the new refresh token encrypted, and caches the access token", async () => {
    const counter = { value: 0 };
    const { fetcher, calls } = stubFetch(refreshRoute(counter));
    await withLedger(fetcher, async (ledger, sql) => {
      expect(await ledger.accessToken(NOW)).toBe("acc-1");
      expect(calls).toHaveLength(1);
      expect(callAt(calls, 0).headers.get("authorization")).toBe(`Bearer ${SEED}`);
      const row = sql.exec<{ refresh_token_ciphertext: string; version: number }>("SELECT refresh_token_ciphertext, version FROM operator").one();
      expect(row.refresh_token_ciphertext).not.toContain("ref-1");
      expect(await decrypt(KEY, row.refresh_token_ciphertext)).toBe("ref-1");
      expect(row.version).toBe(1);

      expect(await ledger.accessToken(NOW + 10 * MINUTE_MS)).toBe("acc-1");
      expect(calls).toHaveLength(1);
    });
  });

  it("refreshes again with the stored token once the access token is within a minute of expiry", async () => {
    const counter = { value: 0 };
    const { fetcher, calls } = stubFetch(refreshRoute(counter));
    await withLedger(fetcher, async (ledger, sql) => {
      await ledger.accessToken(NOW);
      expect(await ledger.accessToken(NOW + 29 * MINUTE_MS + 30_000)).toBe("acc-2");
      expect(calls).toHaveLength(2);
      expect(callAt(calls, 1).headers.get("authorization")).toBe("Bearer ref-1");
      const row = sql.exec<{ refresh_token_ciphertext: string; version: number }>("SELECT refresh_token_ciphertext, version FROM operator").one();
      expect(await decrypt(KEY, row.refresh_token_ciphertext)).toBe("ref-2");
      expect(row.version).toBe(2);
    });
  });

  it("makes one refresh request for two concurrent callers and keeps the token the stub returned (race 6)", async () => {
    const counter = { value: 0 };
    const { fetcher, calls } = stubFetch(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return refreshRoute(counter)(call);
    });
    await withLedger(fetcher, async (ledger, sql) => {
      const [first, second] = await Promise.all([ledger.accessToken(NOW), ledger.accessToken(NOW)]);
      expect(first).toBe("acc-1");
      expect(second).toBe("acc-1");
      expect(calls).toHaveLength(1);
      const row = sql.exec<{ refresh_token_ciphertext: string }>("SELECT refresh_token_ciphertext FROM operator").one();
      expect(await decrypt(KEY, row.refresh_token_ciphertext)).toBe("ref-1");
    });
  });

  it("stores the new pair when the answer has no refresh expiry", async () => {
    const { fetcher } = stubFetch(() => json({ access_token: "acc-1", refresh_token: "ref-1" }));
    await withLedger(fetcher, async (ledger, sql) => {
      expect(await ledger.accessToken(NOW)).toBe("acc-1");
      const row = sql.exec<{ refresh_token_ciphertext: string }>("SELECT refresh_token_ciphertext FROM operator").one();
      expect(await decrypt(KEY, row.refresh_token_ciphertext)).toBe("ref-1");
    });
  });

  it("allows a later refresh after a failed one", async () => {
    let fail = true;
    const counter = { value: 0 };
    const { fetcher, calls } = stubFetch((call) => (fail ? json({ error: "nope" }, 401) : refreshRoute(counter)(call)));
    await withLedger(fetcher, async (ledger) => {
      await expect(ledger.accessToken(NOW)).rejects.toMatchObject({ status: 401 });
      fail = false;
      expect(await ledger.accessToken(NOW)).toBe("acc-1");
      expect(calls).toHaveLength(2);
      expect(callAt(calls, 1).headers.get("authorization")).toBe(`Bearer ${SEED}`);
    });
  });

  it("fails clearly when neither a stored token nor the secret exists", async () => {
    const { fetcher, calls } = stubFetch(() => json({}));
    await withLedger(
      fetcher,
      async (ledger) => {
        await expect(ledger.accessToken(NOW)).rejects.toThrow(/OPERATOR_REFRESH_TOKEN/);
        expect(calls).toHaveLength(0);
      },
      { KEY_ENCRYPTION_KEY: KEY },
    );
  });
});

describe("Ledger.refreshSnapshot", () => {
  const USD = 1_000_000_000;

  function nearAiRoute(balance: unknown, keys: unknown[]): Route {
    return ({ url }) => {
      if (url.endsWith("/users/me/access-tokens")) {
        return json({ access_token: "acc", refresh_token: "ref", refresh_token_expiration: "2026-12-01T00:00:00Z" });
      }
      if (url.includes("/usage/balance")) return json({ remaining: balance });
      return json({ api_keys: keys, total: keys.length });
    };
  }

  const key = (id: string, limit: number | null, usage: number) => ({
    id,
    spend_limit: limit === null ? null : { amount: limit, scale: 9 },
    usage: { amount: usage, scale: 9 },
  });

  async function addDevice(sql: SqlStorage, id: string, keyId: string | null) {
    sql.exec("INSERT INTO devices (id, secret_hash, nearai_key_id, created_at) VALUES (?, ?, ?, ?)", id, `hash-${id}`, keyId, NOW);
  }

  const snapshotRow = (sql: SqlStorage) =>
    sql
      .exec<{ org_remaining_usd: number; outstanding_usd: number; taken_at: number }>(
        "SELECT org_remaining_usd, outstanding_usd, taken_at FROM snapshot",
      )
      .one();
  const usageRows = (sql: SqlStorage) =>
    sql.exec<{ key_id: string; limit_nano: number | null; usage_nano: number }>("SELECT * FROM key_usage ORDER BY key_id").toArray();

  it("sums the unspent part of the device keys only and stores their usage", async () => {
    const { fetcher, calls } = stubFetch(
      nearAiRoute({ amount: 20 * USD, scale: 9 }, [key("k1", 5 * USD, 1 * USD), key("k2", 3 * USD, 4 * USD), key("other", 9 * USD, 0)]),
    );
    await withLedger(fetcher, async (ledger, sql) => {
      addDevice(sql, "d1", "k1");
      addDevice(sql, "d2", "k2");
      addDevice(sql, "d3", null);
      await ledger.refreshSnapshot(NOW);
      expect(snapshotRow(sql)).toEqual({ org_remaining_usd: 20 * USD, outstanding_usd: 4 * USD, taken_at: NOW });
      expect(usageRows(sql)).toEqual([
        { key_id: "k1", limit_nano: 5 * USD, usage_nano: 1 * USD },
        { key_id: "k2", limit_nano: 3 * USD, usage_nano: 4 * USD },
      ]);
      expect(calls.some((call) => call.url.includes("/organizations/") && call.url.includes("/usage/balance"))).toBe(true);
    });
  });

  it("replaces earlier key_usage rows", async () => {
    const { fetcher } = stubFetch(nearAiRoute({ amount: 5 * USD, scale: 9 }, [key("k1", 2 * USD, 0)]));
    await withLedger(fetcher, async (ledger, sql) => {
      sql.exec("INSERT INTO key_usage (key_id, limit_nano, usage_nano) VALUES ('gone', 1, 1)");
      addDevice(sql, "d1", "k1");
      await ledger.refreshSnapshot(NOW);
      expect(usageRows(sql).map((row) => row.key_id)).toEqual(["k1"]);
    });
  });

  it("clamps odd upstream values so the snapshot still updates", async () => {
    const { fetcher } = stubFetch(
      nearAiRoute({ amount: -5 * USD, scale: 9 }, [key("k1", 9_007_199_254_740_000_000, 0), key("k2", null, 3 * USD)]),
    );
    await withLedger(fetcher, async (ledger, sql) => {
      addDevice(sql, "d1", "k1");
      addDevice(sql, "d2", "k2");
      await ledger.refreshSnapshot(NOW);
      expect(snapshotRow(sql)).toEqual({
        org_remaining_usd: 0,
        outstanding_usd: Number.MAX_SAFE_INTEGER,
        taken_at: NOW,
      });
      expect(usageRows(sql).find((row) => row.key_id === "k2")).toEqual({ key_id: "k2", limit_nano: null, usage_nano: 3 * USD });
    });
  });

  it("completes with the right totals when a key repeats across pages", async () => {
    const pages: Record<string, unknown[]> = {
      "0": [key("k1", 5 * USD, 1 * USD), key("k2", 3 * USD, 0)],
      "2": [key("k2", 3 * USD, 0), key("k3", 2 * USD, 1 * USD)],
    };
    const { fetcher } = stubFetch(({ url }) => {
      if (url.endsWith("/users/me/access-tokens")) return json({ access_token: "acc", refresh_token: "ref" });
      if (url.includes("/usage/balance")) return json({ remaining: 20 * USD });
      return json({ api_keys: pages[new URL(url).searchParams.get("offset") ?? ""] ?? [], total: 4 });
    });
    await withLedger(fetcher, async (ledger, sql) => {
      for (const id of ["k1", "k2", "k3"]) addDevice(sql, `d-${id}`, id);
      await ledger.refreshSnapshot(NOW);
      expect(snapshotRow(sql)).toEqual({ org_remaining_usd: 20 * USD, outstanding_usd: 8 * USD, taken_at: NOW });
      expect(usageRows(sql).map((row) => row.key_id)).toEqual(["k1", "k2", "k3"]);
    });
  });

  it("leaves the previous key_usage and snapshot intact when the replacement fails midway", async () => {
    const { fetcher } = stubFetch(nearAiRoute({ amount: 20 * USD, scale: 9 }, [key("k1", 5 * USD, 0), key("k2", 3 * USD, 0)]));
    await withLedger(fetcher, async (ledger, sql) => {
      addDevice(sql, "d1", "k1");
      addDevice(sql, "d2", "k2");
      await ledger.refreshSnapshot(NOW);
      const before = { usage: usageRows(sql), snapshot: snapshotRow(sql) };
      expect(before.usage).toHaveLength(2);

      sql.exec(
        "CREATE TRIGGER fail_k2 BEFORE INSERT ON key_usage WHEN NEW.key_id = 'k2' BEGIN SELECT RAISE(ABORT, 'boom'); END",
      );
      try {
        await expect(ledger.refreshSnapshot(NOW + 1)).rejects.toThrow(/boom/);
        expect({ usage: usageRows(sql), snapshot: snapshotRow(sql) }).toEqual(before);
      } finally {
        sql.exec("DROP TRIGGER fail_k2");
      }
    });
  });

  describe("when the cached access token is refused", () => {
    function route(tokens: { refreshes: number }, balanceStatus: (bearer: string | null) => number): Route {
      return ({ url, headers }) => {
        if (url.endsWith("/users/me/access-tokens")) {
          tokens.refreshes += 1;
          return json({ access_token: `acc-${tokens.refreshes}`, refresh_token: `ref-${tokens.refreshes}` });
        }
        if (url.includes("/usage/balance")) {
          const status = balanceStatus(headers.get("authorization"));
          return status === 200 ? json({ remaining: 7 * USD }) : json({ error: "invalid_token" }, status);
        }
        return json({ api_keys: [], total: 0 });
      };
    }

    it("refreshes once and retries the call with the new token", async () => {
      const tokens = { refreshes: 0 };
      const { fetcher } = stubFetch(route(tokens, (bearer) => (bearer === "Bearer acc-1" ? 401 : 200)));
      await withLedger(fetcher, async (ledger, sql) => {
        expect(await ledger.accessToken(NOW)).toBe("acc-1");
        await ledger.refreshSnapshot(NOW + 1000);
        expect(tokens.refreshes).toBe(2);
        expect(snapshotRow(sql).org_remaining_usd).toBe(7 * USD);
        expect(await ledger.accessToken(NOW + 2000)).toBe("acc-2");
        expect(tokens.refreshes).toBe(2);
      });
    });

    it("surfaces a second refusal without looping", async () => {
      const tokens = { refreshes: 0 };
      const { fetcher } = stubFetch(route(tokens, () => 401));
      await withLedger(fetcher, async (ledger) => {
        await expect(ledger.refreshSnapshot(NOW)).rejects.toMatchObject({ name: "NearAiError", status: 401 });
        expect(tokens.refreshes).toBe(2);
      });
    });

    it("makes one refresh when two callers are refused the same token", async () => {
      const tokens = { refreshes: 0 };
      const { fetcher } = stubFetch(route(tokens, (bearer) => (bearer === "Bearer acc-1" ? 401 : 200)));
      await withLedger(fetcher, async (ledger) => {
        await ledger.accessToken(NOW);
        await Promise.all([ledger.refreshSnapshot(NOW + 1000), ledger.refreshSnapshot(NOW + 1000)]);
        expect(tokens.refreshes).toBe(2);
      });
    });
  });
});
