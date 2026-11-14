# Zorvo Credits server

A Cloudflare Worker with one Durable Object (SQLite storage) that sells prepaid credits for private
(TEE) models on NEAR AI Cloud. A Zorvo user pays through a PingPay checkout; the server then creates a
NEAR AI API key with a spend limit for that device and hands it over once. Zorvo's Private mode
(the desktop app) talks to this server for balance, stock, top-ups, promo codes and recovery; prompts
and completions go from the app straight to NEAR AI and never pass through this server. The design is
in `docs/superpowers/specs/2026-11-07-zorvo-private-near-credits-design.md`.

Status: the code and its tests are done; **nothing in this guide has been run against the live NEAR AI,
PingPay or Cloudflare services.** Every step that depends on them is marked "unverified" below, and the
first live run is where they get confirmed.

## Develop

```bash
pnpm install
pnpm --filter zorvo-credits-server dev          # wrangler dev on localhost
pnpm --filter zorvo-credits-server test         # Vitest in the Workers runtime (NEAR AI and PingPay stubbed), then the login script's tests on Node
pnpm --filter zorvo-credits-server typecheck    # the Worker and its tests, then scripts/ (checkJs, Node types)
```

`wrangler dev` needs the secrets and the three `set-me` variables below. For local runs put the secrets
in `server/.dev.vars` (one `NAME=value` per line; the file is git-ignored). Never commit a secret.

## Operator setup

You are the operator: you own the NEAR account that is paid, the NEAR AI organization that pays for the
keys, and the Cloudflare account that runs the Worker. Do these in order.

### 1. Operator account, NEAR AI organization, first funds

1. Create a dedicated NEAR account for this (a fresh one, not a personal one).
2. Sign in to the NEAR AI Cloud dashboard with that account (NEAR-wallet login). This creates its
   organization. Note the **organization id** and **workspace id** from the dashboard (they are the
   `ORGANIZATION_ID` and `WORKSPACE_ID` below; the dashboard URLs and the API's `GET /v1/...` listings
   show them).
3. Fund the organization with $5 to $10 through the dashboard's PingPay top-up. This stock is what the
   server sells; sales pause when it runs out.

### 2. Refresh token: the login script

The server renews its NEAR AI session from a **refresh token** of the operator account. The script
`server/scripts/operator-login.mjs` gets one by signing a NEP-413 sign-in message with the operator's
full-access key, on your own Mac. The key stays on your machine: the script reads it from a file you
name, never from the command line, and prints only the refresh token.

The key file is either a near-cli credentials file (JSON with `private_key`, usually under
`~/.near-credentials/`) or a text file that holds only `ed25519:<base58>`. It must be a **full-access**
key of the operator account (NEAR AI checks that).

```bash
# 1. Offline check first. Reads the key only to show its public key; signs and sends nothing.
node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file> --dry-run

# 2. The live run. Prints the refresh token, and nothing else, on success.
node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file>
```

The dry run prints the account, the public key, the message (`Sign in to NEAR AI Cloud`), the recipient
(`cloud.near.ai`) and the nonce. Compare the public key with the one the dashboard or your wallet shows
for that account before the live run.

Keep the token out of your shell history and off the screen, and never upload an empty one when the login
fails: the token goes into a shell variable first and is only stored when the login succeeded.

```bash
token=$(node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file>) \
  && [ -n "$token" ] \
  && printf '%s' "$token" | pnpm --filter zorvo-credits-server exec wrangler secret put OPERATOR_REFRESH_TOKEN
unset token
```

**Run the login right before you deploy.** The refresh token lives 7 days and the server only spends it when
it first needs NEAR AI (the first alarm tick after the first registration), so a token that was made long
before the deploy may already be dead.

The login also fails if your Mac's clock is ahead of NEAR AI's: it rejects a nonce whose timestamp is in the
future (and one older than 5 minutes). Check your clock first if it answers 401.

What is known and what is not (**unverified until you run it**):

- The request shape comes from NEAR AI's public source (`nearai/cloud-api`, `crates/api/src/routes/auth.rs`
  and `crates/services/src/auth/near.rs`, read 2026-11-07), not from its OpenAPI document, which does
  not list `POST /v1/auth/near`: `signed_message` with `accountId`, `publicKey` and a base64 `signature`,
  and `payload` with `message`, a 32-number `nonce`, `recipient` and an optional `callbackUrl`. The NEP-413
  hashing is pinned in the tests to wallet fixtures from that same source.
