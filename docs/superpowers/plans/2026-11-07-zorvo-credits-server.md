# Zorvo Credits Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Zorvo Credits server (milestones M1 and M2): a Cloudflare Worker with one Durable Object ledger that sells credits for NEAR AI Cloud keys through PingPay, never oversells stock, and never loses a paid top-up.

**Architecture:** A stateless Worker authenticates devices, verifies PingPay webhooks and routes to one SQLite-backed Durable Object, `Ledger`, which is the only writer of stock, reservations, top-ups, keys and the fulfilment queue. Outbound calls to NEAR AI and PingPay go through small typed clients; the Ledger records every decision before it calls out and re-reads after. An alarm drives the queue, token refresh, snapshot refresh and expiry.

**Tech Stack:** TypeScript, Cloudflare Workers (`wrangler`), Durable Objects with SQLite storage, Web Crypto, Vitest with `@cloudflare/vitest-pool-workers`, a Node script with `@near-js/crypto` for the operator login.

**Spec:** `docs/superpowers/specs/2026-11-07-zorvo-private-near-credits-design.md` (sections 7, 9, 10, 11, 12). Read it before starting.

## Global Constraints

- Lives in `server/` as a pnpm workspace package `zorvo-credits-server`; dependencies pinned exactly (`pnpm add -E`) and at least one week old (the workspace enforces `minimumReleaseAge: 10080`).
- Root ESLint and root Vitest ignore `server/`; root `pnpm lint` and `pnpm test` behave as before.
- Credits: 100 credits per USD paid; 120 credits burned per USD of NEAR AI cost (20% margin). Packages: `$5 → 500`, `$10 → 1000`, `$25 → 2500`.
- Device cap: balance plus active reservations ≤ 5,000 credits.
- Stock buffer $2; a snapshot older than 2 minutes is refreshed before a reservation; the alarm refreshes it every 2 minutes; `availableCredits` floored to a multiple of 100, never negative.
- A reservation lives until the PingPay session `expiresAt` + 10 minutes.
- Money is integer nano-USD (scale 9) everywhere (`bigint`). A spend limit is `floor(credits_bought × 1e9 / 120)` nano-USD; never round up.
- PingPay: base `https://pay.pingpay.io/api`, header `x-api-key`; asset `{chain: "NEAR", symbol: "USDC"}` (6 decimals, `$5 = "5000000"`); webhook HMAC-SHA256 hex over `` `${timestamp}.${rawBody}` ``, headers `x-ping-signature` and `x-ping-timestamp`, tolerance 5 minutes either way, constant-time compare.
- NEAR AI: base `https://cloud-api.near.ai/v1`; key and balance endpoints take `Authorization: Bearer <access token>`; refresh with `POST /users/me/access-tokens` and `Authorization: Bearer <refresh token>`, which returns a new refresh token every time.
- Token refresh every 30 minutes; queue backoff 30 s doubling to at most 30 min; alert after 10 attempts, when stock < $3, when a queue item is older than 1 hour, or when a refresh fails.
- A pending key handover is kept at most 24 hours, AES-GCM encrypted.
- Models cached 10 minutes; offered models = configured allowlist ∩ live `verifiable: true`.
- Error bodies are `{ "error": "<code>" }`, codes `unauthorized` (401), `bad_request` (400), `not_found` (404), `stock` (409), `device_cap` (409), `rate_limited` (429), `upstream` (502).
- No secret in the repository; secrets come from `wrangler secret`.

## Review Focus

