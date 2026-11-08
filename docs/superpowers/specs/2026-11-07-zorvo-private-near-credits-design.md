# Zorvo Private: TEE models paid with NEAR credits — design

Date: 2026-11-07 · Branch: `hackathon/near-credits` · Status: draft for review

## 1. Summary

Zorvo Private lets a Zorvo user run a coding agent (Qwen Code first) on private models that run inside Trusted Execution Environments on NEAR AI Cloud. The user needs no account, no API key and no config file: they buy credits with stablecoins from any chain (or a card) through PingPay, a checkout built on NEAR Intents, and the credits appear in Zorvo.

It is an opt-in mode for developers whose code must not go to OpenAI or Anthropic (client code under NDA, regulated data, repositories holding secrets). Users who do not turn it on see no change.

This is Zorvo's entry for NEAR HACKATHON (development ends 2026-11-14T23:59Z). One submission may list every track it fits. Tracks: `privacy` (primary: NEAR AI Cloud TEE inference), `open` (open innovation: private AI paid from any chain inside a desktop agent app; the track invites entering "alongside any other"), and `agents` (agents see their own credits and, with extension D, run under a spending cap the NEAR AI gateway enforces). If extension D ships, `security` is listed too.

## 2. Goals and non-goals

Goals:
- A user can turn on private mode, buy credits and get an agent answer from a TEE model without leaving Zorvo except for the payment page.
- Prompts go from the agent straight to NEAR AI Cloud. The Zorvo Credits server never sees them.
- The server never sells more credit than the operator's NEAR AI organization can cover, even under concurrent purchases.
- Money that was paid is never lost: every paid top-up ends credited, or waits in a queue that is fulfilled first.
- Judges can try it with a promo code and reproduce it from the README.

Non-goals (hackathon scope):
- Agents other than Qwen Code. Withdrawals or refunds of credits. Accounts, email or wallet login for users. Non-TEE models (Claude, GPT, Gemini, Grok through NEAR AI). Automated restock of the operator organization. Shipping any of this to `main`.

## 3. Decisions made

