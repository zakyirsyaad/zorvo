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
pnpm --filter zorvo-credits-server test         # Vitest in the Workers runtime; NEAR AI and PingPay are stubbed
pnpm --filter zorvo-credits-server typecheck
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

Pipe the live run straight into the secret so the token never sits in your shell history or on screen:

```bash
node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file> | pnpm --filter zorvo-credits-server exec wrangler secret put OPERATOR_REFRESH_TOKEN
```

What is known and what is not (**unverified until you run it**):

- The request shape comes from NEAR AI's public source (`nearai/cloud-api`, `crates/api/src/routes/auth.rs`
  and `crates/services/src/auth/near.rs`, read 2026-11-07), not from its OpenAPI document, which does
  not list `POST /v1/auth/near`: `signed_message` with `accountId`, `publicKey` and a base64 `signature`,
  and `payload` with `message`, a 32-number `nonce`, `recipient` and an optional `callbackUrl`. The NEP-413
  hashing is pinned in the tests to wallet fixtures from that same source.
- No one has run the script against the real NEAR AI Cloud. If it is refused, it prints the HTTP status and
  the fallback: sign in to the NEAR AI Cloud dashboard with the operator account, copy a refresh token from
  that session by hand, and store it with `wrangler secret put OPERATOR_REFRESH_TOKEN`. If it is refused,
  record the answer here.
- NEAR AI's refresh tokens live 7 days (from its source). The server renews its access token whenever the
  cached one (trusted for 30 minutes) runs out, spends the refresh token for it, and stores the new refresh
  token (encrypted) before using it. **The secret is only read once**, to seed that stored token the first
  time the server needs it; after that the stored one wins and a later `wrangler secret put
  OPERATOR_REFRESH_TOKEN` is ignored. There is no reset route yet (a known gap): if the stored token ever
  dies (the server was idle for over 7 days, or NEAR AI revoked it), re-seeding means clearing the Ledger's
  `operator` row, which needs a small code change or a fresh Durable Object. Keep the server's traffic
  steady and watch `refresh_failed`.
- Also unverified: after the first deploy, confirm the server can refresh: the first request that needs
  NEAR AI (for example `GET /v1/stock` from a registered device) should answer, not 502; a failed refresh
  logs and raises a `refresh_failed` alert.

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
2. Register a webhook for `POST <your-worker-url>/v1/webhooks/pingpay` with the events
   `checkout.session.completed` and `checkout.session.expired`, and put its signing secret into
   `PINGPAY_WEBHOOK_SECRET`.

### 6. Deploy, on the right plan

```bash
pnpm --filter zorvo-credits-server deploy
```

- **Use the Workers Paid plan.** The Ledger's alarm runs every minute. One tick can poll up to 10 PingPay
  sessions and run up to 20 credit items, each with 1 to 3 outbound calls to NEAR AI, plus the token and
  stock calls. That can pass the **Free** plan's 50 subrequests per invocation; on Free, ticks would fail
  part-way and top-ups would be credited late.
- The Ledger uses SQLite-backed Durable Object storage (`new_sqlite_classes` in `wrangler.jsonc`).
- **Migrations: the first deploy is the only safe one for the current schema.** Tables are created with
  `CREATE TABLE IF NOT EXISTS` and there are no `ALTER` migrations. Any schema change after the first
  deploy (a new column, a new index) needs a migration written and tested first; deploying a changed
  schema as it is would leave old objects without the new column and fail at runtime.

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
- **Webhook `resourceId`.** The server treats `resourceId` of a `checkout.session.*` event as the checkout
  session id. After paying, the top-up should reach `credited` within seconds; if it only arrives after a
  couple of minutes, the webhook did not match and the alarm's polling credited it instead.
- **Webhook timestamp unit.** `x-ping-timestamp` is accepted as seconds or milliseconds and must be within
  5 minutes of now. The docs do not say which; a `401` on every webhook points here or at the secret.
- **Fees, minimums and test mode.** What PingPay charges, its minimum amount and whether it has a test mode
  were not documented. Check the dashboard before advertising the $5 package.
- **Where payers land.** The success and cancel pages PingPay sends the payer to are the two sections at the
  end of this file, as `https://github.com/zakyirsyaad/zorvo/blob/main/server/README.md#checkout-paid` and
  `#checkout-cancelled` (constants in `src/ledger/Ledger.ts`). That file only exists at that address once
  it is on `main`, or after you change those two constants to where it is published.

## Running it

### Judge promo codes