1. **A webhook that never arrives.** PingPay may drop or delay a webhook; the user paid and expects credits. Expected: the alarm polls every open top-up's session and finishes it without a webhook. Test in Task 6.
2. **NEAR AI refuses or fails while fulfilling** (5xx, timeout, `402` because the operator organization is empty). Expected: the item stays queued with backoff, the top-up shows `paid`, the operator is alerted, nothing is lost. Test in Task 6.
3. **Webhook clock skew and replays.** A timestamp 4 minutes in the future passes, 6 minutes old fails, and the same event delivered twice credits once. Test in Task 5.
4. **The old secret after a recovery.** Every device endpoint answers 401 to the old device secret right after `POST /recover`. Test in Task 8.
5. **Rounding.** 500 credits is $4.1666…: the limit is `4166666666` nano-USD, never `4166666667`, and the shown balance never exceeds what was bought. Test in Task 1.

---

## File Structure

```text
server/
  package.json            scripts: test, typecheck, dev, deploy
  wrangler.jsonc          Worker, Durable Object binding LEDGER (new_sqlite_classes), vars
  tsconfig.json
  vitest.config.ts        @cloudflare/vitest-pool-workers
  src/
    index.ts              Worker: routing, device auth, webhook verify, rate limits → Ledger RPC
    config.ts             Config type, parsed from env vars
    credits.ts            pure credit and nano-USD math
    crypto.ts             secrets, hashes, HMAC, constant-time compare, AES-GCM
    http.ts               json() and error() helpers
    nearai.ts             NearAiClient
    pingpay.ts            PingPayClient and verifyWebhook()
    ledger/Ledger.ts      Durable Object: RPC methods and alarm()
    ledger/schema.ts      CREATE TABLE statements
    ledger/stock.ts       pure stock computation
    ledger/status.ts      top-up status transitions
  scripts/operator-login.mjs   one-off NEP-413 login that prints a refresh token
  test/                   one test file per task
  README.md               deploy and operate
```

Root changes: `pnpm-workspace.yaml` (add `"server"`), `eslint.config.js` ignores (add `"server"`), `vitest.config.ts` exclude (add `"server/**"`).

---

### Task 1: Package scaffold, config and credit math

