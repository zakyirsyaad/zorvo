# Zorvo Private App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Zorvo side of Zorvo Private (milestones M3 and M4): a device identity in the Keychain, a client for the Zorvo Credits Worker, private Qwen Code sessions on TEE models with the NEAR AI key only in the agent's env, and the Settings, draft, composer and inspector screens drawn in the design canvas.

**Architecture:** A new Rust module `src-tauri/src/private_mode/` owns everything private: the Keychain (behind a `SecretStore` trait), the HTTP client for the Worker (behind a `CreditsApi` trait), a small local state file and the Tauri commands. `acp_start_session` and `acp_reopen_session` take an optional private model id; the launch adds Qwen Code's OpenAI flags and the key, and the ACP manager turns NEAR AI's `402`/`401` into a `PRIVATE_CREDITS:` error the UI reads like `ACP_AUTH_REQUIRED:`. The frontend reads everything through `hooks/usePrivateCredits.ts` and pure helpers in `lib/private-credits.ts`; the webview still makes no network request and never sends a URL, an argument or a key.

**Tech Stack:** Rust (Tauri 2, `ureq` 3, `sha2`, `security-framework` 3.7 for the Keychain and `getrandom` 0.3, both already in the dependency tree, `serde`), React 19 + Tailwind 4, Vitest + Testing Library, the fake ACP agent fixture.

**Spec:** `docs/superpowers/specs/2026-11-07-zorvo-private-near-credits-design.md`, sections 5, 6, 8.1, 8.2, 9, 10, 11, 12. The server's API contract is section 7.4 and `docs/superpowers/plans/2026-11-07-zorvo-credits-server.md` (Tasks 2–8). The look of every screen is the canvas "Zorvo redesign layouts" (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz), section 7: artboards `PrivateSettings`, `PrivateDraft`, `PrivateSession`, `PrivateStates`, `PrivateTopupSteps`, `PrivateFirstRun`, `PrivateErrors`. Read the spec and open the artboard named in a task before starting it.

## Global Constraints