- The login works against the real NEAR AI Cloud (first run 2026-11-14). If it is ever refused, the script
  prints the HTTP status and the fallback: sign in to the NEAR AI Cloud dashboard with the operator
  account, copy a refresh token from that session by hand, and store it with
  `wrangler secret put OPERATOR_REFRESH_TOKEN`.
- **The refresh token is bound to the login's User-Agent.** NEAR AI refuses (401) a refresh, or a request
  with the access token it gives, that sends another User-Agent or none (`refresh_middleware` in
  `nearai/cloud-api`). The script and the server send the same value (`LOGIN_USER_AGENT` in
  `scripts/nep413.mjs`, `NEAR_AI_USER_AGENT` in `src/nearai.ts`; a test keeps them equal). A token copied
  from a browser session is bound to that browser's User-Agent and will not work with the server.
- NEAR AI's refresh tokens live 7 days (from its source). Once the alarm is running (it starts with the
  first device registration) the server renews its access token about every 30 minutes, whatever the traffic,
  spends the refresh token for it, and stores the new refresh token (encrypted) before using it. So a
  session does not die of idleness; a dead one comes from a bad, old or already-spent seed, or from a
  session NEAR AI revoked.
- **Re-seeding.** The `OPERATOR_REFRESH_TOKEN` secret seeds the stored token the first time, and again
  whenever its value changes (the server compares a hash of it with the last one it took in). To replace a
  dead session: run the login again and `wrangler secret put OPERATOR_REFRESH_TOKEN` with the new value. The
  new seed is read at the next token refresh: for a dead session that is the next alarm tick, within about a
  minute; while the cached access token is still healthy it is the next scheduled refresh, up to about 30
  minutes later. Putting the same value again does nothing, and an unchanged secret never overwrites the
  rotated token.
- **Unverified: that the server can refresh.** After the first deploy, register a device (the app's Private
  mode does it, or `POST /v1/devices` with a secret hash), which starts the alarm. Within about a minute,
  `wrangler tail` should show no `Alert refresh_failed`. `GET /v1/stock` cannot detect a failed refresh: it
  answers from the last stock snapshot.

### 3. Variables

Set these three in `server/wrangler.jsonc` (`vars`), replacing `set-me`. They are not secret.

| Variable | Value |
| --- | --- |
| `WORKSPACE_ID` | The NEAR AI Cloud workspace the user keys are created in. |
| `ORGANIZATION_ID` | The NEAR AI Cloud organization that pays for them. |
| `OPERATOR_ACCOUNT` | The operator's NEAR account id. The server refuses a PingPay checkout whose payee is any other account. |

The other variables (credits per USD, packages, device cap, stock buffer, model allowlist, API bases)
have working values already; `src/config.ts` documents each one.

### 4. Secrets

Set each with `wrangler secret put`, from `server/` (`pnpm --filter zorvo-credits-server exec wrangler secret put NAME`
works from the repository root). The command asks for the value; do not put it on the command line.