**Files:**
- Create: `server/package.json`, `server/wrangler.jsonc`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/config.ts`, `server/src/credits.ts`, `server/src/http.ts`, `server/src/index.ts` (answers 404 for now)
- Modify: `pnpm-workspace.yaml`, `eslint.config.js`, `vitest.config.ts`
- Test: `server/test/credits.test.ts`

**Interfaces:**
- Produces:
  - `type Config = { creditsPerUsdPaid: number; burnPerUsdCost: number; packagesUsd: number[]; deviceCapCredits: number; stockBufferNano: bigint; models: string[]; workspaceId: string; organizationId: string; operatorAccount: string; nearAiBase: string; pingPayBase: string }` and `parseConfig(env: Env): Config`.
  - `creditsForPackage(usd: number, cfg: Config): number`
  - `spendLimitNano(creditsBought: number, cfg: Config): bigint` — `floor(credits × 1e9 / burnPerUsdCost)`
  - `creditsFromNano(nano: bigint, cfg: Config): number` — `floor(nano × burnPerUsdCost / 1e9)`
  - `balanceCredits(limitNano: bigint, usageNano: bigint, cfg: Config): number` — `creditsFromNano(max(0, limit − usage))`
  - `usdcAmount(usd: number): string` — base units, 6 decimals
  - `json(body: unknown, status?: number): Response`, `error(code: ErrorCode, status: number): Response`

- [ ] **Step 1: Scaffold.** `server/package.json` (name `zorvo-credits-server`, private, `type: module`, scripts `test: vitest run`, `typecheck: tsc --noEmit`, `dev: wrangler dev`, `deploy: wrangler deploy`); dev dependencies `wrangler`, `@cloudflare/vitest-pool-workers`, `vitest`, `typescript`, `@cloudflare/workers-types` via `pnpm --filter zorvo-credits-server add -D -E`. `wrangler.jsonc`: `main: src/index.ts`, `compatibility_date` = install day, `durable_objects.bindings: [{ "name": "LEDGER", "class_name": "Ledger" }]`, `migrations: [{ "tag": "v1", "new_sqlite_classes": ["Ledger"] }]`, `vars` for every `Config` field with the Global Constraints values (`MODELS` = `Qwen/Qwen3.8-27B,qwen/qwen3.5-397b-a17b,z-ai/glm-5.3,z-ai/glm-5.3-flash,moonshotai/kimi-k3,deepseek-ai/DeepSeek-V4.1-Flash-1017`; `WORKSPACE_ID`, `ORGANIZATION_ID`, `OPERATOR_ACCOUNT` = `"set-me"`). Add `"server"` to `pnpm-workspace.yaml` packages and ESLint `ignores`, and `"server/**"` to the root Vitest `exclude`.

- [ ] **Step 2: Write the failing tests** in `server/test/credits.test.ts`:

```ts
it("prices packages at 100 credits per dollar", () => {
  expect([5, 10, 25].map((u) => creditsForPackage(u, cfg))).toEqual([500, 1000, 2500]);
});
it("never rounds a spend limit up", () => {
  expect(spendLimitNano(500, cfg)).toBe(4_166_666_666n);
});
it("shows a balance no larger than what was bought", () => {
  expect(balanceCredits(spendLimitNano(500, cfg), 0n, cfg)).toBe(499);
  expect(balanceCredits(1_000_000_000n, 1_500_000_000n, cfg)).toBe(0);
});
it("converts dollars to USDC base units", () => {
  expect(usdcAmount(5)).toBe("5000000");
});
it("parses config from env vars", () => {
  expect(parseConfig(env).packagesUsd).toEqual([5, 10, 25]);
});
```

- [ ] **Step 3: Run** `pnpm --filter zorvo-credits-server test` — expected FAIL (modules missing).
- [ ] **Step 4: Implement** `config.ts`, `credits.ts`, `http.ts` with the signatures above (`bigint` for nano-USD).
- [ ] **Step 5: Run** `pnpm --filter zorvo-credits-server test && pnpm --filter zorvo-credits-server typecheck && pnpm lint` — expected PASS; root lint unaffected.
- [ ] **Step 6: Commit** `feat(server): scaffold Zorvo Credits worker with credit math`.

---

### Task 2: Ledger schema, devices and Worker auth

**Files:**
- Create: `server/src/crypto.ts`, `server/src/ledger/schema.ts`, `server/src/ledger/Ledger.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/devices.test.ts`

**Interfaces:**
- Consumes: `json`, `error`, `parseConfig` (Task 1).
- Produces:
  - `crypto.ts`: `randomSecret(bytes = 32): string` (base64url), `sha256Hex(s: string): Promise<string>`, `hmacSha256Hex(key: string, msg: string): Promise<string>`, `timingSafeEqual(a: string, b: string): boolean`, `encrypt(keyB64: string, plain: string): Promise<string>`, `decrypt(keyB64: string, blob: string): Promise<string>` (AES-GCM, 12-byte IV prefixed, base64).
  - `Ledger` RPC: `registerDevice(secretHash: string): { deviceId: string } | { error: "bad_request" }`, `deviceBySecretHash(secretHash: string): { id: string } | null`.
  - Worker helper `authDevice(req: Request, env: Env): Promise<{ deviceId: string } | Response>` reading `Authorization: Bearer <secret>` and hashing it.
  - Schema: the tables of spec 7.2, plus `ratelimits(key TEXT PRIMARY KEY, count INTEGER, window_start INTEGER)` and `events(id TEXT PRIMARY KEY, received_at INTEGER)`.

- [ ] **Step 1: Write the failing tests:** `POST /v1/devices {secretHash}` → 201 with `deviceId`; the same hash again → 400 `bad_request`; `GET /v1/balance` without Bearer → 401 `unauthorized`; with an unknown secret → 401; with the registered secret → not 401. `decrypt(k, await encrypt(k, "x")) === "x"`; `timingSafeEqual("ab", "ac") === false`; 11th `POST /v1/devices` from one IP within an hour → 429.
- [ ] **Step 2: Run** the file — expected FAIL.
- [ ] **Step 3: Implement.** `Ledger extends DurableObject` (from `cloudflare:workers`) applies `schema.ts` inside `ctx.blockConcurrencyWhile` in the constructor and uses `ctx.storage.sql.exec`. The Worker reaches it with `env.LEDGER.get(env.LEDGER.idFromName("ledger"))`. Rate limit: 10 registrations per IP (`CF-Connecting-IP`) per hour, counted in `ratelimits` under `devices:<ip>`.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): add ledger durable object and device auth`.

