import { env } from "cloudflare:workers";
import { parseConfig, type Env } from "../src/config";
import { NEAR_USDC_ASSET_ID } from "../src/pingpay";

/** Test doubles shared by the server tests. */

const cfg = parseConfig(env as unknown as Env);
const MINUTE_MS = 60_000;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type SessionStatus = "CREATED" | "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED";

/** A response that never comes: it rejects with the signal's reason once the caller gives up. */
export function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

/** A stand-in for PingPay: sessions it created, their payments, and every request it saw. */
export class FakePingPay {
  sessions = new Map<
    string,
    { status: SessionStatus; paymentId: string | null; body: Record<string, unknown>; amount: Record<string, unknown> }
  >();
  payments = new Map<string, string>();
  calls: { method: string; url: string; apiKey: string | null }[] = [];
  failCreate = false;
  failReads = false;
  /** The amount a new session's answer states; by default what was asked, in NEAR USDC. */
  answerAmount = (requested: unknown): Record<string, unknown> => ({ assetId: NEAR_USDC_ASSET_ID, amount: requested });
  /** How long a new session lives, from the `now` it is given. */
  expiresAt = (): number => Date.now() + 15 * MINUTE_MS;
  /** A new session's answer leaves out `expiresAt`. */
  omitExpiry = false;
  /** The payee a new session's answer names; by default the operator account. */
  recipient: string = cfg.operatorAccount;
  /** Every new session gets this id instead of a fresh one. */
  fixedSessionId: string | null = null;
  private next = 0;

  readonly fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    this.calls.push({ method, url: url.toString(), apiKey: new Headers(init?.headers).get("x-api-key") });
    if (method === "POST" && url.pathname.endsWith("/checkout/sessions")) {
      if (this.failCreate) return json({ code: "INTERNAL", message: "down" }, 503);
      this.next += 1;
      const sessionId = this.fixedSessionId ?? `cs_${this.next}`;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const amount = this.answerAmount(body.amount);
      this.sessions.set(sessionId, { status: "CREATED", paymentId: null, body, amount });
      return json({
        session: {
          sessionId,
          status: "CREATED",
          paymentId: null,
          amount,
          recipient: { address: this.recipient },
          createdAt: new Date().toISOString(),
          ...(this.omitExpiry ? {} : { expiresAt: new Date(this.expiresAt()).toISOString() }),
        },
        sessionUrl: `https://checkout.pingpay.test/session/${sessionId}`,
      });
    }
    if (this.failReads) return json({ code: "INTERNAL" }, 503);
    const session = /\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && session) {
      const found = this.sessions.get(decodeURIComponent(session[1]!));
      return found
        ? json({ session: { sessionId: session[1], status: found.status, paymentId: found.paymentId, amount: found.amount } })
        : json({}, 404);
    }
    const payment = /\/payments\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && payment) {
      const status = this.payments.get(decodeURIComponent(payment[1]!));
      return status ? json({ payment: { paymentId: payment[1], status } }) : json({}, 404);
    }
    return json({}, 404);
  }) as typeof fetch;

  pay(sessionId: string, status = "SUCCESS"): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    const paymentId = `pay_${sessionId}`;
    this.sessions.set(sessionId, { ...session, status: "COMPLETED", paymentId });
    this.payments.set(paymentId, status);
  }

  /** The session reads COMPLETED before PingPay has attached a payment to it. */
  completeWithoutPayment(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    this.sessions.set(sessionId, { ...session, status: "COMPLETED", paymentId: null });
  }

  /** Changes the amount PingPay reports for a session from now on. */
  restate(sessionId: string, amount: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    this.sessions.set(sessionId, { ...session, amount });
  }

  /** The session reads `status`, with no payment. */
  setStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    this.sessions.set(sessionId, { ...session, status, paymentId: null });
  }

  /** The session's answers leave out `amount` from now on. */
  dropAmount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    this.sessions.set(sessionId, { ...session, amount: undefined as unknown as Record<string, unknown> });
  }

  expire(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    this.sessions.set(sessionId, { ...session, status: "EXPIRED" });
  }
}

type NearAiRoute = "refresh" | "balance" | "list" | "create" | "patch" | "revoke" | "models";