| Secret | What it is |
| --- | --- |
| `OPERATOR_REFRESH_TOKEN` | From step 2. |
| `KEY_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts a NEAR AI key while it waits for handover. Generate it with `openssl rand -base64 32`. Keep a copy in your password manager: without it the stored refresh token and any key not yet collected cannot be decrypted, and changing it has the same effect. |
| `PINGPAY_API_KEY` | From the PingPay dashboard. |
| `PINGPAY_WEBHOOK_SECRET` | The signing secret PingPay shows when you register the webhook (step 5). |
| `ADMIN_TOKEN` | Long random string for the admin route. Generate it with `openssl rand -hex 32`. |
| `ALERT_URL` | Optional. A URL that receives a `POST` of `{ "kind", "detail" }` for each alert (Slack-style incoming webhook relay, ntfy, etc.). Without it, alerts are only log lines. |

### 5. PingPay

1. In the PingPay dashboard, set the **Default Recipient Address** to the operator NEAR account
   **before the first checkout.** PingPay's create-session request has no `recipient` field: the payee
   is that dashboard setting. The server reads the recipient out of each session PingPay answers with and
   refuses (answers 502) any session whose recipient is not `OPERATOR_ACCOUNT`, so a wrong payee fails
   closed instead of sending money elsewhere.
2. Register a webhook for `POST <your-worker-url>/v1/webhooks/pingpay` and put its signing secret into
   `PINGPAY_WEBHOOK_SECRET`. PingPay's dashboard has no event picker: it sends `payment.success` and
   `payment.failed`. The server acts on both (and on `checkout.session.completed` / `.expired` when they
   arrive) by re-reading the checkout session from PingPay, so the webhook itself never credits.

### 6. Deploy, on the right plan

```bash
pnpm --filter zorvo-credits-server run deploy   # the package script, `wrangler deploy`
```

- **The Free plan works with the defaults.** The Ledger's alarm runs every minute. One tick polls at
  most 3 PingPay sessions (`POLLS_PER_TICK`), runs at most 5 queue items (`CREDITS_PER_TICK`), and stops
  starting new items once the next one's worst case would pass 40 outbound requests
  (`TICK_SUBREQUEST_BUDGET`); it reserves 10 requests for a queue item and 2 for a poll, so the budget
  keeps room for the item in progress, and the rest wait for the next tick. On the **Paid** plan, set
  `POLLS_PER_TICK` and `CREDITS_PER_TICK` in `wrangler.jsonc` higher (the old 10 and 20 are safe there)
  and raise `TICK_SUBREQUEST_BUDGET` with them, so a backlog drains faster.
- **What a limit looks like.** In `wrangler tail`, an `Alarm step … failed` line whose message says
  `Too many subrequests` means the tick passed the plan's subrequest limit: lower `TICK_SUBREQUEST_BUDGET`
  or the per-tick limits, or move to Paid. An `Exceeded CPU limit` line is the plan's CPU limit: run fewer
  items per tick or move to Paid. Nothing is lost either way: polls and queue items that did not run stay
  due and are picked up by the next tick.
- The Ledger uses SQLite-backed Durable Object storage (`new_sqlite_classes` in `wrangler.jsonc`).
- **Migrations: only a new column needs one.** Every statement in `src/ledger/schema.ts` is
  `CREATE ... IF NOT EXISTS` and runs in the Ledger's constructor, so a new **table** or **index** is created
  on the next start after a deploy, and is safe to add (a UNIQUE index fails the Ledger's start if existing rows already break it, so check the data first). A new **column** on an existing table is not:
  the table already exists, so the statement changes nothing and old objects would fail at runtime. Write
  and test an `ALTER TABLE` migration first for that.

### 7. Verify on the first live checkout

The implementation could not confirm these from the docs. Do one real $5 checkout with your own device
and check each, in this order:

- **Payee and asset.** The checkout must open. If every `POST /v1/topups` answers 502, the usual causes
  are a wrong **Default Recipient Address** (step 5) or a wrong NEAR USDC asset id. The asset id is the constant `NEAR_USDC_ASSET_ID` in
  `src/pingpay.ts` (`nep141:17208628f84f...`, Circle's native USDC on NEAR from the implementer's
  knowledge; PingPay's docs name none). A wrong asset or recipient **fails closed**: no checkout is sold,
  nothing is lost. Compare against the asset id PingPay shows in its dashboard or in a session answer and
  fix the constant.
- **Auth header.** PingPay's docs disagree: the Quick Start names `x-publishable-key`, the Create Checkout page
  and the example app use `x-api-key`. The client sends `x-api-key`. If PingPay answers 401, the header name
  is the first thing to check.
- **Webhook `resourceId`.** For `checkout.session.*` the server reads the checkout session id from
  `resourceId`. For `payment.success` / `payment.failed`, `resourceId` may be a payment id, so it tries
  `resourceId`, `data.checkoutSessionId`, `data.sessionId` and `data.checkoutSession.id` (strings only, at
  most four, in that order) and uses the first that names a known top-up. When none does, it logs
  `PingPay <type> webhook names no known checkout session; data keys: …` with the sorted key names only,
  never a value or an id. After paying, the top-up should reach `credited` within seconds; if it only
  arrives after a couple of minutes, look for that line and check the payload keys.
- **Webhook timestamp unit and signature.** Verified 2026-11-08 with the dashboard's Test Webhook (both
  deliveries answered 200): `x-ping-timestamp` is in seconds (10 digits), and `x-ping-signature` is a
  64-hex HMAC-SHA256 over `${x-ping-timestamp}.${rawBody}` with the whole `whsec_…` string as the key.
  The server accepts seconds or milliseconds and requires the timestamp within 5 minutes of now; a `401`
  still points at the secret.
- **`payment_mismatch` on the very first paid checkout.** The checkout opened (so the POST answer named the
  asset as `NEAR_USDC_ASSET_ID` expects) but reading the paid session back with GET reported the asset under
  another id. Fix `NEAR_USDC_ASSET_ID` in `src/pingpay.ts` (its `chargesUsdc` check reads both answers) so it
  accepts the id the GET answer uses. The money is safe: nothing is credited and nothing is dropped, and the
  top-up settles on a later poll of the alarm once the constant is right and deployed (a mismatched session
  is asked about again every hour, for 7 days after its checkout).
- **A key handover lost in transit.** The server deletes the pending key when it answers `GET /v1/key`; if that
  answer never reaches the app, the key is gone from the server and not on the Mac. It is the same case as the
  24-hour rule (see "Recovery and the 24-hour key rule"): recover with the device's own code, which issues a
  fresh key against the remaining balance.
- **Fees, minimums and test mode.** What PingPay charges, its minimum amount and whether it has a test mode
  were not documented. Check the dashboard before advertising the $5 package.
- **Where payers land.** The success and cancel pages PingPay sends the payer to are the two sections at the
  end of this file, as `https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-paid` and
  `#checkout-cancelled`, unless the optional variables `CHECKOUT_PAID_URL` and `CHECKOUT_CANCELLED_URL`
  (https only; add them to `vars`) name other pages. The README only exists at that address once it is on
  `main`, so set the two variables while it is not.