---

### Task 3: Stock, reservations and `GET /v1/stock`

**Files:**
- Create: `server/src/ledger/stock.ts`
- Modify: `server/src/ledger/Ledger.ts`, `server/src/index.ts`
- Test: `server/test/stock.test.ts`

**Interfaces:**
- Consumes: credit math (Task 1), `Ledger` (Task 2).
- Produces:
  - `computeStock(input: { orgRemainingNano: bigint; outstandingNano: bigint; reservedCredits: number; waitingCredits: number; bufferNano: bigint }, cfg: Config): { availableCredits: number }` — spec 7.3: `available = remaining − outstanding − spendLimitNano(reserved + waiting) − buffer`, then `floor(creditsFromNano(available) / 100) × 100`, at least 0.
  - `Ledger.setSnapshot(orgRemainingNano: bigint, outstandingNano: bigint, takenAt: number): void` (tests call it; Task 4 feeds it from NEAR AI).
  - `Ledger.stockFor(deviceId: string): StockView`, `type StockView = { availableCredits: number; yourRoomCredits: number; packages: { usd: number; credits: number; available: boolean; reason?: "stock" | "device_cap" }[]; updatedAt: string }`.
  - `Ledger.reserve(deviceId: string, credits: number, packageUsd: number, now: number): { topupId: string } | { error: "stock" | "device_cap" }` — inserts `topups(status 'created')` and a `reservations` row in one synchronous block, `reserved_until = now + 30 min` until Task 5 sets the real value.
  - `Ledger.releaseReservation(topupId: string): void`.