- Scope is the core only. Extensions A–G (M6–M8) get their own plan after M5: the agent credit tools, the four verification badges, the low-balance warning, the Session limit chip, per-session usage and "Used by", the secret guard, and `paymentSource` with your own NEAR AI key are not built here.
- Branch `hackathon/near-credits` only. Nothing here goes to `main`; the custodial pieces and the stored key exist only on this branch (spec section 3).
- The webview's CSP is unchanged: it makes no network request. The Rust backend talks to exactly one new host, the Credits Worker, whose base URL is a compile-time constant: `option_env!("ZORVO_CREDITS_URL")`, default `http://127.0.0.1:8787` (`wrangler dev`); M5 sets the deployed URL. It must be `https://` or `http://127.0.0.1`.
- The UI sends ids, package amounts and codes the user typed, never a URL, a command-line argument, an env var or a key. Checkout URLs come from the Worker and are opened by Rust only when they are `https://pay.pingpay.io/…`.
- The NEAR AI key lives only in the Keychain and in the env of a private Qwen Code process. It is never logged, never returned to the webview, never written to a file and never put in argv.
- Keychain through `security_framework::passwords` (`set_generic_password`, `get_generic_password`, `delete_generic_password`; `errSecItemNotFound` = -25300 means absent), not the `keyring` crate: `keyring` 4 moved its macOS backend into separate store crates, while `security-framework` 3.7.0 is already compiled for the updater. Service `xyz.zorvo.desktop.private`; debug builds append `.` and the first 8 hex characters of the SHA-256 of the app data dir, so scratch `HOME`s in tests and Task 11 never share one device. Accounts `device-secret`, `device-secret-next` (a recovery in flight) and `nearai-key`.
- Recovery code = device secret: `ZRV-` then four groups of four Crockford base32 characters (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), 80 random bits from `getrandom`. Input is normalized: trim, uppercase, drop spaces and dashes after the `ZRV` prefix, `O`→`0`, `I`/`L`→`1`. `secretHash` = lowercase hex SHA-256 of the canonical form `ZRV-XXXX-XXXX-XXXX-XXXX`.
- Private launch, only for agent id `qwen-code` (after `canonical_agent_id`): the registry args, then `--auth-type openai --openai-base-url https://cloud-api.near.ai/v1 --model <id>`; env with `OPENAI_API_KEY` = the Keychain key, and `OPENAI_BASE_URL`, `OPENAI_MODEL` removed. Any other agent with a private model id is refused.
- Model ids from the UI must match `^[A-Za-z0-9._/-]{1,100}$` and be in the last model list the Worker returned (cached 10 minutes in memory, last good list also kept in the state file).
- A private session never runs without its private launch. Every path that starts or continues a session with `privateMode` (start, resume, retry, rewind, fork, import) passes its model id; if the private launch cannot be built, the start fails with a plain reason. Nothing falls back to the user's own Qwen Code sign-in.
- Error markers: `PRIVATE_CREDITS:{"reason":"empty"}` (NEAR AI `402` / `api_key_limit_exceeded`, or no key at launch) and `PRIVATE_CREDITS:{"reason":"key"}` (`401`), only for private sessions.
- Credit math (spec 9): 1 credit = $0.01 bought; 120 credits per $1 of NEAR AI cost. "≈ turns" estimates a turn as 20,000 input + 1,000 output tokens until M5 replaces these two constants with the measured averages.
- Local state file `<app data>/private/state.json`, written atomically, owned by `private_mode` (not `state.json`'s `Settings`, whose typed struct would drop unknown fields).
- Copy follows `docs/design-system/README.md` (sentence case, "you", agents named); colors only from tokens (`design-tokens.test.ts`); controls use `src/components/ui/` primitives and `focus-ring`. Exact strings below are from the artboards.
- Checks: Rust changes need `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and the touched tests; frontend changes need `pnpm lint` and the touched Vitest files only (the full suite is too heavy locally; CI runs it).
- Stage explicit paths only; never `git add -A`.

## Review Focus

1. **A secret or key is accepted by the server but not saved on this Mac.** `GET /v1/key` hands the key over once; `POST /v1/recover` kills the old code at once. Expected: the key is written, read back, and only then reported ready, else the status says "Couldn't save your key in the Keychain. Restore with your recovery code to get a new one."; a recovery stores the new code under `device-secret-next` before it calls the server, so a failed write afterwards can still be finished on the next start. Tests in Task 3.
2. **A private conversation leaves the TEE by a side door.** A fork of a private session (native or handoff), a reopen after a restart, a rewind, or a start while the Worker is down. Expected: each runs private with the session's model, or refuses with a reason; none starts Qwen Code on the user's own sign-in with the conversation. Tests in Task 4 and Task 9.
3. **The user's shell already exports `OPENAI_API_KEY` / `OPENAI_BASE_URL`** (for Codex or a local model). Expected: a private launch replaces them with the Zorvo key and NEAR AI; a non-private launch of any agent is byte-for-byte what it was and never carries the Zorvo key. Test in Task 4.
4. **Restoring on a Mac that has credits of its own, and the Mac the credits left.** Expected: Restore refuses while this Mac's own balance is above 0 or a top-up is pending (it would orphan them), and says why; the old Mac gets `401` and reads "Your credits moved to another Mac" with **Forget on this Mac**, with no retry loop. Tests in Task 3 and Task 8.
5. **Zorvo is quit during checkout.** Expected: the pending top-up is in the state file; on the next start Settings resumes polling it, shows the result (credited, failed, expired or paid-waiting) and, after a first credit, the recovery dialog. Test in Task 7.

---

## File Structure

```text
src-tauri/src/private_mode/
  mod.rs          constants, PrivateError, PRIVATE_CREDITS_PREFIX, re-exports
  device.rs       recovery code, normalize, secret hash, SecretStore, KeychainStore, MemoryStore
  client.rs       CreditsApi trait, HttpCredits (ureq), response types, error mapping
  local_state.rs  private/state.json: recovery flags, pending top-up, last balance, last models
  service.rs      PrivateMode: the logic behind every command (device, key handover, models, top-ups)
  launch.rs       private_launch(): flags and env for a private Qwen Code process
  commands.rs     #[tauri::command(async)] wrappers
src-tauri/src/acp/manager.rs            SessionEntry.private, PRIVATE_CREDITS mapping in prompt
src-tauri/src/acp/commands.rs           private_model_id on start and reopen
src-tauri/src/store.rs                  SessionRecord.private_mode (lenient)
src-tauri/tests/fixtures/fake_acp_agent.mjs   FAKE_ACP_PRIVATE_ERROR
src/lib/private-credits.ts              types, parsing, math, wording
src/hooks/usePrivateCredits.ts          status, stock, models, top-up flow, credits-out per session
src/components/private/                 PrivateModeSection, BalanceCard, TopupPicker, TopupProgress,
                                        PromoField, RecoveryCard, RecoveryCodeDialog, RestoreDialog,
                                        PrivateChip, PrivateModelMenu, PrivateInspector
```

M3 is Tasks 1–5 (Rust); M4 is Tasks 6–10 (frontend) and Task 11 (end to end). Tasks 1–10 can run beside the server plan, since every test fakes the Worker; Task 11 needs the deployed Worker.

---

### Task 1: Device identity and Keychain

**Files:**
- Create: `src-tauri/src/private_mode/mod.rs`, `src-tauri/src/private_mode/device.rs`
- Modify: `src-tauri/Cargo.toml` (under `[target.'cfg(target_os = "macos")'.dependencies]`: `security-framework = "=3.7.0"`; under `[dependencies]`: `getrandom = "=0.3.4"`, both the versions already in `Cargo.lock`), `src-tauri/src/lib.rs` (`pub mod private_mode;`)
- Test: unit tests in `device.rs`

**Interfaces:**
- Produces:
  - `pub fn keychain_service(app_data_dir: &Path) -> String` (the suffix rule of Global Constraints), `DEVICE_SECRET: &str = "device-secret"`, `DEVICE_SECRET_NEXT: &str = "device-secret-next"`, `NEARAI_KEY: &str = "nearai-key"`
  - `pub fn new_recovery_code() -> String`
  - `pub fn normalize_recovery_code(input: &str) -> Option<String>` — canonical form or `None`
  - `pub fn secret_hash(code: &str) -> String` — hex SHA-256 of the canonical code
  - `pub trait SecretStore: Send + Sync { fn get(&self, account: &str) -> Result<Option<String>, PrivateError>; fn set(&self, account: &str, value: &str) -> Result<(), PrivateError>; fn delete(&self, account: &str) -> Result<(), PrivateError>; }`
  - `pub struct KeychainStore { service: String }` over `security_framework::passwords`; not found → `Ok(None)`, delete of a missing item is a no-op, values are UTF-8
  - `pub struct MemoryStore` with `MemoryStore::failing_writes() -> Self` for tests
  - In `mod.rs`: `#[derive(Debug, Clone, PartialEq, Eq, Serialize)] #[serde(rename_all = "snake_case")] pub enum PrivateError { Unreachable, Unauthorized, BadRequest, NotFound, Stock, DeviceCap, RateLimited, Upstream, Keychain, NoDevice, NoKey, BadCode, NotQwen, UnknownModel, BadCheckoutUrl, HasOwnCredits }`, `impl From<PrivateError> for String` giving the snake_case code (commands return `Err(String)` with that code). `pub const PRIVATE_CREDITS_PREFIX: &str = "PRIVATE_CREDITS:"`.

- [ ] **Step 1: Write the failing tests**
  - `new_recovery_code` matches `^ZRV-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$`; 1,000 codes are all distinct.
  - `normalize_recovery_code(" zrv 4k9p-2m7q 8hxd-7f2q ") == Some("ZRV-4K9P-2M7Q-8HXD-7F2Q")`; `"ZRV-4K9P-2M7Q-8HXD-7F2O"` → ends `-7F20`; `"ZRV-IL00-…"` maps `I`,`L` to `1`; wrong length, missing prefix or a `U` → `None`.
  - `secret_hash` of two spellings of one code is equal and 64 hex chars.
  - `MemoryStore`: set then get returns the value; delete then get is `None`; `failing_writes()` returns `Err(PrivateError::Keychain)` on `set`.
  - `keychain_service` has no suffix in release and an 8-hex suffix that differs for two dirs in debug (`cfg!(debug_assertions)`).
- [ ] **Step 2: Run** `cargo test --lib private_mode::device` — FAIL (module missing).
- [ ] **Step 3: Implement** the functions and both stores. `KeychainStore` is not unit-tested (it touches the real Keychain); keep it a thin mapping over `security_framework::passwords`.
- [ ] **Step 4: Run** `cargo test --lib private_mode::device` — PASS; `cargo clippy --all-targets -- -D warnings` clean.
- [ ] **Step 5: Commit** `feat(private): add device recovery code and Keychain store`

### Task 2: Credits client and local state

**Files:**
- Create: `src-tauri/src/private_mode/client.rs`, `src-tauri/src/private_mode/local_state.rs`
- Test: unit tests in both files

**Interfaces:**
- Consumes: `PrivateError` (Task 1).
- Produces (all `serde(rename_all = "camelCase")`, matching spec 7.3–7.4 and server plan Tasks 3, 5, 7, 8):
  - `Balance { credits: u64, used_credits: u64, key_ready: bool, updated_at: String }`
  - `Stock { available_credits: u64, your_room_credits: u64, packages: Vec<StockPackage>, updated_at: String }`, `StockPackage { usd: u32, credits: u64, available: bool, reason: Option<String> }`
  - `ModelPrice { id: String, input_per_m: f64, output_per_m: f64 }`
  - `CreatedTopup { topup_id: String, session_url: String, expires_at: String }`, `TopupState { status: String, credits: u64 }`, `PromoResult { topup_id: String, credits: u64 }`
  - `pub trait CreditsApi: Send + Sync` with `register(&self, secret_hash: &str) -> Result<(), PrivateError>` (201 and 400 both mean registered: a duplicate 80-bit hash can only be this Mac), `balance(&self, secret: &str, fresh: bool) -> Result<Balance, _>`, `stock(&self, secret) -> Result<Stock, _>`, `models(&self, secret) -> Result<Vec<ModelPrice>, _>`, `create_topup(&self, secret, package_usd: u32) -> Result<CreatedTopup, _>`, `topup(&self, secret, id: &str) -> Result<TopupState, _>`, `cancel_topup(&self, secret, id) -> Result<(), _>`, `take_key(&self, secret) -> Result<Option<String>, _>` (404 → `None`), `redeem_promo(&self, secret, code: &str) -> Result<PromoResult, _>`, `recover(&self, code: &str, new_secret_hash: &str) -> Result<(), _>`.
  - `pub struct HttpCredits { base: String, agent: ureq::Agent }`, `HttpCredits::new(base: &str) -> Result<Self, PrivateError>` (rejects a base that is not `https://` or `http://127.0.0.1`), timeouts connect 10 s, global 20 s, response bodies read with a 64 KiB cap.
  - `pub fn error_from(status: u16, body: &str) -> PrivateError` — `{"error":"stock"}` → `Stock`, `device_cap` → `DeviceCap`, `rate_limited` → `RateLimited`, `unauthorized`/401 → `Unauthorized`, `not_found` → `NotFound`, `bad_request` → `BadRequest`, 5xx or `upstream` → `Upstream`; a transport error → `Unreachable`.
  - `local_state.rs`: `LocalState { recovery_saved: bool, recovery_prompted: bool, pending_topup: Option<PendingTopup>, last_balance: Option<LastBalance>, models: Option<CachedModels> }` with `PendingTopup { topup_id: String, expires_at: String, credits: u64 }`, `LastBalance { credits: u64, used_credits: u64, at: String }`, `CachedModels { at: String, list: Vec<ModelPrice> }`; `LocalState::load(dir: &Path) -> LocalState` (missing or malformed file → default, each field read leniently) and `save(&self, dir: &Path) -> Result<(), PrivateError>` (write to a temp file, then rename).

- [ ] **Step 1: Write the failing tests**
  - `error_from` for every row above, including `error_from(502, "<html>")` → `Upstream` and `error_from(409, "{}")` → `BadRequest`.
  - Deserializing the exact JSON examples of spec 7.3 (`Stock`, with `reason: "device_cap"`) and server plan Task 7 (`Balance`).
  - `HttpCredits::new("http://example.com")` → `Err`; `new("http://127.0.0.1:8787")` and `new("https://x.workers.dev")` → `Ok`.
  - Against a one-shot `std::net::TcpListener` stub on 127.0.0.1: `balance("ZRV-…", true)` sends `GET /v1/balance?fresh=1` with `Authorization: Bearer ZRV-…`; `register(h)` sends `POST /v1/devices` with body `{"secretHash":h}`; a 4 MiB body → `Upstream`.
  - `LocalState`: save then load round-trips; a file with `"pendingTopup": 7` loads with `pending_topup: None` and the other fields kept.
- [ ] **Step 2: Run** `cargo test --lib private_mode::client private_mode::local_state` — FAIL.
- [ ] **Step 3: Implement** `HttpCredits` with one private `request(method, path, secret: Option<&str>, body: Option<Value>) -> Result<(u16, String), PrivateError>` helper that every method uses; ureq 3's `http_status_as_error(false)` so statuses reach `error_from`.
- [ ] **Step 4: Run** the same tests — PASS.
- [ ] **Step 5: Commit** `feat(private): add the Credits Worker client and local state`

### Task 3: The private-mode service and its commands

**Files:**
- Create: `src-tauri/src/private_mode/service.rs`, `src-tauri/src/private_mode/commands.rs`
- Modify: `src-tauri/src/lib.rs` (manage `PrivateMode`, register the commands in `generate_handler!`)
- Test: unit tests in `service.rs` with `MemoryStore` and a `FakeCredits: CreditsApi` (in the test module; records calls, returns scripted answers)

**Interfaces:**
- Consumes: Tasks 1–2; `windows::open_url(url: &str) -> Result<(), String>` (`pub(crate)`, runs `open`) to open a checkout.
- Produces:
  - `pub struct PrivateMode { store: Box<dyn SecretStore>, api: Box<dyn CreditsApi>, dir: PathBuf, open: Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>, models: Mutex<Option<(Instant, Vec<ModelPrice>)>>, checkouts: Mutex<HashMap<String, String>>, registered: AtomicBool, handover: Mutex<()> }` with `PrivateMode::new(store, api, dir, open)`.
  - `fn ensure_device(&self) -> Result<String, PrivateError>` — the secret; when there is none, a new code is `set` first and then registered. Called by `stock`, `models`, `create_topup` and `redeem_promo`, so opening Settings → Private mode or turning on the draft's Private chip creates the device; app start and `status` never do.
  - `#[serde(rename_all = "camelCase")] pub struct PrivateStatus { device: DeviceState, key_ready: bool, key_error: Option<PrivateError>, balance: Option<Balance>, balance_error: Option<PrivateError>, last_balance: Option<LastBalance>, recovery_saved: bool, recovery_prompted: bool, pending_topup: Option<PendingTopup> }`, `#[serde(rename_all = "snake_case")] pub enum DeviceState { None, Ready, Moved }`.
  - Methods (each a command of the same name prefixed `private_`):
    - `status(&self, fresh: bool) -> PrivateStatus` — first finishes a recovery left in `device-secret-next` (a `balance` call with it that succeeds promotes it to `device-secret`; a `401` deletes it); no secret → `DeviceState::None` and no network call; else ensure registered, `balance(fresh)`; `401` → `Moved`; other errors → `balance_error` with `last_balance`; success updates `last_balance`. When `key_ready` is false locally (no `nearai-key`) and the device exists, `take_key` under the `handover` lock; a key is `set`, then `get` and compared; any mismatch or error → `key_error: Some(Keychain)`.
    - `stock(&self) -> Result<Stock, PrivateError>`
    - `models(&self) -> Result<Vec<ModelPrice>, PrivateError>` — memory cache for 10 minutes, then the Worker; success also saved as `CachedModels`; Worker error → the state file's list when present, else the error.
    - `create_topup(&self, package_usd: u32) -> Result<PendingTopup, PrivateError>` — creates the device first when there is none (new code, `set` it, `register`); calls the Worker; checks `session_url` is `https` with host `pay.pingpay.io` (else `BadCheckoutUrl`, nothing opened); keeps the URL in `checkouts`, saves `pending_topup` (`credits = package_usd × 100`), opens it with `open`.
    - `open_checkout(&self, topup_id: &str) -> Result<(), PrivateError>` — only a URL in `checkouts` (`NotFound` otherwise).
    - `topup_status(&self, topup_id: &str) -> Result<TopupState, PrivateError>` — `credited`, `failed` or `expired` clears `pending_topup` and the checkout URL; `credited` also runs the key handover of `status`.
    - `cancel_topup(&self, topup_id: &str) -> Result<(), PrivateError>` — Worker cancel, then clears it locally.
    - `redeem_promo(&self, code: &str) -> Result<PromoResult, PrivateError>` — trims, rejects empty or over 64 chars as `BadCode`, creates the device if needed, maps `BadRequest` → `BadCode`; saves the result as `pending_topup` so the same polling finishes it.
    - `recovery_code(&self) -> Result<String, PrivateError>` — the secret; `NoDevice` when there is none.
    - `mark_recovery(&self, saved: bool) -> Result<(), PrivateError>` — sets `recovery_prompted = true`, and `recovery_saved = saved`.
    - `recover(&self, input: &str) -> Result<String, PrivateError>` — `normalize_recovery_code` or `BadCode`; `HasOwnCredits` when this Mac has a device whose last balance is above 0 or a pending top-up; new code `set` under `device-secret-next`; `api.recover(old, secret_hash(new))` (`BadRequest` → `BadCode`, and `device-secret-next` deleted); on success `set` `device-secret` to it, delete `device-secret-next` and `nearai-key`, set `recovery_saved = false`, `recovery_prompted = false`; returns the new code so the UI can show it at once. The rotated key arrives through the next `status`.
    - `forget_device(&self) -> Result<(), PrivateError>` — deletes both Keychain items and resets the state file.
    - `launch_key(&self) -> Result<String, PrivateError>` — the Keychain key or `NoKey` (used by Task 4, not a command).

- [ ] **Step 1: Write the failing tests**
  - `status(false)` with an empty store makes no API call and returns `DeviceState::None`.
  - First `create_topup(10)`: the store holds a valid recovery code, `register` was called with its hash, the pending top-up is saved; a Worker URL `https://evil.example/pay` → `BadCheckoutUrl` and no open (inject the opener as `Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>` in `new` so the test records it).
  - `status` with `take_key` returning `"sk-test"` stores it and reports `key_ready: true`; with `MemoryStore::failing_writes()` it reports `key_error: Some(Keychain)` and `key_ready: false` (Review Focus 1).
  - `balance` → `Unauthorized` gives `DeviceState::Moved` (Review Focus 4); → `Unreachable` gives `balance_error: Some(Unreachable)` and the previous `last_balance`.
  - `models` returns the state file's list when the Worker is unreachable and nothing is cached in memory (Review Focus 2); with neither, `Err(Unreachable)`.
  - `recover("zrv 4k9p 2m7q 8hxd 7f2q")` sends the canonical old code and the new code's hash, replaces `device-secret`, deletes `nearai-key`, and returns the new code; a Worker `BadRequest` → `BadCode` and the store unchanged; with a last balance of 50 → `HasOwnCredits` and no call (Review Focus 4).
  - A store holding `device-secret-next` whose `balance` succeeds: `status` promotes it to `device-secret` (Review Focus 1); one whose `balance` is `401` is deleted.
  - `stock()` with an empty store creates and registers a device; `status(false)` with an empty store still makes no call.
  - `topup_status` returning `credited` clears `pending_topup` and runs the key handover.
- [ ] **Step 2: Run** `cargo test --lib private_mode::service` — FAIL.
- [ ] **Step 3: Implement** `PrivateMode` and `commands.rs` (`#[tauri::command(async)]`, each `State<'_, PrivateMode>` and returning `Result<T, String>` via `PrivateError`'s code). In `lib.rs` (in `setup`, where the app data dir is known) build it with `KeychainStore { service: keychain_service(&dir) }`, `HttpCredits::new(CREDITS_BASE_URL)`, `<app data dir>/private` and `windows::open_url`.
- [ ] **Step 4: Run** `cargo test --lib private_mode` — PASS; `cargo clippy --all-targets -- -D warnings` clean.
- [ ] **Step 5: Commit** `feat(private): add private-mode commands for balance, top-ups and recovery`

### Task 4: Launching a private Qwen Code session

**Files:**
- Create: `src-tauri/src/private_mode/launch.rs`
- Modify: `src-tauri/src/acp/manager.rs` (`AcpLaunch` gains `pub private: bool`; its 16 struct literals in `acp/manager.rs`, `acp/commands.rs`, `acp/terminal_auth.rs`, `tests/it/common/mod.rs`, `tests/it/acp_manager_test.rs` and `tests/it/acp_session_list_test.rs` set `private: false`), `src-tauri/src/acp/commands.rs` (`acp_start_session` and `acp_reopen_session` gain `private_model_id: Option<String>`)
- Test: unit tests in `launch.rs`; `acp/commands.rs` tests for the refusal paths

**Interfaces:**
- Consumes: `PrivateMode::models`, `PrivateMode::launch_key` (Task 3); `launch_in_workspace` (`acp/commands.rs`), `registry::resolve::canonical_agent_id`.
- Produces:
  - `pub fn private_launch(launch: AcpLaunch, profile_id: &str, model_id: &str, models: &[ModelPrice], key: &str) -> Result<AcpLaunch, PrivateError>` — `NotQwen` unless `canonical_agent_id(profile_id) == "qwen-code"`; `UnknownModel` unless the id matches the charset and is in `models`; returns the launch with the four flags appended, `OPENAI_BASE_URL` and `OPENAI_MODEL` removed, `OPENAI_API_KEY` set to `key`, and `private: true`.
  - `fn launch_for_session(store, private: &PrivateMode, cwd, profile_id, private_model_id: Option<&str>) -> Result<AcpLaunch, String>` in `acp/commands.rs`, used by both commands: `None` → today's `launch_in_workspace` unchanged; `Some` → `launch_in_workspace`, then `models()`, `launch_key()` (`NoKey` → the string `PRIVATE_CREDITS:{"reason":"empty"}`), then `private_launch`.

- [ ] **Step 1: Write the failing tests**
  - `private_launch` for `qwen-code` and model `Qwen/Qwen3.8-27B`: args end with `["--auth-type","openai","--openai-base-url","https://cloud-api.near.ai/v1","--model","Qwen/Qwen3.8-27B"]`; env has `OPENAI_API_KEY=sk-test`; an input env holding `OPENAI_API_KEY=user`, `OPENAI_BASE_URL=http://localhost:11434` comes out with only the Zorvo key and no base URL (Review Focus 3); no argument contains `sk-test`.
  - `claude-acp` → `NotQwen`; `Qwen/Qwen3.8-27B; rm -rf` and a model not in the list → `UnknownModel`.
  - `launch_for_session(…, None)` equals `launch_in_workspace(…)` for a fixture profile, with `private: false` and no `OPENAI_API_KEY` added (Review Focus 3).
  - With a `PrivateMode` whose store has no key: `Err` starting with `PRIVATE_CREDITS:`.
- [ ] **Step 2: Run** `cargo test --lib private_mode::launch acp::commands` — FAIL.
- [ ] **Step 3: Implement**; the commands take `private: State<'_, PrivateMode>` and pass `private_model_id.as_deref()`. Fork is unchanged: a native fork shares the source's process and its env.
- [ ] **Step 4: Run** the same tests plus `cargo test --test it acp_manager_test::` — PASS.
- [ ] **Step 5: Commit** `feat(private): launch Qwen Code on NEAR AI TEE models with the key in its env only`

### Task 5: `PRIVATE_CREDITS` errors and the saved session field

**Files:**
- Modify: `src-tauri/src/acp/manager.rs` (`SessionEntry.private: bool` from `AcpLaunch.private`, copied to a native fork's entry; mapping in `prompt`'s callback), `src-tauri/src/store.rs` (`SessionRecord.private_mode: Option<PrivateModeRecord>`, `PrivateModeRecord { model_id: String }`, lenient: a malformed value reads as `None`), `src-tauri/tests/fixtures/fake_acp_agent.mjs`
- Test: unit tests in `manager.rs` and `store.rs`; `src-tauri/tests/it/acp_manager_test.rs`

**Interfaces:**
- Produces:
  - `fn private_credits_reason(error: &Value) -> Option<&'static str>` — over the lowercased JSON text of the whole error (message and data): `"empty"` when it contains `api_key_limit_exceeded` or a token exactly `402` (split on non-alphanumerics); else `"key"` for a token exactly `401` or the phrase `invalid or expired api key`; else `None`.
  - In `prompt`, before the sign-in check: when the entry is private and `private_credits_reason` is `Some(r)`, the turn's error is `format!("{PRIVATE_CREDITS_PREFIX}{{\"reason\":\"{r}\"}}")`.
  - Fake agent: `FAKE_ACP_PRIVATE_ERROR=402` answers every `session/prompt` with `{code: -32603, message: "Internal error", data: {details: "402 api_key_limit_exceeded"}}`; `=401` with `details: "401 Invalid or expired API key"`.

- [ ] **Step 1: Write the failing tests**
  - `private_credits_reason`: the two fake-agent errors → `empty` / `key`; `{"message":"read 4021 tokens"}` → `None`; a plain `-32603` → `None`.
  - Integration: a session started with a private launch of the fake agent and `FAKE_ACP_PRIVATE_ERROR=402` ends its turn with error `PRIVATE_CREDITS:{"reason":"empty"}`; the same agent launched non-private ends with the ordinary `Internal error` text.
  - `store.rs`: a session JSON with `"privateMode":{"modelId":"Qwen/Qwen3.8-27B"}` round-trips; `"privateMode":"x"` loads as `None` with the session kept.
- [ ] **Step 2: Run** `cargo test --lib acp::manager store` and `cargo test --test it acp_manager_test::` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` — PASS. This is M3's done check: a private session starts with the key only in its env.
- [ ] **Step 5: Commit** `feat(private): report private credit and key errors to the UI`

---

### Task 6: Frontend types, math and wording

**Files:**
- Create: `src/lib/private-credits.ts`
- Modify: `src/types/index.ts` (`Session.privateMode?: { modelId: string }`), `src/lib/persistence.ts` (`withValidFields` keeps `privateMode` only when `modelId` is a string)
- Test: `src/test/private-credits.test.ts`, the existing persistence test file

**Interfaces:**
- Produces:
  - TypeScript mirrors of Task 2–3 types: `PrivateStatus`, `DeviceState = 'none' | 'ready' | 'moved'`, `Balance`, `Stock`, `StockPackage`, `ModelPrice`, `PendingTopup`, `TopupState`, `PromoResult`, `PrivateErrorCode` (the snake_case codes of Task 1).
  - `PRIVATE_CREDITS_PREFIX = 'PRIVATE_CREDITS:'`, `parsePrivateCredits(error: unknown): { reason: 'empty' | 'key' } | null`
  - `TURN_INPUT_TOKENS = 20_000`, `TURN_OUTPUT_TOKENS = 1_000`, `CREDITS_PER_USD_COST = 120`
  - `creditsPerTurn(model: ModelPrice): number`, `turnsFor(credits: number, model: ModelPrice): number` (floored)
  - `modelLabel(id: string): string` — the part after the last `/`, hyphens to spaces (`Qwen/Qwen3.8-27B` → `Qwen3.8 27B`)
  - `formatCredits(n: number): string` (`1240` → `1,240 credits`, `1` → `1 credit`), `perTurnLabel(model)` (`≈ 0.3 credit a turn`, `≈ 9 credits a turn`)
  - `packageReason(reason?: string): string | undefined` — `stock` → `Not enough stock right now`, `device_cap` → `Over your 5,000-credit limit`
  - `privateErrorText(code: PrivateErrorCode | string): string` — `unreachable` → `Couldn't reach the credits server.`; `stock` → `Top-ups are paused for now.`; `device_cap` → `That would take you over your 5,000-credit limit.`; `rate_limited` → `Too many tries. Wait a few minutes and try again.`; `bad_code` → `That code didn't work. Check it and try again.`; `keychain` → `Couldn't save your key in the Keychain. Restore with your recovery code to get a new one.`; `bad_checkout_url` / `upstream` → `Couldn't open checkout. Nothing was held or charged.`; `unknown_model` → `That model isn't offered anymore. Start a new private session to pick another.`; `has_own_credits` → `This Mac has credits of its own. Spend them, or restore this Mac's code on the other one instead.`; `no_device` / `no_key` → `This Mac has no private credits yet.`; anything else → `Something went wrong. Try again.`
  - `updatedAgo(iso: string, now: number): string` via the existing `lib/relative-time.ts`

- [ ] **Step 1: Write the failing tests** for each function above with those exact strings; `parsePrivateCredits('PRIVATE_CREDITS:{"reason":"empty"}')` → `{reason:'empty'}`, a malformed JSON tail or another reason → `null`, an `Error` object whose message has the prefix is read too; `creditsPerTurn({id:'k', inputPerM: 3.3, outputPerM: 16.5})` ≈ `9.9`; persistence keeps `privateMode: {modelId:'a'}` and drops `privateMode: {modelId: 3}`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/private-credits.test.ts src/test/persistence.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `feat(private): add private credits types, math and wording`

### Task 7: `usePrivateCredits` and the top-up flow

**Files:**
- Create: `src/hooks/usePrivateCredits.ts`
- Modify: `src/test/setup.ts` (fake `private_*` commands: a scriptable in-memory backend, like the store fake)
- Test: `src/test/use-private-credits.test.tsx`

**Interfaces:**
- Consumes: Task 6; commands of Task 3.
- Produces: `usePrivateCredits(): PrivateCredits` with
  - `status: PrivateStatus | null`, `stock: Stock | null`, `models: ModelPrice[] | null`, `modelsError?: string`
  - `refresh(fresh?: boolean): Promise<void>` (loads status and stock; `fresh` maps to `private_status { fresh: true }`)
  - `flow: TopupFlow` where `type TopupFlow = { kind: 'idle' } | { kind: 'opening'; usd: number } | { kind: 'waiting'; topup: PendingTopup } | { kind: 'paid'; topup: PendingTopup } | { kind: 'credited'; credits: number } | { kind: 'failed' | 'expired'; topupId: string } | { kind: 'waiting-stock'; topup: PendingTopup } | { kind: 'error'; code: string }`
  - `buy(usd: number)`, `openCheckout()`, `cancel()`, `dismiss()`, `redeem(code: string): Promise<{ ok: true; credits: number } | { ok: false; text: string }>`, `recover(code: string): Promise<{ ok: true; newCode: string } | { ok: false; text: string }>`, `revealCode(): Promise<string>`, `markRecovery(saved: boolean)`, `forget()`
  - `creditsOut: Readonly<Record<string, 'empty' | 'key'>>`, `markCreditsOut(sessionId, reason)`; an entry `empty` is dropped when a status shows `credits > 0`, `key` when `keyReady` turns true.
  - `needsRecoveryDialog: boolean` — true after a first credit while `!recoverySaved && !recoveryPrompted`.
- Behaviour: polls `private_topup_status` every 3 s while `waiting` or `paid` (server statuses `created` → waiting, `paid` → paid, `paid_waiting_stock` → waiting-stock, `credited` → credited then `refresh(true)`, `failed` → failed, `expired` → expired), and stops on any other kind or unmount. On mount, a `pendingTopup` in the status resumes polling (Review Focus 5). A credit that lands while the window is not focused calls `notifyIfAway` (`lib/notify.ts`) with `+N credits` / `Private sessions can use them now.` `redeem` uses the same polling through its `topupId`. One instance is built in `App.tsx` and passed down, like `agentSignIn`.

- [ ] **Step 1: Write the failing tests** (fake timers): buy → `opening` → `waiting`; the fake answers `paid`, then `credited` → `credited` with the package's credits and one `private_status { fresh: true }` call; `failed` and `expired` end polling (no call after 10 s more); mount with `pendingTopup` set and the fake answering `credited` → `credited` without any `buy` (Review Focus 5); `needsRecoveryDialog` true after the first credit and false after `markRecovery(true)`; `markCreditsOut('s1','empty')` is cleared by a refresh that shows 300 credits; `buy` rejected with `stock` → `{kind:'error', code:'stock'}`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/use-private-credits.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(private): add the private credits hook and top-up flow`

### Task 8: Settings → Private mode

**Files:**
- Create: `src/components/private/PrivateModeSection.tsx`, `BalanceCard.tsx`, `TopupPicker.tsx`, `TopupProgress.tsx`, `PromoField.tsx`, `RecoveryCard.tsx`, `RecoveryCodeDialog.tsx`, `RestoreDialog.tsx` (all under `src/components/private/`)
- Modify: `src/components/SettingsPanel.tsx` (`SettingsTab` adds `"private"`, label `Private mode`, after `Agents`), `src/components/AppSettingsDialog.tsx` (renders the section with the `usePrivateCredits` instance), `src/App.tsx` (builds the instance; shows `RecoveryCodeDialog` when `needsRecoveryDialog`)
- Test: `src/test/private-mode-section.test.tsx`

Artboards: `PrivateSettings`, `PrivateFirstRun`, `PrivateTopupSteps`, `PrivateErrors` (Settings parts), `PrivateStates`.

**Interfaces:**
- Consumes: `PrivateCredits` (Task 7), Task 6 wording.
- Produces: `PrivateModeSection({ credits }: { credits: PrivateCredits })`; the others are internal to the section.

What each part shows (exact copy from the artboards):
- `BalanceCard`: `N credits`; `One balance for every private session on this Mac · N used so far`; `Key ready` / `No key yet`; `Updated N min ago` and **Refresh** (`refresh(true)`); first run: `You haven't topped up yet. Your first top-up also sets up the private key this Mac uses.` plus `Got a promo code? Redeem it under the packages to try Private mode for free.`; Worker unreachable: `Balance unavailable` and `Last known: N credits · <ago>` with **Try again**; moved: `Your credits moved to another Mac` and **Forget on this Mac**; `keyError`: its text; when `recoveryPrompted && !recoverySaved`: a note `Save your recovery code` that opens the dialog. The per-model "Used by" list is not built here: it needs the per-session cost of extension E.
- `TopupPicker`: a radio group of the stock's packages (`$5`, `500 credits`, `≈ N turns` on the first model), a disabled one with `packageReason`; when `availableCredits < 2500` the line `Stock: N credits · more coming soon` and `Stock is checked before checkout, so you never pay for credits that aren't there.`; after a pick, the confirm row `1,000 credits for $10` with **Pay $10**; `Credits can't be refunded or withdrawn.` Nothing opens on a single click.
- `TopupProgress` (replaces the picker while `flow` is not idle): opening/waiting `Waiting for your payment`, `Your 1,000 credits are held for 25 minutes while you pay.`, **Open checkout again**, **Cancel**; paid `Payment received` / `Adding 1,000 credits to this Mac. You don't need to do anything.`; credited `+1,000 credits` / `Balance N credits`; failed `Your payment didn't go through` / `No credits were added. If PingPay received part of it, PingPay handles the refund. You can try again, with another chain or a card.`; expired `Checkout closed without paying`; waiting-stock `Paid. Credits come with the next restock` / `The 25-minute hold ran out and the stock sold out meanwhile. Your payment counts, and you're first in line when stock comes back.`; error `privateErrorText(code)`. Each end state has **Try again** or **Done** (`dismiss`).
- `PromoField`: `Got a code from Zorvo? Its credits land here.`, input, **Redeem**; inline `+300 credits added` or the error text.
- `RecoveryCard`: masked code `ZRV-••••-••••-••••-7F2Q` (last group only, from `revealCode`), **Show**, **Copy**, `Moves your credits to another Mac. Anyone with this code can use your credits, so keep it somewhere safe.`; **Restore…** opens `RestoreDialog` (`Enter a code from another Mac. That Mac stops using these credits, and you get a new code.`), which on success shows the new code in `RecoveryCodeDialog`.
- `RecoveryCodeDialog`: `Save your recovery code`, the code, **Copy**, `Anyone with this code can use your credits. Keep it in a password manager, not in a chat.`, checkbox `I saved it somewhere safe` enabling **Done** (`markRecovery(true)`), **Remind me later** (`markRecovery(false)`).
- The code is never put in React state longer than the dialog or the reveal is open, and never logged.

- [ ] **Step 1: Write the failing tests:** first run shows `0 credits` and `No key yet`; a `device_cap` package is disabled with `Over your 5,000-credit limit`; picking `$10` shows `1,000 credits for $10` and calls nothing; **Pay $10** calls `private_create_topup { packageUsd: 10 }` once; `TopupProgress` copy for `paid`, `failed`, `waiting-stock`; moved shows **Forget on this Mac** (Review Focus 4); unreachable shows `Last known: 1,240 credits`; the recovery dialog's **Done** is disabled until the checkbox is ticked; restore with a bad code shows `That code didn't work. Check it and try again.`
- [ ] **Step 2: Run** `pnpm vitest run src/test/private-mode-section.test.tsx` — FAIL.
- [ ] **Step 3: Implement**, following the artboards for layout and the design-system primitives.
- [ ] **Step 4: Run** the test, `pnpm vitest run src/test/design-tokens.test.ts`, and `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(private): add the Private mode section to Settings`

### Task 9: Private drafts and session start

**Files:**
- Create: `src/components/private/PrivateChip.tsx`, `src/components/private/PrivateModelMenu.tsx`, `src/lib/private-draft.ts`
- Modify: the new-session draft that renders `AgentMultiPicker` (adds the chip and, when on, swaps the model chip for `PrivateModelMenu`), `src/hooks/useAcpSessions.ts` (`start(sessionId, cwd, profileId, privateModelId?)`, `reopen(…, privateModelId?)` → `invoke(…, { …, privateModelId })`), `src/hooks/session-engine/useAcpEngine.ts` (every start and resume, including retry and rewind, passes `session.privateMode?.modelId`), `src/App.tsx` (a private draft creates its session with `privateMode: { modelId }`; while the draft's Private chip is on, `draftNeedsSignIn` is false and no sign-in panel opens, since the private launch never uses Qwen Code's own sign-in; the install check stays), `src/hooks/useSessionFork.ts` and `SessionSpec` (a fork copies the source's `privateMode`, so both a native fork and a handoff fork stay private), the sidebar row component (a `Shield` icon with `aria-label="Private session"` for sessions with `privateMode`)
- Test: `src/test/private-draft.test.ts`, `src/test/private-chip.test.tsx`, the existing `useAcpSessions` / engine tests for the extra argument

Artboards: `PrivateDraft`, `PrivateFirstRun` (draft part), `PrivateMore` (other agents, sidebar).

**Interfaces:**
- Consumes: `PrivateCredits` (Task 7), Task 6.
- Produces:
  - `privateDraftState(input: { agentIds: string[]; on: boolean; status: PrivateStatus | null; models: ModelPrice[] | null }): { chip: 'hidden' | 'off' | 'on' | 'disabled'; reason?: string; canStart: boolean; note?: string }` — one agent `qwen-code` → chip `off`/`on`; one other agent → `disabled`, reason `Private sessions run Qwen Code only for now.`; two or more ticked → `disabled`, reason `Private sessions run one agent.`; on with device `moved` → `canStart: false`, note `Your credits moved to another Mac.`; on with 0 credits or no key → `canStart: false`, note `Add credits to start a private session`; on with no models → `canStart: false`, note `Couldn't load the private models. Try again.`
  - `PrivateChip` label `Private · TEE`, a toggle; `PrivateModelMenu` lists `models` as `modelLabel` and `$in / $out · perTurnLabel`, header `Private models · run in a TEE`, footer `Claude, GPT and Gemini aren't offered here: they don't run in a TEE.`; default pick = the first model.
  - The draft note goes into `composerNote` (Task 10) so Send's `aria-describedby` reads it; the composer's credits line `N credits left`.

- [ ] **Step 1: Write the failing tests:** every row of `privateDraftState`; the chip's disabled reason is announced; starting a private draft calls `acp_start_session` with `privateModelId: 'Qwen/Qwen3.8-27B'` and the new session carries `privateMode`; resuming a saved private session calls `acp_reopen_session` with its `privateModelId`; a handoff fork of a private session starts with the same `privateModelId` and its record carries `privateMode` (Review Focus 2); with Private on and Qwen Code reported signed out, the draft shows no sign-in panel and Start follows only the credits; a non-private start sends no `privateModelId` key.
- [ ] **Step 2: Run** `pnpm vitest run src/test/private-draft.test.ts src/test/private-chip.test.tsx` and the touched engine test — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(private): start private Qwen Code sessions from the draft`

### Task 10: Credits running out, and the Private inspector tab

**Files:**
- Create: `src/components/private/PrivateInspector.tsx`
- Modify: `src/lib/composer-state.ts` (`composerNote` input gains `privateNote?: string`, ranked after `agentToSignIn`), `src/hooks/session-engine/useAcpEngine.ts` (`onTurnEnd` and the open-error path: `parsePrivateCredits(error)` → `onPrivateCreditsOut(sessionId, reason)` and the message is given back like a sign-in refusal, before `turnEndNotice`), `src/App.tsx` (wires `onPrivateCreditsOut` to `markCreditsOut`; blocks Send for a session in `creditsOut`; the note's actions), `src/lib/inspector.ts` (`InspectorTab` adds `"private"`, offered only for a session with `privateMode`), the inspector's tab list, `src/lib/popout-bridge.ts` (`SessionLiveStatus.privateCreditsOut?: 'empty' | 'key'`, so a popout shows the note and blocks its Send too)
- Test: `src/test/composer-state.test.ts`, `src/test/private-credits-out.test.tsx`, `src/test/private-inspector.test.tsx`

Artboards: `PrivateStates` (credits out), `PrivateSession` (Private tab), `PrivateErrors`.

**Interfaces:**
- Consumes: Tasks 6, 7, 9; `giveBackMessage` (`hooks/useUnsentMessages.ts`); the engine's `fork(sourceSessionId, session)`.
- Produces:
  - Notes: `empty` → `Your credits ran out. Top up to continue.` with **Top up** (opens Settings on the `private` tab) and **Continue with another agent**; `key` → `This Mac's private key stopped working. Restore it in Settings → Private mode.` with **Open Settings**.
  - **Continue with another agent** opens a confirm: `Continue with another agent?` / `The conversation so far goes to the agent you pick, outside the TEE.`; on confirm, the existing fork-to-new-session path with a non-private session record for the picked agent (no `privateMode`).
  - `PrivateInspector({ session, credits })`: `Model`, `Balance` with **Top up**, `Where it runs` / `NEAR AI Cloud, inside Intel TDX and NVIDIA confidential computing. The credits server never sees your prompts.`, **Open the Verification Center** (`open_external_url` with a constant `VERIFICATION_CENTER_URL` looked up in NEAR AI's docs in this task; if the docs name no such page, leave the button out). The session-limit, turn count and verified-answers rows belong to extensions D, E and B.

- [ ] **Step 1: Write the failing tests:** `composerNote` returns the `empty` text and ranks it below `agentToSignIn`; a turn ending with `PRIVATE_CREDITS:{"reason":"empty"}` gives the message back to the composer, marks the session, and shows no generic failure notice; Send stays blocked for that session and not for another; a refresh showing credits unblocks it; **Continue with another agent** shows the TEE warning before anything starts; the Private tab exists only for a session with `privateMode`.
- [ ] **Step 2: Run** the three test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(private): handle credits running out and add the Private inspector tab`

### Task 11: End to end against the deployed Worker

Needs the server plan done and M5's first step (the Worker deployed, the operator organization funded, its refresh token set). It uses promo codes, so no payment is needed; the real $5 top-up stays in M5. No new code unless this finds a bug (then fix it in the task that owns the code, with a test).

- [ ] **Step 1:** Create two promo codes with the admin route: one of 300 credits and one of 1 credit (a spend limit of about $0.008, which one turn on Kimi K3 exceeds). Build Zorvo with `ZORVO_CREDITS_URL=<deployed Worker URL>` (`pnpm tauri dev`). First confirm the Keychain works under a scratch `HOME` (Settings → Private mode creates a device and `security find-generic-password -s xyz.zorvo.desktop.private.<suffix> -a device-secret` finds it); if a scratch `HOME` cannot reach the login keychain, use a second macOS user for the second "Mac" instead. A scratch `HOME` has no `~/.qwen`, which also checks that the flags alone are enough for Qwen Code.
- [ ] **Step 2:** In the real app with a scratch `HOME` (the project's real-app E2E harness): Settings → Private mode shows `0 credits · No key yet`; redeem the 300-credit code → `+300 credits added`, `Key ready`, the recovery dialog; start a private Qwen Code draft on Qwen 3.8 27B and get an answer; confirm with `ps eww <pid>` that the agent's env has `OPENAI_API_KEY` and its argv has the four flags but no key.
- [ ] **Step 3:** On a second scratch `HOME`, redeem the 1-credit code, start a private session on Kimi K3 and send two turns → NEAR AI's real `402` shows the credits-out note and the message returns to the box.
- [ ] **Step 4:** Restore the first `HOME`'s recovery code on the second: the first one reads `Your credits moved to another Mac`, and the second gets a working key.
- [ ] **Step 5:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `pnpm lint`, and the private test files pass. Record what was checked in the commit message.
- [ ] **Step 6: Commit** any fixes found, then report M3–M4 done. The real payment and the per-turn measurements are the rest of M5.

---

## Changes this plan needs in the server plan and spec

These are part of this plan's first commit, so the two plans agree:

- Server plan Task 5: add `POST /v1/topups/:id/cancel` (device auth; another device's id → 404): a `created` top-up moves to `expired` and its reservation is released; any other status → 200 unchanged. A payment that still arrives follows `expired → paid` as before.
- Server plan Task 8: `POST /v1/promo` answers 201 `{ topupId, credits }`.
- Spec 7.4: the cancel route and the promo answer; spec 8.1: the command list of Task 3 and the state file; spec 5: "Used by" per model is shown once extension E gives per-session cost.
