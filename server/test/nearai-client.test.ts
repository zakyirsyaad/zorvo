import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config";
import { decrypt } from "../src/crypto";
import type { Ledger } from "../src/ledger/Ledger";
import { NearAiClient, NearAiError } from "../src/nearai";

/** The NEAR AI client's edges: amounts, paths, error codes, odd model lists and empty tokens. */

const ledgerEnv = env as unknown as Env;
const BASE = "https://near.test/v1";
const NOW = 1_800_000_000_000;
const KEY = btoa("k".repeat(32));
const TWO_53 = 2n ** 53n;

type Call = { url: string; method: string; headers: Headers };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(route: (call: Call) => Response): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

const price = (amount: number) => ({ amount, scale: 9 });
const model = (modelId: unknown, extra: Record<string, unknown> = {}) => ({
  modelId,
  inputCostPerToken: price(1),
  outputCostPerToken: price(2),
  metadata: { verifiable: true },
  ...extra,
});

describe("spend limits NEAR AI is sent", () => {
  it("refuses a limit a JSON number cannot hold exactly, before any request", async () => {
    const { fetcher, calls } = stubFetch(() => json({}));
    const client = new NearAiClient(BASE, fetcher);
    await expect(client.setSpendLimit("acc", "ws", "k", TWO_53 + 1n)).rejects.toThrow(RangeError);
    await expect(client.createKey("acc", "ws", "zorvo-d", TWO_53 + 1n)).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
    await client.setSpendLimit("acc", "ws", "k", TWO_53 - 1n);
    expect(calls).toHaveLength(1);
  });
});

describe("amounts finer than a nano-USD", () => {
  it("rounds a key's usage up and its limit and the organization balance down", async () => {
    const fine = { amount: 1999, scale: 12 };
    const { fetcher } = stubFetch(({ url }) =>
      url.includes("/usage/balance")
        ? json({ remaining: fine })
        : json({ api_keys: [{ id: "k1", spend_limit: fine, usage: { amount: 1, scale: 12 } }], total: 1 }),
    );
    const client = new NearAiClient(BASE, fetcher);
    expect(await client.listKeys("acc", "ws")).toEqual([{ id: "k1", limitNano: 1n, usageNano: 1n }]);
    expect(await client.orgRemainingNano("acc", "org")).toBe(1n);
  });
});

describe("path segments", () => {
  it("encodes the workspace, key and organization ids", async () => {
    const { fetcher, calls } = stubFetch(({ url }) => (url.includes("/usage/balance") ? json({ remaining: 0 }) : json({})));
    const client = new NearAiClient(BASE, fetcher);
    await client.revokeKey("acc", "ws/1", "k/../x?y");
    await client.setSpendLimit("acc", "ws 1", "k#1", 5n);
    await client.orgRemainingNano("acc", "org/../2");
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/workspaces/ws%2F1/api-keys/k%2F..%2Fx%3Fy`,
      `${BASE}/workspaces/ws%201/api-keys/k%231/spend-limit`,
      `${BASE}/organizations/org%2F..%2F2/usage/balance`,
    ]);
  });
});

describe("upstream error codes", () => {
  it("keeps only a short code of safe characters", async () => {
    const { fetcher } = stubFetch(() => json({ error: `${"x".repeat(500)}\n‮evil` }, 400));
    const failure = (await new NearAiClient(BASE, fetcher).revokeKey("acc", "ws", "k").catch((error: unknown) => error)) as NearAiError;
    expect(failure).toBeInstanceOf(NearAiError);
    expect(failure.code).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
  });

  it("drops a code with nothing safe in it", async () => {
    const { fetcher } = stubFetch(() => json({ error: "‮\n " }, 400));
    const failure = (await new NearAiClient(BASE, fetcher).revokeKey("acc", "ws", "k").catch((error: unknown) => error)) as NearAiError;
    expect(failure.code).toBeUndefined();
  });
});

describe("verifiableModels", () => {
  it("skips a malformed model instead of failing the whole list", async () => {
    const { fetcher } = stubFetch(() =>
      json({
        models: [
          model(5),
          model("m/ok"),
          model("m/bad-price", { inputCostPerToken: "free" }),
          model("m/negative-scale", { outputCostPerToken: { amount: 1, scale: -1 } }),
          "not a model",
        ],
      }),
    );
    expect((await new NearAiClient(BASE, fetcher).verifiableModels()).map((m) => m.id)).toEqual(["m/ok"]);
  });

  it("reads the following pages when the answer says there are more", async () => {
    const { fetcher, calls } = stubFetch(({ url }) => {
      const offset = Number(new URL(url).searchParams.get("offset") ?? "0");
      return json({ models: [model(`m/${offset}`)], total: 3 });
    });
    expect((await new NearAiClient(BASE, fetcher).verifiableModels()).map((m) => m.id)).toEqual(["m/0", "m/1", "m/2"]);
    expect(calls.map((call) => new URL(call.url).search)).toEqual(["", "?limit=100&offset=1", "?limit=100&offset=2"]);
  });

  it("stops after 10 pages and keeps what it read", async () => {
    let page = 0;
    const { fetcher, calls } = stubFetch(() => json({ models: [model(`m/${(page += 1)}`)], total: 1_000 }));
    expect(await new NearAiClient(BASE, fetcher).verifiableModels()).toHaveLength(10);
    expect(calls).toHaveLength(10);
  });
});

describe("empty tokens from a refresh", () => {
  const stub = () => ledgerEnv.LEDGER.get(ledgerEnv.LEDGER.idFromName("ledger"));

  beforeEach(async () => {
    await runInDurableObject(stub(), (_ledger, state) => state.storage.sql.exec("DELETE FROM operator"));
  });

  it("refuses an answer with an empty refresh token", async () => {
    const { fetcher } = stubFetch(() => json({ access_token: "acc", refresh_token: "" }));
    await expect(new NearAiClient(BASE, fetcher).refresh("ref-1")).rejects.toThrow(/refresh answer/);
  });

  it("keeps the new refresh token but not an empty access token, and refreshes with it next time", async () => {
    let answer = { access_token: "", refresh_token: "ref-2" };
    const { fetcher, calls } = stubFetch(() => json(answer));
    await runInDurableObject(stub(), async (ledger: Ledger, state) => {
      (ledger as unknown as { env: Env }).env = { ...ledgerEnv, KEY_ENCRYPTION_KEY: KEY, OPERATOR_REFRESH_TOKEN: "seed" };
      ledger.fetcher = fetcher;
      await expect(ledger.accessToken(NOW)).rejects.toThrow(/empty access token/);
      const row = state.storage.sql
        .exec<{ refresh_token_ciphertext: string; access_token: string | null }>("SELECT refresh_token_ciphertext, access_token FROM operator")
        .one();
      expect(await decrypt(KEY, row.refresh_token_ciphertext)).toBe("ref-2");
      expect(row.access_token).toBeNull();

      answer = { access_token: "acc-3", refresh_token: "ref-3" };
      expect(await ledger.accessToken(NOW + 1000)).toBe("acc-3");
      expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer ref-2");
    });
  });
});