- [ ] **Step 1: Write the failing tests:**
  - `computeStock` with remaining $20, outstanding $5, reserved 500 credits, waiting 0, buffer $2 → `availableCredits` 1000 (`20 − 5 − 4.1666… − 2 = 8.8333…` dollars → 1059.99… credits → floored to 1000).
  - `stockFor` marks `$25` with `reason: "device_cap"` when the device already holds 3,000 credits.
  - Race 1: two devices `reserve` the last 500 credits concurrently through two stubs (`Promise.all`) → exactly one `{ topupId }` and one `{ error: "stock" }`.
  - Race 2: one device with 2,600 credits of room reserves 2,500 twice → the second is `device_cap`.
  - `releaseReservation` returns the 500 credits to `availableCredits`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** `stock.ts` as a pure function and the Ledger methods; route `GET /v1/stock` → `stockFor`.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): add stock and atomic reservations`.

---

### Task 4: NEAR AI client and operator session

**Files:**
- Create: `server/src/nearai.ts`
- Modify: `server/src/ledger/Ledger.ts`
- Test: `server/test/nearai.test.ts`

**Interfaces:**
- Consumes: `Config`, `encrypt`/`decrypt`, `setSnapshot`, `spendLimitNano`.
- Produces:
  - `class NearAiClient { constructor(base: string, fetcher: typeof fetch) }` with:
    - `refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: string }>` — `POST /users/me/access-tokens`, response fields `access_token`, `refresh_token`, `refresh_token_expiration`
    - `createKey(access: string, ws: string, name: string, limitNano: bigint): Promise<{ id: string; key: string }>` — body `{ name, spendLimit: { amount: Number(limitNano), currency: "USD" } }`
    - `setSpendLimit(access: string, ws: string, keyId: string, limitNano: bigint): Promise<void>` — `PATCH /workspaces/{ws}/api-keys/{keyId}/spend-limit`, body `{ spendLimit: { amount, currency: "USD" } }`
    - `revokeKey(access: string, ws: string, keyId: string): Promise<void>` — `DELETE /workspaces/{ws}/api-keys/{keyId}`
    - `listKeys(access: string, ws: string): Promise<{ id: string; limitNano: bigint | null; usageNano: bigint }[]>` — `GET /workspaces/{ws}/api-keys?limit=100&offset=n` until `total` is reached; `DecimalPrice {amount, scale}` converted to scale 9
    - `orgRemainingNano(access: string, orgId: string): Promise<bigint>` — `GET /organizations/{org}/usage/balance` → `remaining` (null → 0n)
    - `verifiableModels(): Promise<{ id: string; inputPerM: number; outputPerM: number }[]>` — public `GET /model/list`, keep `metadata.verifiable === true`, prices from `inputCostPerToken`/`outputCostPerToken` (`amount / 10^scale × 1e6`)
    - non-2xx throws `NearAiError { status: number; code?: string }`
  - `Ledger.accessToken(now: number): Promise<string>` — returns the cached access token while valid, else refreshes; the new refresh token is stored (encrypted) **before** the access token is returned; at most one refresh in flight (a promise kept on the instance).
  - `Ledger.refreshSnapshot(now: number): Promise<void>` — `orgRemainingNano` plus Σ `max(0, limit − usage)` over keys whose id is in `devices.nearai_key_id` → `setSnapshot`; it also replaces the rows of a new table `key_usage(key_id TEXT PRIMARY KEY, limit_nano INTEGER, usage_nano INTEGER)` with those keys, which Task 7 reads.
  - Secrets: `OPERATOR_REFRESH_TOKEN` (initial seed, copied into the `operator` row on first use), `KEY_ENCRYPTION_KEY`.

- [ ] **Step 1: Write the failing tests** with a stub `fetch`: exact paths, methods, `Authorization` headers and bodies above (`spendLimit.amount === 4166666666` for 500 credits); `listKeys` follows two pages; `refreshSnapshot` fills `key_usage` only with keys that belong to devices; a 401 surfaces as `NearAiError` with status 401; race 6: two concurrent `accessToken()` calls make one refresh request, and the stored refresh token is the one the stub returned.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): add NEAR AI client and rotating operator session`.

---

### Task 5: PingPay checkout and webhooks

**Files:**
- Create: `server/src/pingpay.ts`, `server/src/ledger/status.ts`
- Modify: `server/src/ledger/Ledger.ts`, `server/src/index.ts`
- Test: `server/test/pingpay.test.ts`, `server/test/topup-flow.test.ts`