- **Session expiry.** The server holds a checkout's stock until the session's `expiresAt` plus 10 minutes,
  at most 70 minutes. If PingPay's answer states no usable `expiresAt` (it is optional in its schema), a
  30-minute session is assumed and the app is told that expiry; a payment that lands later is still credited,
  from stock or after a restock (`paid_waiting_stock`).

## Running it

### Judge promo codes

A promo code gives a device a fixed number of credits, once per device, up to `maxUses` devices. Create
or update one with the admin route (credits at most the device cap, 5,000; `maxUses` at most 10,000; a
code is 4 to 64 visible ASCII characters). Only its hash is stored. Keep the token in a shell variable
read from your password manager, never typed into the command:

The token and the code stay out of every process's argument list: the header comes from a process
substitution and the body from stdin (bash or zsh). The code is generated, not chosen, so it cannot be guessed:

```bash
read -rs ADMIN_TOKEN   # paste the token, press Enter
code="JUDGE-$(openssl rand -hex 8)"
printf '{"code":"%s","credits":300,"maxUses":20}' "$code" \
  | curl -sS -X POST "https://<your-worker-url>/v1/admin/promos" \
      -H @<(printf 'Authorization: Bearer %s\n' "$ADMIN_TOKEN") \
      -H 'content-type: application/json' \
      --data-binary @-
# {"ok":true}
echo "$code"        # hand this code to the judge
```

A promo is paid from your NEAR AI stock like any top-up; if the stock cannot cover it, the redeeming
device is told so (409 `stock`).

### Verifying a judge code without a Mac

`server/scripts/judge-demo.mjs` proves a code end to end from any machine with Node 20 or newer:

```bash
node server/scripts/judge-demo.mjs <worker-url> <judge-code>
# or: ZORVO_JUDGE_URL=... ZORVO_JUDGE_CODE=... node server/scripts/judge-demo.mjs
```

It registers a fresh device, redeems the code, waits for the top-up to reach `credited`, takes the
one-time key, sends one short non-streamed completion to NEAR AI, and checks the signature and the
attestation report. It prints the model, the signature kind, the signer and `Verified`, or why not.
The code, the device secret and the key are never printed. It asks for
`Qwen/Qwen3.8-27B-abliterated`, so that model must be in the Worker's `MODELS` allowlist and deployed; it
checks the Worker's model list before sending and says plainly when the model is not offered.

### Restocking