A promo code gives a device a fixed number of credits, once per device, up to `maxUses` devices. Create
or update one with the admin route (credits at most the device cap, 5,000; `maxUses` at most 10,000; a
code is 4 to 64 visible ASCII characters). Only its hash is stored. Keep the token in a shell variable
read from your password manager, never typed into the command:

```bash
read -rs ADMIN_TOKEN   # paste the token, press Enter
curl -sS -X POST "https://<your-worker-url>/v1/admin/promos" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"code":"JUDGE-EXAMPLE-2026","credits":300,"maxUses":20}'
# {"ok":true}
```

A promo is paid from your NEAR AI stock like any top-up; if the stock cannot cover it, the redeeming
device is told so (409 `stock`).

### Restocking

Top up the operator's NEAR AI organization in the NEAR AI Cloud dashboard (the same PingPay top-up as in
step 1). The server rereads the organization's balance when its last reading is over 2 minutes old; no change
on the server is needed. Sales stay paused while the stock minus what is already promised and the buffer
(`STOCK_BUFFER_NANO`, $2) cannot cover a package. A top-up that was paid while the stock was short waits as
`paid_waiting_stock` and is credited first-in-first-out after the restock; the payer never pays twice.

### Alerts

Every alert is a log line (`Alert <kind>: <detail>`) and, when `ALERT_URL` is set, a POST of
`{ "kind", "detail" }`. Read the log live with:

```bash
pnpm --filter zorvo-credits-server exec wrangler tail --format pretty
```

Each kind and subject is raised at most once an hour. Details never contain a token or a key.

| Kind | Means | Do |
| --- | --- | --- |
| `refresh_failed` | The server could not refresh the operator token or read the NEAR AI stock. Credits stop being issued. | Check the NEAR AI status page and the log line. If the stored refresh token is dead, see the note under step 2: a new `OPERATOR_REFRESH_TOKEN` secret is only read when nothing is stored yet. |
| `low_stock` | Under about $3 of NEAR AI cost is left to sell. | Restock (above). |
| `stuck_queue` | A credit, key rotation or revoke has waited over an hour. | See "A paid top-up that does not arrive". |
| `attempts_exhausted` | An item failed 10 times. It is not dropped: it keeps retrying every 30 minutes. | Read the preceding `Credit for top-up ... failed` log lines for the cause (usually NEAR AI or the token). |
| `payment_mismatch` | A session was paid with another amount or asset than its package. It is **not** credited. | Look the session up in the PingPay dashboard and settle it by hand: refund it, or issue the credits with a promo code. |

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

### Recovery and the 24-hour key rule

A device's secret doubles as its recovery code. Entering it on a new Mac (`POST /v1/recover`) moves the
account to that Mac's new secret and **rotates the NEAR AI key**: the old key is frozen, a new one is created
and the old one revoked. Only the **remaining** balance is carried over, so used credits are not refunded and
recovering does not refill a spent key.

A new key is handed over once (`GET /v1/key`) and is kept encrypted on the server for at most **24 hours**
until the device collects it, then deleted for good. A key that was not collected in time is not lost
money: the device recovers with its own code, which issues a fresh key against the same remaining balance.

## Security

- Stored: SHA-256 hashes of device secrets, promo codes and recovery codes; NEAR AI key ids; top-up
  and queue state; the operator's refresh token (encrypted with `KEY_ENCRYPTION_KEY`); and a user's NEAR AI
  key only encrypted, for at most 24 hours, until it is handed over once.
- Not stored or seen: prompts and completions (they go from the app to NEAR AI), the operator's NEAR private
  key (it stays on your Mac and is only read by the login script), card or wallet details (PingPay).
- A leaked database exposes no usable user key and no device secret. It would show key ids, balances and
  hashes; promo codes are only guessable if they were weak, so use long ones. The operator refresh token
  is only useful together with `KEY_ENCRYPTION_KEY`, which is a Worker secret, not in the database.
- Webhooks are accepted only with a valid HMAC signature and a fresh timestamp. The admin route needs
  `ADMIN_TOKEN` (compared in constant time); without it set, nobody is admin.
- Registration, top-ups, promo attempts and recovery attempts are rate-limited per device or per address.

## After a checkout

Where PingPay sends the payer. Zorvo is the app the payer came from.

### Checkout paid

Thank you. You can close this tab and go back to Zorvo: it adds your credits as soon as the payment is
confirmed, usually within a minute. You do not need to do anything else, and you must not pay a second time.

### Checkout cancelled

The payment was cancelled and nothing was charged. You can close this tab and go back to Zorvo to start a
new top-up whenever you like.