**Interfaces:**
- Consumes: `reserve`, `releaseReservation`, `creditsForPackage`, `usdcAmount`, `hmacSha256Hex`, `timingSafeEqual`.
- Produces:
  - `class PingPayClient { constructor(base: string, apiKey: string, fetcher: typeof fetch) }`:
    - `createSession(input: { amountUsdc: string; recipient: string; customerReference: string; topupId: string; successUrl: string; cancelUrl: string }): Promise<{ sessionId: string; sessionUrl: string; expiresAt: string }>` — `POST /checkout/sessions`, `asset: { chain: "NEAR", symbol: "USDC" }`, `metadata: { topupId }`. Before coding it, read the request schema at `https://pay.pingpay.io/api` for the exact `recipient` shape and note it with the date in a comment.
    - `getSession(id: string): Promise<{ status: "CREATED" | "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED"; paymentId: string | null }>` — `GET /checkout/sessions/{id}`
    - `getPayment(id: string): Promise<{ status: string }>` — `GET /payments/{id}`; final when `SUCCESS` or `FAILED`
  - `verifyWebhook(rawBody: string, headers: Headers, secret: string, now: number): Promise<boolean>`
  - `status.ts`: `type TopupStatus = "created" | "paid" | "credited" | "expired" | "failed" | "paid_waiting_stock"` and `canMove(from: TopupStatus, to: TopupStatus): boolean`, true exactly for created→paid, created→expired, created→failed, created→paid_waiting_stock, expired→paid, expired→paid_waiting_stock, paid_waiting_stock→paid, paid→credited.
  - `Ledger.createTopup(deviceId: string, packageUsd: number, now: number): Promise<{ topupId: string; sessionUrl: string; expiresAt: string } | { error: "stock" | "device_cap" | "upstream" }>` — `reserve` → `createSession` (`customerReference = deviceId`, `recipient = cfg.operatorAccount`, success and cancel URLs pointing at a static page in the README) → store `ping_session_id`, `reserved_until = expiresAt + 10 min`; on failure release the reservation and mark `failed`.
  - `Ledger.onSessionEvent(sessionId: string, eventId: string | null, now: number): Promise<void>` — idempotent by `eventId` when given (`events`); re-reads the session from PingPay; `COMPLETED` with a payment whose status is `SUCCESS` → `paid` (or `paid_waiting_stock` when its reservation is gone and stock cannot cover it) and enqueues `credit`; `EXPIRED`/`CANCELLED` → `expired` and release; a move `canMove` refuses is ignored.
  - Routes: `POST /v1/topups {packageUsd}` (unknown package → 400), `GET /v1/topups/:id` → `{ status, credits }` (another device's id → 404), `POST /v1/webhooks/pingpay` (bad signature → 401; `checkout.session.completed` and `checkout.session.expired` call `onSessionEvent(resourceId, id)`; other types → 200, ignored).
  - Secrets: `PINGPAY_API_KEY`, `PINGPAY_WEBHOOK_SECRET`.

- [ ] **Step 1: Write the failing tests:**
  - `verifyWebhook`: valid signature passes; timestamp 4 minutes ahead passes; 6 minutes old fails; a changed body fails.
  - Flow with stubbed PingPay: `POST /v1/topups {packageUsd: 5}` → 201 with `sessionUrl`; webhook `checkout.session.completed` → `GET /v1/topups/:id` says `paid`; one `credit` item queued.
  - Race 4: the same event delivered twice → one queue item; `checkout.session.expired` after `paid` → stays `paid`.
  - Race 3: the reservation expired and its stock went to another device, then `COMPLETED` arrives → `paid_waiting_stock`, no `credit` queued.
  - `createSession` fails → 502 `upstream`, reservation released, top-up `failed`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): sell credits through PingPay checkout`.

---

### Task 6: Fulfilment queue, alarm and key handover

**Files:**
- Modify: `server/src/ledger/Ledger.ts`, `server/src/index.ts`
- Test: `server/test/fulfilment.test.ts`

**Interfaces:**
- Consumes: `NearAiClient`, `PingPayClient`, `spendLimitNano`, `encrypt`/`decrypt`, `canMove`, `onSessionEvent`.
- Produces:
  - `Ledger.alarm(): Promise<void>` — in order: refresh the token when 30 min have passed; refresh the snapshot when older than 2 min; for each `created` top-up older than 2 min call `onSessionEvent(sessionId, null, now)`; expire reservations past `reserved_until`; promote `paid_waiting_stock` FIFO while stock allows; run due queue items one at a time; raise alerts; `ctx.storage.setAlarm(now + 60_000)`. The first `registerDevice` or `createTopup` sets the alarm if none is set.
  - Queue item `credit`: in one synchronous block mark `attempts += 1`, `next_at = now + backoff`, and (only on its first attempt) `credits_bought += credits`; then call out: no key → `createKey("zorvo-<deviceId>", spendLimitNano(credits_bought))`, store `nearai_key_id` and the encrypted secret in `pending_keys` (expires in 24 h); a key → `setSpendLimit(key, spendLimitNano(credits_bought))`. After the call re-read the device row; on success delete the item, move the top-up to `credited`, release its reservation. On `NearAiError` or a network error leave it for `next_at` (30 s × 2^(attempts−1), at most 30 min).
  - `Ledger.takeKey(deviceId: string): Promise<string | null>` — decrypts and deletes the row. Route `GET /v1/key` → 200 `{ key }` or 404.
  - `Ledger.alert(kind: "refresh_failed" | "low_stock" | "stuck_queue" | "attempts_exhausted", detail: string): Promise<void>` — `console.error` and, when the `ALERT_URL` secret is set, a POST of `{ kind, detail }`.

- [ ] **Step 1: Write the failing tests:**
  - A `paid` top-up for a new device → one `createKey` with limit `4166666666`; `GET /v1/key` returns the key once; the second call is 404.
  - A second `$5` top-up for the same device → `setSpendLimit` with `spendLimitNano(1000)`; running that item twice sends the same PATCH body twice (race 5) and `credits_bought` stays 1000.
  - Race 7: while `createKey` is held pending, a concurrent `reserve` by another device is decided from the recorded state, and after `createKey` resolves the device's `credits_bought` is unchanged by the interleaving.
  - NEAR AI 503 → retried after 30 s, then 60 s; after the 10th failure an `attempts_exhausted` alert; the top-up still reads `paid` (Review Focus 2).
  - A `created` top-up whose webhook never came is completed by the alarm's session poll (Review Focus 1).
  - A pending key older than 24 h is deleted.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): fulfil paid top-ups through a retried queue`.