| Topic | Decision |
| --- | --- |
| Custody | Custodial prepaid credits. The user rejected the non-custodial staking path (a $5 top-up would need ~250–500 NEAR locked for a month). |
| Where | Branch `hackathon/near-credits`, separated from the baseline with tags `pre-hackathon` and `hackathon-submission` (rules Q-003). `main` keeps its promises (no stored keys, no extra network host). |
| User identity | A random device secret in the macOS Keychain; the recovery code is that secret. No login, wallet or email. |
| Models | TEE models only (`verifiable: true` on NEAR AI's public model list), from a curated allowlist. |
| Payment | PingPay Hosted Checkout (wallet, deposit address or card; HMAC-signed webhooks). 1Click is not mandatory (rules Q-011). |
| Credit unit | 1 USDC paid = 100 credits. Packages $5 / $10 / $25 = 500 / 1,000 / 2,500 credits. |
| Margin | 20%, applied on use: $1 of NEAR AI cost burns 120 credits. A server setting. |
| Device cap | Balance plus pending reservations ≤ 5,000 credits. |
| Server | Cloudflare Workers with one SQLite-backed Durable Object `Ledger` as the single writer; code in `server/` on the branch. |
| Operator | A dedicated NEAR account and its NEAR-wallet-login NEAR AI organization, funded with $5–10 through PingPay; restocked by hand. |
| NEAR Builders $10 key | Development and model tests only. It belongs to the NEAR Builders organization, so it cannot create keys or set spend limits, and it is never handed to users. |

## 4. Verified facts this design relies on

| Fact | Source |
| --- | --- |
| Qwen Code 0.26.1 over ACP answers from NEAR AI when launched with `--auth-type openai --openai-base-url https://cloud-api.near.ai/v1 --model <id>` and `OPENAI_API_KEY` in the process env; a wrong key gives `-32603` with details `401 Invalid or expired API key`. | Tested 2026-11-07 with an ACP client using Zorvo's launch command. |
| `OPENAI_*` env alone is ignored when the user's `~/.qwen/settings.json` selects another auth. | Same test. |
| Creating a key (`POST /v1/workspaces/{ws}/api-keys`, body `{name, spendLimit, expires_at}`) returns the secret `key` once; `PATCH …/api-keys/{key_id}/spend-limit` sets it; both accept only a session token. | NEAR AI OpenAPI. |
| A key's spend limit is compared to its lifetime spend; over the limit the gateway answers `402 api_key_limit_exceeded`. | `cloud-api` `middleware/usage.rs`, `get_api_key_spend(api_key_id)`. |
| `POST /v1/users/me/access-tokens` returns a new access token and a new refresh token with its expiry (rotating refresh). | NEAR AI OpenAPI. |
| `POST /v1/auth/near` signs in with a NEP-413 message (full-access key, nonce under 5 minutes). Live but not in the public docs. | `cloud-api` `lib.rs`, `auth/near.rs`. |
| `GET /v1/organizations/{id}/usage/balance` returns `remaining` (nano-USD). No API buys credits. | NEAR AI OpenAPI (93 paths). |
| The public `GET /v1/model/list` marks each model `verifiable` / `attestationSupported` and gives per-token prices. | Live call. |
| Credits are bought in the NEAR AI dashboard through PingPay (crypto) for NEAR-wallet accounts; Stripe auto top-up only for Google/GitHub accounts. | Dashboard screenshots. |
| PingPay `POST /checkout/sessions` takes `amount`, `asset`, `customerReference`, `metadata`, `successUrl`, `cancelUrl`, `paymentMethods`; returns `sessionUrl` and `expiresAt`; webhooks `payment.success`, `payment.failed`, `checkout.session.completed`, signed with HMAC-SHA256 (`x-ping-signature`). The request has **no** `recipient` field: the payee is the PingPay dashboard's Default Recipient Address, and the answer's `recipient.address` says who it is. | pingpay.gitbook.io docs, read 2026-11-07. |
| SQLite-backed Durable Objects are on the Workers Free plan; each object is single-threaded with transactional, strongly consistent storage. | Cloudflare docs. |

## 5. User experience

1. **Turn on.** Settings → Private mode shows what it is, the stock, the packages and the recovery code. A draft for Qwen Code offers **Private (TEE)**; its model chip lists only TEE models, labelled **Private · TEE**.
2. **Buy.** The user picks a package (`$5 · 500 credits · ≈ N turns`). Zorvo opens the PingPay checkout in the system browser. The panel shows "Waiting for payment", then the new balance.
3. **Use.** The private session runs Qwen Code against NEAR AI. The balance in Settings drops as NEAR AI records usage.
4. **Run out.** The composer note says the credits ran out and offers Top up; Send is blocked for that session until the balance is positive.
5. **Move Mac.** On the new Mac the user enters the recovery code. The old Mac's secret and key stop working, a new key carries the remaining balance, and Zorvo shows a new recovery code.

Package availability is shown before checkout (section 7.3). A package is disabled when the stock cannot cover it or when it would take the device over its cap.

The screens are drawn in the design canvas "Zorvo redesign layouts" (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz), section 7 "Private mode": the flow, refresh and operator flows, Settings, the draft, a running session, after Pay (success and failure), first run, verification and errors, the remaining states, and paying with your own key. The artboards decide the look; this spec decides behaviour. Decisions taken in the design review:

- Picking a package only selects it (a radio group); a confirm row "1,000 credits for $10" with **Pay $10** opens checkout. Nothing opens on a single click.
- After Pay: "Opening checkout" → the browser → "Payment received · adding credits" → "+N credits". Failure cases: closed without paying (hold released by Cancel or after 25 minutes), payment failed (no credits, PingPay handles any refund), paid while NEAR AI is slow (retrying, never pay again), paid after the hold ran out (first in line at restock). If Zorvo was closed meanwhile, it checks the top-up when it opens.
- Balance card: "Updated N min ago" and **Refresh** (section 7.4), and a collapsible "Used by" breakdown per agent and model, shown once extension E gives per-session cost (the core shows the total used); one balance serves every private session on the Mac.
- First run: "0 credits · No key yet" with a promo hint; a draft with Private on and 0 credits shows "Add credits to start a private session" and keeps Start off.
- After the first top-up a one-time dialog "Save your recovery code" (Copy, a checkbox "I saved it somewhere safe" that enables Done, "Remind me later" leaves a note on the balance card).
- Session limit defaults to **No limit**; the menu offers 100 / 200 / 500 credits.
- Credits run out: only private calls stop; history stays, the message returns to the box; actions Top up or "Continue with another agent", which says it leaves the TEE.
- Verification badge has four states: Checking the signature, Verified in TEE, Not signed (cut off, e.g. Stop), Didn't verify (signature mismatch, counted in the inspector).
- The Private tab exists only in private sessions; private sessions carry a shield in the sidebar; the Private chip is disabled for agents other than Qwen Code, with the reason.
- Settings explains "How credits work" (1 credit = $0.01 bought; NEAR AI's model price + 20% when used) and shows promo results inline.
- Credits server unreachable: "Balance unavailable", last known value, private sessions keep working; checkout that cannot open says nothing was held or charged.

## 6. Architecture

```text
Zorvo (Tauri)                         Cloudflare                          External
┌──────────────────────┐   HTTPS    ┌──────────────┐  RPC   ┌──────────────────┐
│ Rust private_mode/    │──────────▶│ Worker        │──────▶│ Durable Object   │──▶ NEAR AI Cloud
│  Keychain: device     │           │ (auth, HMAC,  │       │ Ledger (SQLite)  │    (keys, limits,
│  secret + NEAR AI key │           │  rate limits) │◀──────│ stock, queue,    │     balance)
│ launch_for: Qwen flags│           └──────────────┘        │ alarms           │──▶ PingPay
└─────────┬────────────┘                  ▲ webhook          └──────────────────┘    (checkout)
          │ prompts (key in env)          │
          ▼                               │
   Qwen Code ──────────────▶ NEAR AI Cloud TEE models        PingPay ──┘
```

The webview keeps its CSP: it makes no network request. The Rust backend talks to one new host, the Zorvo Credits Worker. The agent talks to `cloud-api.near.ai` itself, as other agents talk to their own APIs. Checkout opens in the system browser, so payment details never touch Zorvo.

## 7. Server (`server/`)

### 7.1 Worker

A thin front: authenticates the device (`Authorization: Bearer <device secret>`, compared by SHA-256 hash), verifies PingPay signatures (HMAC-SHA256 over timestamp and raw body, timestamp within 5 minutes, constant-time compare), applies rate limits, then calls the Ledger. It holds no state.

### 7.2 Ledger Durable Object

One instance (`idFromName("ledger")`) owns every record that can race. Its SQLite tables:

| Table | Columns (main) |
| --- | --- |
| `devices` | `id`, `secret_hash`, `nearai_key_id`, `credits_bought`, `created_at`, `revoked_at` |
| `topups` | `id`, `device_id`, `package_usd`, `credits`, `status`, `ping_session_id` (unique), `ping_payment_id`, `reserved_until`, `created_at`, `updated_at`, `next_poll_at`, `polls` (the alarm's PingPay poll and its backoff) |
| `reservations` | `topup_id`, `device_id`, `credits`, `expires_at` |
| `queue` | `id`, `kind` (`credit`, `rotate_key`, `revoke_key`), `ref`, `attempts`, `next_at`, `counted` (a credit's credits are already in `credits_bought`), `created_at` |
| `promos` | `code_hash`, `credits`, `max_uses`, `uses` |
| `promo_redemptions` | `code_hash`, `device_id` (a device redeems each code once) |
| `pending_keys` | `device_id`, `key_ciphertext`, `expires_at` |
| `operator` | `refresh_token_ciphertext`, `seed_hash` (hash of the `OPERATOR_REFRESH_TOKEN` secret last taken in), `access_token` (encrypted, like the refresh token), `access_expires_at`, `version` |
| `snapshot` | `org_remaining_usd`, `outstanding_usd`, `taken_at` |
| `key_usage` | `key_id`, `limit_nano`, `usage_nano` (each device key, from the last snapshot or the last recorded limit) |
| `limits_version` | `version` (bumped by every recorded key limit, so a snapshot read before it does not overwrite it) |
| `ratelimits` | `key`, `count`, `window_start` (fixed windows; rows older than a day are purged) |
| `events` | `id`, `received_at` (webhook event ids already applied; kept 30 days) |

Every state change runs synchronously inside the object (SQLite calls are synchronous), so two requests cannot interleave a read and a write of stock. Outbound calls (`fetch` to NEAR AI or PingPay) can let other requests in while they wait; the rule is to decide and record first, call out second, and re-read after the call (section 7.5, race 7).

### 7.3 Stock

All amounts are kept in nano-USD of NEAR AI cost.

```text
outstanding = Σ over active keys max(0, spend_limit − usage)        (from the keys list)
reserved    = Σ active reservations, converted to cost
waiting     = Σ topups in status paid_waiting_stock
available   = org_remaining − outstanding − reserved − waiting − buffer($2)
availableCredits = floor(available × 120 / 100) × 100               (rounded down to 100)
```

`org_remaining` and `outstanding` come from a snapshot refreshed by an alarm every 2 minutes and before a reservation when the snapshot is older than 2 minutes. Both fall together as users spend, so the stock stays stable between snapshots. `GET /v1/stock` returns:

```json
{
  "availableCredits": 12400,
  "yourRoomCredits": 4500,
  "packages": [
    { "usd": 5,  "credits": 500,  "available": true },
    { "usd": 10, "credits": 1000, "available": true },
    { "usd": 25, "credits": 2500, "available": false, "reason": "device_cap" }
  ],
  "updatedAt": "2026-11-07T01:10:00Z"
}
```

`reason` is `stock` or `device_cap`. Rounding hides the operator's exact balance.

`yourRoomCredits` is the device cap (5,000) minus what the device already holds or has coming: `(credits_bought − credits used)` (never below 0; used from its key's usage) `+` that device's active reservations `+` its own `paid_waiting_stock` credits.

### 7.4 Endpoints

All under `/v1`. Device auth unless noted.

| Method and path | Purpose |
| --- | --- |
| `POST /devices` (no auth, rate limited) | Register `{secretHash}`; returns `deviceId`. |
| `GET /stock` | Section 7.3. |
| `GET /balance` | `{credits, usedCredits, keyReady, updatedAt}`; credits = (limit − usage) × 120, from the last snapshot. `?fresh=1` (Refresh) refreshes the whole snapshot first (organization balance and key list; NEAR AI has no cheaper per-key read), at most once per 30 s per device and once per 30 s for the server, and not when the snapshot is under 30 s old; otherwise, or when NEAR AI fails, the cached value is returned. |
| `GET /models` | TEE allowlist ∩ live `verifiable: true`, with prices; cached 10 minutes. |
| `POST /topups` `{packageUsd}` | Reserve, create the PingPay session, return `{topupId, sessionUrl, expiresAt}`. At most 10 per hour per device (429 `rate_limited`). |
| `GET /topups/{id}` | `{status, credits}`. |
| `POST /topups/{id}/cancel` | Cancel in Zorvo: a `created` top-up becomes `expired` and its hold is released; a payment that still arrives is handled as a late payment. |
| `GET /key` | Hand over the NEAR AI key once, then delete it from `pending_keys`. |
| `POST /promo` `{code}` | Redeem; same reservation and fulfilment path with `package_usd = 0`; returns `{topupId, credits}`. At most 5 attempts per hour per device (429). |
| `POST /recover` `{recoveryCode, newSecretHash}` (no Bearer; the code is the credential; at most 5 attempts per hour per IP, 429) | Replace the device's secret hash with this Mac's new one, so the old secret stops working; drop its pending key; enqueue `rotate_key`. |
| `POST /admin/promos` `{code, credits, maxUses}` (Bearer `ADMIN_TOKEN`, compared in constant time; with the secret unset or empty every call is 401) | Create or update a promo code, stored by its hash. |
| `POST /webhooks/pingpay` (signature auth) | Read the session from PingPay, apply it, record the event; enqueue `credit`; answer 200. A session that is not settled yet (or whose amount or asset differs) answers 503 and records nothing, so PingPay redelivers. |

### 7.5 Flows and races

Top-up:

```text
POST /topups → Ledger: snapshot fresh? → check stock and device cap → insert topup(created) + reservation
            → fetch PingPay session (customerReference = deviceId, metadata.topupId; no recipient field:
              the payee is the dashboard's Default Recipient Address, and an answer whose
              recipient.address is not OPERATOR_ACCOUNT fails closed with 502)
            → ok: store session id, reserved_until = min(expiresAt + 10 min, now + 60 min)
            · fail: delete reservation, topup failed
webhook payment.success → Ledger: idempotent by payment id → topup paid → enqueue credit
alarm → credit: device has no key → create key with spendLimit; else PATCH spend limit
       to the absolute value credits_bought / 120 → topup credited, reservation released
```

| # | Race | Handling |
| --- | --- | --- |
| 1 | Two devices buy the last stock at once | Check and reserve in one synchronous step in the Ledger; the second sees no stock. |
| 2 | One device opens several checkouts | The device cap counts `(credits_bought − credits used)` plus that device's active reservations plus its own `paid_waiting_stock` credits (section 7.3). |
| 3 | Payment arrives after the reservation expired and the stock was sold | The top-up goes to `paid_waiting_stock`, a FIFO served before any new reservation after restock; the operator is alerted. Never refused, never lost. |
| 4 | Duplicate or out-of-order webhooks | Idempotent by event id, and the session is always read again from PingPay; status only moves forward: `created → paid → credited`, `created → expired → paid`, `created → failed`, `created → paid_waiting_stock`, `expired → paid_waiting_stock`, `paid_waiting_stock → paid`. `credited` never changes. A `paid` top-up keeps its hold until it is credited. A payment `FAILED` or `REFUNDED` on a session changes nothing (the session may still be paid). A `COMPLETED` session whose payment is not final, or whose amount or asset differs from the package, is answered 503 and checked again (webhook redelivery and the alarm's bounded poll). |
| 5 | Two credits for one device update its spend limit | The limit is always set to the absolute total from `devices.credits_bought`, never incremented, so order and repeats do not matter. |
| 6 | Two token refreshes at once | Only the Ledger refreshes, one at a time; the new refresh token is stored before the new access token is used. |
| 7 | A request slips in while the Ledger awaits NEAR AI or PingPay | State is recorded before the call; after the call the Ledger re-reads the rows it changes instead of trusting values read before the await. |
| 8 | Alarm runs overlap | One alarm per object; the queue takes one item at a time and marks it before calling out. |

Queue retry: exponential backoff from 30 s to 30 min; after 10 attempts the item stays and the operator is alerted. Expired reservations are released by the alarm.

Key handover: when a key is created, the Ledger encrypts the secret (AES-GCM, key from a Worker secret) into `pending_keys` for 24 hours. `GET /key` returns it once and deletes the row. The Ledger never stores a usable key after handover; only `nearai_key_id`.

Recovery: the recovery code is the current device secret. The new Mac generates a fresh secret and sends `POST /recover {recoveryCode, newSecretHash}`. The Ledger checks the code's hash, replaces `secret_hash` with the new one in the same step (so the old secret, wherever it still lives, can no longer call `GET /key` or anything else), drops any pending key, and enqueues `rotate_key`. The rotation first **freezes** the old key (PATCH its spend limit to its current usage), reads the usage again, and creates a new key carrying only the **remaining** credits: `credits_bought := credits_bought − ceil(credits used)`, the new key's limit from that. A remainder of 0 makes no key; the device's next credit or promo creates one. The old key is then revoked through a `revoke_key` queue item, retried on its own. Zorvo then shows the new recovery code; the old one is dead. A pending key not collected within 24 hours is deleted; recovering with the device's own current code re-issues a key against the remaining balance.

Promo: a code redeems a fixed number of credits through the same reservation and credit path (no payment). Codes are stored hashed, with `max_uses`.

### 7.6 Operator session

- A local, one-off script (`server/scripts/operator-login.mjs`) signs a NEP-413 message for `cloud.near.ai` with the operator account's key on the operator's Mac, calls `POST /v1/auth/near`, and prints the refresh token, which the operator stores with `wrangler secret put`. The full-access key never reaches the server.
- Fallback when that undocumented route fails: copy a refresh token from a dashboard session by hand.
- The Ledger refreshes the access token every 30 minutes by alarm and persists each new refresh token before use.
- `OPERATOR_REFRESH_TOKEN` seeds the stored session and re-seeds it whenever its value changes (its hash is compared with `operator.seed_hash`); an unchanged secret never overwrites the rotated token.
- The operator is alerted (log plus an optional webhook URL secret): `refresh_failed` (token or stock refresh failed), `low_stock` (below $3), `stuck_queue` (an item older than 1 hour), `attempts_exhausted` (an item failed 10 times; it keeps retrying), `payment_mismatch` (a paid session charged another amount or asset; not credited).

### 7.7 Configuration and secrets

Settings (`wrangler.jsonc`): credits per USD paid (100), burn per USD of cost (120), packages, device cap (5,000), stock buffer ($2), model allowlist, NEAR AI workspace and organization ids, operator NEAR account (`OPERATOR_ACCOUNT`: not sent to PingPay, which pays the dashboard's Default Recipient Address; the answer that creates each checkout session has its `recipient.address` checked against it and a different payee fails closed with 502). Secrets (`wrangler secret`): PingPay API key, PingPay webhook secret, operator refresh token, key-encryption key, `ADMIN_TOKEN` for `POST /admin/promos` (unset or empty: nobody is admin), optional alert URL. Nothing secret is committed; the repository is public.

## 8. Zorvo app

### 8.1 Rust (`src-tauri/src/private_mode/`)

| File | Responsibility |
| --- | --- |
| `device.rs` | Create the device secret; read and write it and the NEAR AI key in the macOS Keychain (through `security-framework`'s `passwords` module, a crate already in the dependency tree; `keyring` 4 moved its macOS backend into separate crates). |
| `client.rs` | `ureq` client for the Credits Worker; the base URL is a compile-time constant and the only host it calls. |
| `models.rs` | Cached `GET /models`; validates a model id before launch. |
| `service.rs`, `local_state.rs`, `launch.rs` | The logic behind the commands; `<app data>/private/state.json` (recovery flags, pending top-up, last balance, last model list), kept apart from `state.json`; the private launch. |
| `proxy/` | The loopback proxy private launches talk to: one listener on 127.0.0.1:0, one token per agent process (a fork shares its source's), forwarding to NEAR AI, and the in-memory records of completion ids and SHA-256 hashes. |
| `commands.rs` | `private_status`, `private_stock`, `private_models`, `private_create_topup`, `private_open_checkout`, `private_topup_status`, `private_cancel_topup`, `private_redeem_promo`, `private_recovery_code`, `private_mark_recovery`, `private_recover`, `private_forget_device`. All are `#[tauri::command(async)]`. Rust opens the checkout URL itself, and only on `pay.pingpay.io`. |

Launch: `acp_start_session` gains an optional `private_model_id`. When set and the agent is `qwen-code`, `launch_for` appends `--auth-type openai --openai-base-url http://127.0.0.1:<port>/v1 --model <id>` after validating the id against `models.rs`, and the spawn gets `OPENAI_API_KEY` set to a fresh per-session proxy token and `OPENAI_BASE_URL` to that loopback URL; the NEAR AI key never enters the agent. The backend's one loopback proxy (`proxy/`, 127.0.0.1:0, started on the first private launch) maps each token to its app session, model and key, accepts only `POST /v1/chat/completions` and `GET /v1/models`, checks that the request's model is the token's, adds the real key, forwards the exact request bytes to `https://cloud-api.near.ai/v1`, streams the answer back byte for byte, and keeps in memory each completion's id and the SHA-256 of the exact request and response bytes (at most 500 per session, never the bodies). A fork shares its source's token, and a token is dropped only when no session on its agent process is left. The UI still sends ids, never arguments. Any other agent with a private model id is refused.

Errors: for a private session, an ACP error `-32603` whose details carry `402` / `api_key_limit_exceeded` becomes `PRIVATE_CREDITS:{"reason":"empty"}`, and `401` becomes `PRIVATE_CREDITS:{"reason":"key"}`, mirroring `ACP_AUTH_REQUIRED:` in `acp/manager.rs`.

### 8.2 Frontend

- `components/private/PrivateModeSection.tsx` in `AppSettingsDialog`: stock line, package buttons (price, credits, ≈ turns, disabled reason), checkout status, promo field, recovery code (show, copy, restore).
- `hooks/usePrivateCredits.ts`: status, stock and top-up polling (every 3 s while a checkout is open, stopped when it ends).
- `lib/private-credits.ts`: credit math and wording.
- Draft: a **Private (TEE)** option for Qwen Code; the model chip lists `GET /models`, labelled **Private · TEE**.
- `lib/composer-state.ts` `composerNote`: "Your credits ran out. Top up to continue." for `PRIVATE_CREDITS` sessions; the message is given back to the box as for other refusals.
- One `paymentSource: "credits" | "ownKey"` (Settings, kept in `settings`) decides every screen that talks about balance, limits or running out, so they cannot disagree: with `ownKey` the composer reads "Paying with your NEAR AI key", the Session limit chip is disabled with its reason, running out shows "Your NEAR AI key ran out of credits" (Switch to Zorvo credits / Open NEAR AI dashboard), and the Private tab shows the session's cost in dollars.
- Recovery-code dialog after the first top-up, balance Refresh, the four verification states and the other review decisions in section 5.
- Session record: an optional `privateMode: { modelId }`, read leniently in `lib/persistence.ts`; `STATE_VERSION` unchanged.
- Copy follows the design-system rules (sentence case, "you", agents named).

### 8.3 Extensions

Built as milestones M6–M8 (section 14) after the core works end to end. Sizes (S, M, L) are relative estimates, not schedules.

**A. Agents know their credits (M6, `agents`, size M).** For private sessions Zorvo passes one stdio MCP server in `session/new` `mcpServers` (today it sends `[]`, `acp/manager.rs`). The server offers `credits_balance` (credits left, ≈ turns left on the current model) and `private_models` (TEE models with price per 1M tokens and ≈ credits per turn). It reads them from the Credits Worker with the device secret, which it gets in its process env only. An agent can then plan its work, or suggest a cheaper model when credits run low.

**B. "Verified in TEE" per answer (M6, `privacy`, size M).** The private launch goes through Zorvo's loopback proxy (8.1), the only place that holds the exact bytes NEAR AI signs. For each private completion the proxy records the completion id and the SHA-256 of the exact request and response bytes, never the bodies (at most 500 records per session, in memory only). At each turn end Zorvo reads the session's unchecked records, calls `GET /v1/signature/{id}` with the device's key, and verifies the signature: `provider_tee` signs `model:sha256(request):sha256(response)`; a gateway signature signs `sha256(request):sha256(response)`. The answer gets a "Verified in TEE" badge, with the signer address and a link to NEAR AI's Verification Center. Qwen's own logs are not read, so no prompt is ever copied for verification.

**C. Low-balance warning (M6, size S).** Below 50 credits the composer note warns and a system notification fires once per crossing.

**D. Per-session spending cap enforced by NEAR AI (M7, `agents` and `security`, size L).** A private draft can set "at most N credits for this session". The Ledger splits the device budget: it creates a session key whose spend limit is N / 120 USD and lowers the device key's limit by the same amount; unused budget returns to the device key when the session ends. The cap is enforced by the NEAR AI gateway (`402`), not by Zorvo. If built, the submission also lists the `security` track. The default is No limit, and a session without a limit uses the device key (no session key). Not available with `paymentSource: "ownKey"`: the server cannot make keys in the user's organization.

**E. Usage per session (M7, `agents`, size S).** Two sources: with D, the session key's own usage; otherwise the completion ids from B sent to `POST /v1/billing/costs` (accepts an inference API key) for their cost in nano-USD. Shown in the session's inspector as credits used. Depends on B or D.

**F. Secret guard before sending (M7, `privacy`, size M).** Before a private message goes out, Zorvo scans the composer text and attached files locally (no network) for secret patterns: private key blocks, `AKIA…`, `ghp_…`/`github_pat_…`, `sk-…`, `xox[bp]-…`, `.env`-style `KEY=` lines with long random values. On a hit it shows what matched, masked, with Send anyway / Edit. Limit, stated in the UI: the agent can still read files in the folder itself; the guard covers only what the user sends.

**G. Bring your own NEAR AI key, for NEAR holders who stake (M8, `open`, size S).** A user who stakes NEAR in the NEAR AI dashboard earns credits in their own organization, non-custodially. Settings → Private mode offers "Use my own NEAR AI key": the user creates a key in their dashboard and pastes it; Zorvo checks it with `POST /v1/check_api_key`, stores it in the Keychain, and private sessions use it instead of Zorvo Credits (no top-up, no Ledger). Wallet sign-in from the desktop app (NEP-413) is out of scope; pasting a key avoids it. Settings then offers "Private sessions pay with: Zorvo credits / My NEAR AI key" and Remove key; the key is never sent to the credits server. `check_api_key` is not known to return a balance, so Zorvo shows none for this key; `credits_balance` (A) answers that the balance isn't visible; per-session cost comes from `POST /v1/billing/costs` (E) in dollars. A recovery does not move this key.

## 9. Credit math

| Package | Paid | Credits | Spend limit added | Operator share before fees |
| --- | --- | --- | --- | --- |
| $5 | 5 USDC | 500 | $4.17 | $0.83 |
| $10 | 10 USDC | 1,000 | $8.33 | $1.67 |
| $25 | 25 USDC | 2,500 | $20.83 | $4.17 |

`spend_limit = credits_bought / 120` (USD). `balance = (spend_limit − usage) × 120`, floored to whole credits. "≈ turns" uses a per-model average measured with the NEAR Builders key on real coding tasks.

## 10. Error handling

| Case | Behaviour |
| --- | --- |
| Not enough stock | `POST /topups` → 409 `stock`; Zorvo shows "Top-ups are paused for now". No checkout is created. |
| Over device cap | 409 `device_cap`. |
| Checkout expired or failed | Top-up `expired` / `failed`; reservation released. A `created` top-up whose hold ended over 7 days ago is moved to `expired` by the alarm. |
| Webhook for a session not settled yet | 503; nothing recorded; PingPay redelivers and the alarm polls. |
| Paid, NEAR AI unreachable or session lost | `paid` stays in the queue and retries; Zorvo shows "Paid, credits on the way". |
| Paid late, stock sold | `paid_waiting_stock`, served first after restock. |
| Credits run out mid-session | `PRIVATE_CREDITS` note and Top up. |
| Credits server down | Top-up unavailable; running private sessions keep working while credits last. |
| Keychain lost | Restore with the recovery code. |
| Key not collected within 24 hours, or its handover lost | The pending key is deleted; recovering with the device's own code re-issues one against the remaining balance. |
| Wrong recovery or promo code | Plain message; rate limited. |

## 11. Security and privacy

- Prompts never pass through the Credits server.
- The server stores only hashes of device secrets and promo codes, NEAR AI key ids, an encrypted key for at most 24 hours until handover, and the operator's NEAR AI access and refresh tokens, both encrypted with the key-encryption key, plus a hash of the refresh-token secret (to notice a replaced seed).
- A leaked database exposes no usable key and no device secret.
- The NEAR AI key lives in the Keychain and only in the backend's loopback proxy; a private Qwen Code process gets a per-session token instead, and flags in argv carry no secret.
- PingPay webhooks are accepted only with a valid, fresh signature.
- The operator's full-access NEAR key stays on the operator's Mac.
- `main` is untouched; the branch README states what changes there (two extra hosts — the Credits Worker and NEAR AI Cloud — and one stored key).

## 12. Testing

- Server (Vitest with the Workers pool / Miniflare): credit math, stock formula, reservation and device cap, the eight races as scripted interleavings, HMAC verification, idempotent webhooks, absolute spend-limit updates, token refresh order, queue backoff. NEAR AI and PingPay are mocked with `fetch` stubs.
- Rust: launch arguments for a private Qwen session (flags present, key only in env, unknown model refused, other agents refused), the `PRIVATE_CREDITS` mapping, Keychain wrapper behind a trait with an in-memory fake. The fake ACP agent gets `FAKE_ACP_PRIVATE_ERROR=<401|402>`.
- Frontend (Vitest, targeted files): Private mode section, package availability and reasons, draft option, composer note.
- Extensions: A — MCP tool results against a stubbed Worker; B — signature verification against a recorded real signature, and log files removed after reading; D — budget split and return in the Ledger, with races 1–8 rerun; E — cost sum from stubbed `/v1/billing/costs`; F — the secret patterns, including no hit on ordinary code; G — a pasted key validated, stored in the fake Keychain, and used at launch instead of the Credits key.
- Manual on mainnet: one real $5 top-up, one promo redemption, one recovery on a scratch profile, and real coding tasks on each allowlisted model with the NEAR Builders key to measure credits per turn.

## 13. Demo and submission

- Promo codes for judges (for example 300 credits, limited uses), funded by the operator organization.
- README written for the AI screener and human judges: what it is, the problem, "do X → see Y" steps, a "Role of NEAR" section (NEAR AI Cloud TEE, PingPay on NEAR Intents, operator NEAR account), what existed before the hackathon, and a link to the `pre-hackathon...hackathon-submission` diff.
- A demo video of about two minutes: the problem, turning on private mode, a top-up, the agent at work, and the TEE badge if built.
- An X post draft with @NEARProtocol and #NEARHackathon for the user to publish.
- The submission payload is printed for the user's confirmation before anything is sent.

## 14. Milestones

No calendar: each milestone is done when its checks pass, at the pace the work allows. The only fixed date is external: the hackathon accepts submissions until 2026-11-14T23:59Z, and whatever milestones are done by then are what gets submitted.

| Milestone | Contents | Done when |
| --- | --- | --- |
| M1. Ledger | `server/` skeleton, Ledger tables, stock, reservations, device cap, races 1–8 as tests; operator login script | Server tests pass; the login script yields a refresh token |
| M2. Money path | NEAR AI key create and absolute spend limit, token refresh, queue; PingPay session and webhook; promo; recovery | With stubs, a top-up goes created → paid → credited, and a recovery rotates the key |
| M3. Zorvo backend | Rust `private_mode/`, Keychain, launch flags, `PRIVATE_CREDITS` mapping | Rust tests pass; a private Qwen session starts with the key only in its env |
| M4. Zorvo UI | Settings section with stock and packages, draft option, composer note, recovery UI | Frontend tests pass; the flow works against the deployed Worker |
| M5. Live | Deploy, operator funding, one real $5 top-up end to end, credits per turn measured | A real payment ends as credits and an agent answer from a TEE model |
| M6. Extensions A, B, C | Agents know their credits; "Verified in TEE"; low-balance warning | Each passes its tests and works in the real app |
| M7. Extensions D, E, F | Per-session cap; usage per session; secret guard | Same |
| M8. Extension G | Own NEAR AI key for staking holders | Same |
| M9. Submission | README for judges, video, X post draft, tags `pre-hackathon` and `hackathon-submission` | The user has reviewed all of it; the user sends the submission |

Order: M1 → M2 → M5 need each other; M3 and M4 can run beside M1–M2 (separate files, parallel sessions in separate worktrees, laid out in the implementation plan). M6–M8 start only after M5, in that order, each only when the one before it works end to end. M9 can start any time and is finished last. When the submission time comes, unfinished milestones are left out, never half-shipped, and the core (M1–M5) is never traded for an extension.

## 15. Risks and open questions

- Scope: the core plus seven extensions is a lot for one person before the hackathon closes. Milestone order (section 14) decides what ships; the core is never traded for an extension.
- G stores a key the user pasted, which `main` forbids; like the rest, it lives only on the branch.
- `POST /v1/auth/near` is undocumented and may change; the fallback is a hand-copied refresh token.
- PingPay's platform fee, merchant onboarding and whether `pk_test_` keys are a true test mode are unknown; check in the PingPay dashboard before M2.
- The minimum PingPay amount is unknown; the $5 package may need adjusting.
- PingPay's payee is the dashboard's Default Recipient Address, not a request field. A wrong setting cannot send money elsewhere unnoticed: the server checks the `recipient.address` in the answer that creates each checkout session against `OPERATOR_ACCOUNT` and refuses (502) any other.
- Unverified until the first live checkout: the NEAR USDC asset id constant (`NEAR_USDC_ASSET_ID`, from the implementer's knowledge; PingPay's docs name none) and PingPay's auth header name (the docs give both `x-api-key` and `x-publishable-key`; the client sends `x-api-key`). Both fail closed.
- Coding quality of the TEE models is untested beyond a short answer; measured in M5.
- Stored-value obligations of custodial credits; mitigated by small caps, clear "credits are non-refundable" wording and branch-only scope. Not legal advice.
- The NEAR AI organization balance is restocked by hand; a long absence pauses sales (never fails paid users).