/** A stand-in for NEAR AI Cloud: the operator's tokens, the organization balance, the workspace keys and every request it saw. */
export class FakeNearAi {
  calls: { route: NearAiRoute; method: string; path: string; auth: string | null; body: unknown }[] = [];
  keys = new Map<string, { name: string; limitNano: bigint; usageNano: bigint; secret: string }>();
  /** What the organization has left, nano-USD. */
  remainingNano = 1_000_000_000_000n;
  /** The models `/model/list` answers with; prices are dollars per token. */
  modelList: { id: string; verifiable: boolean; inputPerToken: number; outputPerToken: number }[] = [];
  /** A status to answer a route with instead of serving it. */
  status: Partial<Record<NearAiRoute, number>> = {};
  /** A status to answer the next request of a route with, once; later ones are served. */
  failOnce: Partial<Record<NearAiRoute, number>> = {};
  /** A raw `/model/list` body served instead of `modelList`, for answers of the wrong shape. */
  rawModels: unknown = undefined;
  /** Key ids the key list leaves out, as a list that lags behind would. */
  unlisted = new Set<string>();
  /** Routes that never answer; the request fails only when its signal aborts. */
  hang = new Set<NearAiRoute>();
  private holds = new Map<NearAiRoute, { gate: Promise<void>; started: () => void }>();
  private nextKey = 0;
  private nextToken = 0;

  /**
   * Holds the next answer of `route` until `release`: it is worked out when the request arrives (a
   * key list as it was then) and sent only afterwards; later requests of the route are served at
   * once. `started` resolves once it is waiting.
   */
  hold(route: NearAiRoute): { started: Promise<void>; release: () => void } {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let started: () => void = () => {};
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    this.holds.set(route, { gate, started });
    const release = () => {
      this.holds.delete(route);
      open();
    };
    return { started: startedPromise, release };
  }

  count(route: NearAiRoute): number {
    return this.calls.filter((call) => call.route === route).length;
  }

  readonly fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v1/, "");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const route = this.route(method, path);
    this.calls.push({ route, method, path, auth: new Headers(init?.headers).get("authorization"), body });
    if (this.hang.has(route)) return hangUntilAborted(init?.signal);
    const once = this.failOnce[route];
    if (once !== undefined) delete this.failOnce[route];
    const status = once ?? this.status[route];
    const answer = status !== undefined ? json({ error: "unavailable" }, status) : this.serve(route, path, body);
    const held = this.holds.get(route);
    if (held) {
      this.holds.delete(route);
      held.started();
      await held.gate;
    }
    return answer;
  }) as typeof fetch;

  private route(method: string, path: string): NearAiRoute {
    if (path === "/users/me/access-tokens") return "refresh";
    if (path === "/model/list") return "models";
    if (path.endsWith("/usage/balance")) return "balance";
    if (method === "PATCH") return "patch";
    if (method === "DELETE") return "revoke";
    if (method === "POST") return "create";
    return "list";
  }

  private serve(route: NearAiRoute, path: string, body: unknown): Response {
    const keyId = /\/api-keys\/([^/]+)/.exec(path)?.[1];
    const limitOf = (value: unknown) => BigInt((value as { spendLimit: { amount: number } }).spendLimit.amount);
    switch (route) {
      case "refresh":
        this.nextToken += 1;
        return json({ access_token: `acc-${this.nextToken}`, refresh_token: `ref-${this.nextToken}` });
      case "balance":
        return json({ remaining: { amount: Number(this.remainingNano), scale: 9 } });
      case "models":
        if (this.rawModels !== undefined) return json(this.rawModels);
        return json({
          models: this.modelList.map((model) => ({
            modelId: model.id,
            inputCostPerToken: { amount: Math.round(model.inputPerToken * 1e12), scale: 12 },
            outputCostPerToken: { amount: Math.round(model.outputPerToken * 1e12), scale: 12 },
            metadata: { verifiable: model.verifiable },
          })),
        });
      case "list": {
        const keys = [...this.keys].filter(([id]) => !this.unlisted.has(id)).map(([id, key]) => ({
          id,
          name: key.name,
          spend_limit: { amount: Number(key.limitNano), scale: 9 },
          usage: { amount: Number(key.usageNano), scale: 9 },
        }));
        return json({ api_keys: keys, total: keys.length });
      }
      case "create": {
        this.nextKey += 1;
        const id = `key-${this.nextKey}`;
        const secret = `sk-secret-${this.nextKey}`;
        this.keys.set(id, { name: (body as { name: string }).name, limitNano: limitOf(body), usageNano: 0n, secret });
        return json({ id, key: secret });
      }
      case "patch": {
        const key = keyId === undefined ? undefined : this.keys.get(keyId);
        if (!key) return json({ error: "not_found" }, 404);
        this.keys.set(keyId!, { ...key, limitNano: limitOf(body) });
        return json({});
      }
      case "revoke":
        if (keyId !== undefined) this.keys.delete(keyId);
        return new Response(null, { status: 204 });
    }
  }
}