---

### Task 7: Balance and models

**Files:**
- Modify: `server/src/ledger/Ledger.ts`, `server/src/index.ts`
- Test: `server/test/balance-models.test.ts`

**Interfaces:**
- Consumes: `listKeys` results from the snapshot, `balanceCredits`, `creditsFromNano`, `verifiableModels`.
- Produces:
  - `GET /v1/balance` → `{ credits: number; usedCredits: number; keyReady: boolean; updatedAt: string }` from the device's row in `key_usage`. With `?fresh=1` the Ledger first reads this key's usage from NEAR AI (one `listKeys` page lookup or `GET …/api-keys/{key}/usage/history`, whichever the implementer finds cheaper) and updates its `key_usage` row, at most once per 30 s per device (`ratelimits` key `fresh:<deviceId>`; a call inside the window returns the cached row) (`credits = balanceCredits(limit, usage)`, `usedCredits = creditsFromNano(usage)`, `keyReady` = a key exists and is not waiting in `pending_keys`); a device without a key gets `{ credits: 0, usedCredits: 0, keyReady: false }`. A key credited since the last snapshot uses `spendLimitNano(credits_bought)` and zero usage until the next snapshot.
  - `GET /v1/models` → `{ models: { id: string; inputPerM: number; outputPerM: number }[] }` = `cfg.models` ∩ `verifiableModels()`, cached 10 minutes in the Ledger.