Top up the operator's NEAR AI organization in the NEAR AI Cloud dashboard (the same PingPay top-up as in
step 1). The server rereads the organization's balance when its last reading is over 2 minutes old; no change
on the server is needed. Sales stay paused while the stock minus what is already promised and the buffer
(`STOCK_BUFFER_NANO`, $2) cannot cover a package. A top-up that was paid while the stock was short waits as
`paid_waiting_stock` and is credited first-in-first-out after the restock; the payer never pays twice.

### Session spending caps

A private draft can cap one session at 100, 200 or 500 credits. The Ledger creates a separate NEAR AI key
for the session (`zorvo-session-<id>`) with that spend limit and lowers the device key by the same amount, so
the invariant is:

`device key limit = spendLimit(credits bought) − active session caps − final usage of ended sessions`

The app receives the session key once and keeps it in its Keychain; the server keeps only the key's id. The
routes are `POST /v1/sessions` (`{credits}` → `{sessionId, key}`), `POST /v1/sessions/:id/end` (idempotent),
`POST /v1/sessions/:id/seen` (called at each turn end, throttled to once a minute) and
`POST /v1/sessions/:id/raise` (`{credits}`, the doubled cap). An end freezes the session key, records its
final usage and raises the device key by the unspent part; a recovery ends every open session first, then
rotates the device key and carries only what is left. The alarm ends a session that has not been seen for
24 hours. The state is the `session_keys` table, created by the schema on the next start (no `ALTER`).

### Alerts

Every alert is a log line (`Alert <kind>: <detail>`) and, when `ALERT_URL` is set, a POST of
`{ "kind", "detail" }`. Read the log live with:

```bash
pnpm --filter zorvo-credits-server exec wrangler tail --format pretty
```

Each kind and subject is raised at most once an hour. Details never contain a token or a key.

| Kind | Means | Do |
| --- | --- | --- |
| `refresh_failed` | The server could not refresh the operator token or read the NEAR AI stock. Credits stop being issued. | Check the NEAR AI status page and the log line. If the refresh token is dead, re-seed it: run the login again and `wrangler secret put OPERATOR_REFRESH_TOKEN` (step 2). |
| `low_stock` | Under about $3 of NEAR AI cost is left to sell. | Restock (above). |
| `stuck_queue` | Credits, key rotations or revokes have waited over an hour. One summary an hour counts them and names the oldest five. | See "A paid top-up that does not arrive". |
| `attempts_exhausted` | An item failed 10 times. It is not dropped: it keeps retrying every 30 minutes. | Read the preceding `Credit for top-up ... failed` log lines for the cause (usually NEAR AI or the token). |
| `payment_mismatch` | A session was paid with another amount or asset than its package. It is **not** credited. | Look the session up in the PingPay dashboard and settle it by hand: refund it, or issue the credits with a promo code. |
| `credit_absorbed` | A credit was counted, then a recovery's key rotation found nothing left: the old key had already spent past its balance (requests in flight when it was frozen), and that overshoot used these credits too. The top-up ends `credited`, the device has no key, nothing was added. | Compare the device's top-ups with its old key's usage in the NEAR AI dashboard. If the payer lost credits they paid for, give them back with a promo code. |

### A paid top-up that does not arrive

The app shows a payer "Payment received, adding credits" until the credit lands. From the server side:

- `GET /v1/topups/<id>` (with the device's Bearer) shows the status: `created` (checkout open),
  `paid` (money in, credit queued), `paid_waiting_stock` (money in, waiting for a restock),
  `credited`, `expired` (checkout not paid; a payment that arrives late is still picked up for 7 days)
  or `failed`.
- `paid` that stays `paid` means the credit is retrying. The cause is in `wrangler tail`: NEAR AI down, the
  operator token stale, or a key rotation for that device failing (it blocks that device's credits until it
  succeeds). After an hour a `stuck_queue` alert fires; after 10 attempts, `attempts_exhausted`. Fix the
  cause and the queue finishes by itself; nothing needs to be re-sent and the payer must not pay again.
- `paid_waiting_stock`: restock.
- `failed` with no checkout: the request died while PingPay was being asked (or PingPay answered a session
  id another top-up already holds, which is logged). The sweep fails such a top-up 40 minutes after it was
  made and gives its stock back; no payment can be matched to it, and the app starts a new top-up.

### Recovery and the 24-hour key rule

A device's secret doubles as its recovery code. Entering it on a new Mac (`POST /v1/recover`) moves the
account to that Mac's new secret and **rotates the NEAR AI key**: the old key is frozen, a new one is created
and the old one revoked. Only the **remaining** balance is carried over, so used credits are not refunded and
recovering does not refill a spent key.

The rotation reads the old key's usage from NEAR AI's key list before and after freezing it. If the list does
not show the key at all while NEAR AI still accepts its freeze, the usage is unknown and the rotation does not
go on (it retries, and raises `attempts_exhausted` after 10 tries): a stale usage would carry over credits
that were already spent. A key NEAR AI no longer knows (404) cannot be spent on, so the usage on record is
used. The freeze is a spend limit at the key's usage, not a deactivation; the old key is revoked right after
the new one exists.

Before it creates a device's key, the server revokes any key named `zorvo-<device id>` that it does not hold
(left by a create whose answer was lost); no one has those keys' secrets. If the key list cannot be read, no
key is created: the credit or rotation waits for its next retry. **Known cost:** a device's first credit reads
the key list once more for this check (a rotation reuses the list it read after the freeze), on top of the
tick's own stock refresh.

A new key is handed over once (`GET /v1/key`) and is kept encrypted on the server for at most **24 hours**
until the device collects it, then deleted for good. A key that was not collected in time is not lost
money: the device recovers with its own code, which issues a fresh key against the same remaining balance.

## Security

- Stored: SHA-256 hashes of device secrets, promo codes and recovery codes; NEAR AI key ids; top-up
  and queue state; the operator's refresh token and access token, both encrypted with `KEY_ENCRYPTION_KEY`,
  and a hash of the refresh-token secret (to notice a replaced secret); and a user's NEAR AI key only
  encrypted, for at most 24 hours, until it is handed over once.
- Also stored: the last model list read from NEAR AI (ids and prices), served when NEAR AI cannot be read or
  its answer cannot be used. Only models NEAR AI marks verifiable (TEE) are ever offered: an answer that lists
  the allowlisted models as not verifiable is taken as it is, so the list can be empty, and a model any answer
  marks not verifiable leaves the stored list too.
- Not stored or seen: prompts and completions (they go from the app to NEAR AI), the operator's NEAR private
  key (it stays on your Mac and is only read by the login script), card or wallet details (PingPay).
- A leaked database exposes no usable user key and no device secret. It would show key ids, balances and
  hashes; promo codes are only guessable if they were weak, so use long ones. The operator's refresh and
  access tokens are only useful together with `KEY_ENCRYPTION_KEY`, which is a Worker secret, not in the
  database.
- Webhooks are accepted only with a valid HMAC signature and a fresh timestamp. The admin route needs
  `ADMIN_TOKEN` (compared in constant time); without it set, nobody is admin.
- Registration, top-ups, promo attempts and recovery attempts are rate-limited per device or per address.
  Registration allows 100 new devices an hour per address: a hackathon venue shares one public address, and a
  device holds nothing until credits are paid for or redeemed. Promo attempts are limited per device (5 an hour,
  every attempt) and per address (20 refused codes an hour; a redemption that works is not counted, so a
  venue's devices can all redeem), so registering more devices buys no extra guesses. An unknown, used-up or already-redeemed code all answer the same `400`; only a valid
  code can get a `409` (`stock`, `device_cap`), which the app needs to tell the user why. Use generated codes
  (as above): a 64-bit code cannot be found at 20 guesses an hour.
  So are admin attempts (20 an hour per address, right or wrong) and wrong device secrets (after 60 in an
  hour from one address it is answered `429`; a device whose secret is valid is never counted). Each check
  still costs one Ledger call; volumetric floods belong to a Cloudflare WAF rate-limiting rule in front.
- `KEY_ENCRYPTION_KEY` must decode to exactly 32 bytes (AES-256); a shorter key is refused, not used.

## After a checkout

Where PingPay sends the payer. Zorvo is the app the payer came from.

### Checkout paid

Thank you. You can close this tab and go back to Zorvo: it adds your credits as soon as the payment is
confirmed, usually within a minute. You do not need to do anything else, and you must not pay a second time.

### Checkout cancelled

The payment was cancelled and nothing was charged. You can close this tab and go back to Zorvo to start a
new top-up whenever you like.