- [ ] **Step 1: Write the failing tests:** after a credited `$5` and $1 of usage the balance is `balanceCredits(4166666666n, 1000000000n, cfg)`; `?fresh=1` makes one NEAR AI request and returns the new usage, and a second `?fresh=1` within 30 s makes none; an allowlisted model that upstream marks `verifiable: false` is absent; a second `/v1/models` call within 10 minutes makes no upstream request.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): report balance and TEE models`.

---

### Task 8: Promo codes and recovery

**Files:**
- Modify: `server/src/ledger/Ledger.ts`, `server/src/index.ts`
- Test: `server/test/promo-recover.test.ts`

**Interfaces:**
- Consumes: `reserve`, the queue (Task 6), `createKey`, `revokeKey`, `sha256Hex`.
- Produces:
  - Admin route `POST /v1/admin/promos {code, credits, maxUses}` guarded by `Authorization: Bearer <ADMIN_TOKEN>` (a secret); stores `sha256Hex(code)`.
  - `POST /v1/promo {code}` → `reserve(credits)` (stock and device cap apply), top-up `paid` with `package_usd = 0`, enqueue `credit`; unknown or used-up code → 400; more than 5 attempts per device per hour → 429.
  - `POST /v1/recover {recoveryCode, newSecretHash}` (no Bearer) → in one synchronous block find the device by `sha256Hex(recoveryCode)`, set `secret_hash = newSecretHash`, enqueue `rotate_key`; unknown code → 400; more than 5 attempts per IP per hour → 429.
  - Queue item `rotate_key`: `createKey` with `spendLimitNano(credits_bought)` into `pending_keys`, then `revokeKey(old)`, then update `nearai_key_id`.

- [ ] **Step 1: Write the failing tests:** a 300-credit promo with `maxUses: 1` credits once and its second use is refused; after `POST /recover`, the old secret gets 401 on `/v1/balance`, `/v1/key` and `/v1/topups` (Review Focus 4), the new secret receives the new key, and the old key id is revoked; a sixth wrong recovery attempt from one IP in an hour → 429.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(server): add promo codes and device recovery`.

---

### Task 9: Operator login script and deploy guide

**Files:**
- Create: `server/scripts/operator-login.mjs`, `server/README.md`
- Test: `server/test/operator-login.test.ts` (payload building only, no network)

**Interfaces:**
- Produces:
  - `buildNep413Payload(nowMs: number, random24: Uint8Array): { message: string; nonce: number[]; recipient: "cloud.near.ai" }` exported from the script — nonce = 8-byte big-endian `nowMs` followed by the 24 random bytes; message `"Sign in to NEAR AI Cloud"`.
  - The script takes the operator account id and the path to its key file as arguments (never from the repo), signs the NEP-413 payload (borsh with `tag = 2^31 + 413`, sha256, ed25519 via `@near-js/crypto`), posts `{ signed_message: { accountId, publicKey, signature }, payload }` to `https://cloud-api.near.ai/v1/auth/near` with a `User-Agent`, and prints only the refresh token. On failure it prints the status and the fallback: copy a refresh token from a dashboard session.
  - README: create the operator NEAR account and its NEAR AI organization and fund it through PingPay; `wrangler secret put` for `OPERATOR_REFRESH_TOKEN`, `KEY_ENCRYPTION_KEY` (32 random bytes, base64), `PINGPAY_API_KEY`, `PINGPAY_WEBHOOK_SECRET`, `ADMIN_TOKEN`, optional `ALERT_URL`; set `WORKSPACE_ID`, `ORGANIZATION_ID`, `OPERATOR_ACCOUNT`; register `/v1/webhooks/pingpay` in the PingPay dashboard for `checkout.session.completed` and `checkout.session.expired`; create judge promo codes with the admin route; restock; read alerts.

- [ ] **Step 1: Write the failing test:** the nonce is 32 bytes, its first 8 bytes decode big-endian to `nowMs`, and the recipient is `cloud.near.ai`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the script and README.
- [ ] **Step 4: Run** — expected PASS. Then, on the operator's Mac, run the script once against the real operator account and confirm that `POST /v1/users/me/access-tokens` with the printed token returns 200. If `/v1/auth/near` refuses, record the response in the README and use the fallback.
- [ ] **Step 5: Commit** `feat(server): add operator login script and deploy guide`.

---

## Done for this plan

`pnpm --filter zorvo-credits-server test` and `typecheck` pass and root `pnpm lint` passes. With stubs, a `$5` top-up goes created → paid → credited with the key handed over once, a recovery rotates the key, and stock never goes negative under concurrent reservations. Deploying and the first real payment belong to M5, in a later plan.
