//! The logic behind every private-mode command: the device and its lazy
//! registration, the one-time key handover, models, top-ups, promo codes and
//! recovery. Shared by every async command, so state lives behind short
//! `Mutex` sections; only `handover` is held across a network call, because it
//! exists to serialize the steps that move a secret or a key (key collection,
//! recovery, creating or forgetting a device). Nothing here logs or returns a
//! secret, a key or a code, except `recovery_code` and `recover`, whose values
//! the UI is meant to show.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use url::Url;

use super::billing::{BillingApi, PrivateSessionUsage, UsageTracker};
use super::client::{Balance, CreditsApi, ModelPrice, PromoResult, Stock, TopupState};
use super::device::{new_recovery_code, secret_hash, SecretStore, DEVICE_SECRET, NEARAI_KEY};
use super::local_state::{CachedModels, LastBalance, LocalState, PendingTopup};
use super::proxy::{IssuedToken, McpState, PrivateProxy, SharedModels};
use super::verify::{PrivateVerifier, RecordVerification};
use super::PrivateError;

mod recovery;

const MODELS_TTL: Duration = Duration::from_secs(10 * 60);
/// 1 USDC paid buys 100 credits.
const CREDITS_PER_USD: u64 = 100;
const MAX_PROMO_CHARS: usize = 64;
const CHECKOUT_HOST: &str = "pay.pingpay.io";
const CREDITED: &str = "credited";
/// Top-up statuses after which there is nothing left to wait for.
const SETTLED: [&str; 3] = [CREDITED, "failed", "expired"];
const SECONDS_PER_DAY: u64 = 86_400;
/// After a recovery the server rotates the key in a queued job; until then it
/// says the key was handed over while there is none to take.
const ROTATION_WINDOW_MS: i64 = 15 * 60 * 1000;
/// A promo credit is held like a checkout; the server sends no expiry for it.
const PROMO_HOLD_SECS: u64 = 25 * 60;

/// Opens a checkout URL in the system browser.
pub type Opener = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceState {
    /// No device on this Mac yet.
    None,
    Ready,
    /// The server no longer knows this Mac's secret: its credits moved.
    Moved,
}

/// What Settings shows. Carries no secret, key or code.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateStatus {
    pub device: DeviceState,
    pub key_ready: bool,
    pub key_error: Option<PrivateError>,
    pub balance: Option<Balance>,
    pub balance_error: Option<PrivateError>,
    pub last_balance: Option<LastBalance>,
    pub recovery_saved: bool,
    pub recovery_prompted: bool,
    pub pending_topup: Option<PendingTopup>,
}

/// The part of a status that comes from the Keychain and the Worker.
struct DeviceReport {
    device: DeviceState,
    key_ready: bool,
    key_error: Option<PrivateError>,
    balance: Option<Balance>,
    balance_error: Option<PrivateError>,
}

impl DeviceReport {
    fn new(device: DeviceState) -> Self {
        Self {
            device,
            key_ready: false,
            key_error: None,
            balance: None,
            balance_error: None,
        }
    }
}

/// Holds secrets, so it deliberately has no `Debug`.
pub struct PrivateMode {
    store: Arc<dyn SecretStore>,
    api: Arc<dyn CreditsApi>,
    dir: PathBuf,
    open: Opener,
    /// The loopback proxy private launches talk to; it holds the real key.
    proxy: Arc<PrivateProxy>,
    /// Checks NEAR AI's signatures and attestations for the proxy's records.
    verifier: PrivateVerifier,
    /// Reads what NEAR AI billed a session's calls; never holds the key beyond a call.
    billing: Arc<dyn BillingApi>,
    /// Settled costs and estimates, kept for this app run.
    usage: UsageTracker,
    models: SharedModels,
    /// The bundled MCP script, set by the app setup. Tests may leave it unset.
    mcp_script: Mutex<Option<PathBuf>>,
    checkouts: Mutex<HashMap<String, String>>,
    /// The current secret is known to the server, this run.
    registered: AtomicBool,
    handover: Mutex<()>,
    /// A one-time key the server handed over that the Keychain refused; the
    /// next collection writes it again instead of asking for it.
    unsaved_key: Mutex<Option<String>>,
    /// Serializes read-modify-write of the state file.
    state: Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The state file could not be written; what it holds is a convenience (the
/// Keychain and the server are the truth), so the command goes on.
pub(crate) fn report_storage_failure() {
    eprintln!("private mode: couldn't save the local state file");
}

impl PrivateMode {
    pub fn new(
        store: Box<dyn SecretStore>,
        api: Box<dyn CreditsApi>,
        dir: PathBuf,
        open: Opener,
        proxy: Arc<PrivateProxy>,
        verifier: PrivateVerifier,
        billing: Arc<dyn BillingApi>,
    ) -> Self {
        let store: Arc<dyn SecretStore> = store.into();
        let api: Arc<dyn CreditsApi> = api.into();
        let models = Arc::new(Mutex::new(None));
        proxy.set_mcp_state(Arc::new(McpState::new(
            Arc::clone(&store),
            Arc::clone(&api),
            Arc::clone(&models),
        )));
        Self {
            store,
            api,
            dir,
            open,
            proxy,
            verifier,
            billing,
            usage: UsageTracker::default(),
            models,
            mcp_script: Mutex::new(None),
            checkouts: Mutex::new(HashMap::new()),
            registered: AtomicBool::new(false),
            handover: Mutex::new(()),
            unsaved_key: Mutex::new(None),
            state: Mutex::new(()),
        }
    }

    // ---- the device ----

    /// This Mac's secret, creating and registering a device when there is
    /// none. A new code is stored before it is registered, so a failed
    /// register keeps it and the next call registers it again. A recovery
    /// still in flight is finished first and blocks creating a new device.
    pub fn ensure_device(&self) -> Result<String, PrivateError> {
        let secret = {
            let _guard = lock(&self.handover);
            match self.finish_recovery_locked(false)? {
                Some((promoted, _)) => promoted,
                None => match self.store.get(DEVICE_SECRET)? {
                    Some(secret) => secret,
                    None => self.create_secret()?,
                },
            }
        };
        self.ensure_registered(&secret)?;
        Ok(secret)
    }

    /// A fresh code in the Keychain. The state file is reset first (keeping
    /// the model list), so another device's balance, top-up and recovery flags
    /// never show for this one, and a failed reset creates nothing. The code
    /// is made before the reset, so a random source that fails changes nothing.
    fn create_secret(&self) -> Result<String, PrivateError> {
        let code = new_recovery_code()?;
        self.update_state(|old| LocalState {
            models: old.models,
            private_sessions: old.private_sessions,
            ..LocalState::default()
        })?;
        self.store.set(DEVICE_SECRET, &code)?;
        self.registered.store(false, Ordering::SeqCst);
        Ok(code)
    }

    /// Registers `secret` once per run. A device whose balance this Mac has
    /// seen is known to the server and is not registered again: if its credits
    /// moved, registering the old hash would make a new, empty device and hide
    /// the move.
    fn ensure_registered(&self, secret: &str) -> Result<(), PrivateError> {
        if self.registered.load(Ordering::SeqCst) {
            return Ok(());
        }
        if self.load_state().last_balance.is_none() {
            self.api.register(&secret_hash(secret))?;
        }
        self.registered.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn device_secret(&self) -> Result<String, PrivateError> {
        self.store.get(DEVICE_SECRET)?.ok_or(PrivateError::NoDevice)
    }

    // ---- status ----

    /// Never creates a device and makes no call when there is none.
    pub fn status(&self, fresh: bool) -> PrivateStatus {
        let report = self.device_report(fresh);
        let state = self.load_state();
        PrivateStatus {
            device: report.device,
            key_ready: report.key_ready,
            key_error: report.key_error,
            balance: report.balance,
            balance_error: report.balance_error,
            last_balance: state.last_balance,
            recovery_saved: state.recovery_saved,
            recovery_prompted: state.recovery_prompted,
            pending_topup: state.pending_topup,
        }
    }

    fn device_report(&self, fresh: bool) -> DeviceReport {
        let recovered = match self.finish_recovery(fresh) {
            Ok(recovered) => recovered,
            Err(error) => return self.unresolved_report(error),
        };
        let answer = match recovered {
            Some((_, balance)) => Ok(balance),
            None => match self.store.get(DEVICE_SECRET) {
                Ok(Some(secret)) => self
                    .ensure_registered(&secret)
                    .and_then(|()| self.api.balance(&secret, fresh)),
                Ok(None) => return DeviceReport::new(DeviceState::None),
                Err(error) => {
                    return DeviceReport {
                        balance_error: Some(error),
                        ..DeviceReport::new(DeviceState::None)
                    }
                }
            },
        };
        match answer {
            Ok(balance) => self.ready_report(balance),
            Err(PrivateError::Unauthorized) => {
                self.change_state(|old| LocalState { moved: true, ..old });
                DeviceReport::new(DeviceState::Moved)
            }
            Err(error) => DeviceReport {
                key_ready: self.has_local_key().unwrap_or(false),
                balance_error: Some(error),
                // Another Worker call met a 401 since the last balance: the
                // device stays moved until a balance says otherwise.
                ..DeviceReport::new(if self.load_state().moved {
                    DeviceState::Moved
                } else {
                    DeviceState::Ready
                })
            },
        }
    }

    /// A recovery is in flight and could not be settled: the old secret is
    /// not used meanwhile, since the server may already have retired it.
    fn unresolved_report(&self, error: PrivateError) -> DeviceReport {
        let device = match self.store.get(DEVICE_SECRET) {
            Ok(Some(_)) => DeviceState::Ready,
            _ => DeviceState::None,
        };
        DeviceReport {
            key_ready: self.has_local_key().unwrap_or(false),
            balance_error: Some(error),
            ..DeviceReport::new(device)
        }
    }

    fn ready_report(&self, balance: Balance) -> DeviceReport {
        self.remember_balance(&balance);
        let (key_ready, key_error) = match self.collect_key(balance.key_ready) {
            Ok(ready) => (ready, None),
            Err(error) => (false, Some(error)),
        };
        DeviceReport {
            key_ready,
            key_error,
            balance: Some(balance),
            ..DeviceReport::new(DeviceState::Ready)
        }
    }

    fn remember_balance(&self, balance: &Balance) {
        let last = LastBalance {
            credits: balance.credits,
            used_credits: balance.used_credits,
            at: balance.updated_at.clone(),
        };
        self.change_state(|old| LocalState {
            last_balance: Some(last),
            moved: false,
            ..old
        });
    }

    // ---- the key handover ----

    fn has_local_key(&self) -> Result<bool, PrivateError> {
        Ok(self.store.get(NEARAI_KEY)?.is_some())
    }

    /// Whether a key is on this Mac after collecting one the server holds.
    /// The server hands a key over once (`keyReady` is false while it waits),
    /// so collection runs under `handover` and checks again inside it: two
    /// callers never both take it. `None` from the server while it says the
    /// key was handed over (`keyReady`) means it never got here: `KeyLost`,
    /// unless a recovery's rotated key is still expected.
    fn collect_key(&self, server_key_ready: bool) -> Result<bool, PrivateError> {
        if self.has_local_key()? {
            return Ok(true);
        }
        let _guard = lock(&self.handover);
        if self.has_local_key()? {
            return Ok(true);
        }
        let unsaved = lock(&self.unsaved_key).take();
        let key = match unsaved {
            Some(key) => key,
            None => match self.worker_call(|secret| self.api.take_key(secret))? {
                Some(key) => key,
                None if server_key_ready && !self.rotation_expected() => {
                    return Err(PrivateError::KeyLost)
                }
                None => return Ok(false),
            },
        };
        self.keep_key(key).map(|()| true)
    }

    /// Saves a taken key. One the Keychain refused stays in memory for the
    /// next try, since the server will not hand it over again.
    fn keep_key(&self, key: String) -> Result<(), PrivateError> {
        if let Err(error) = self.save_key(&key) {
            *lock(&self.unsaved_key) = Some(key);
            return Err(error);
        }
        if self.load_state().rotation_expected_until.is_some() {
            self.change_state(|old| LocalState {
                rotation_expected_until: None,
                ..old
            });
        }
        Ok(())
    }

    /// A deadline further ahead than the window means the clock was set
    /// back; it then counts as passed, so `KeyLost` is never held off longer.
    fn rotation_expected(&self) -> bool {
        let now = now_millis();
        self.load_state()
            .rotation_expected_until
            .is_some_and(|until| now < until && until.saturating_sub(now) <= ROTATION_WINDOW_MS)
    }

    /// Writes the key and reads it back; only a key that reads back the same
    /// counts as saved.
    fn save_key(&self, key: &str) -> Result<(), PrivateError> {
        self.store
            .set(NEARAI_KEY, key)
            .map_err(|_| PrivateError::Keychain)?;
        match self.store.get(NEARAI_KEY) {
            Ok(Some(saved)) if saved == key => Ok(()),
            _ => {
                // Best effort: a wrong value must not read as a ready key; the
                // status already reports Keychain either way.
                let _ = self.store.delete(NEARAI_KEY);
                Err(PrivateError::Keychain)
            }
        }
    }

    /// The NEAR AI key a private launch's proxy adds upstream; it never enters the agent's process.
    pub fn launch_key(&self) -> Result<String, PrivateError> {
        self.store.get(NEARAI_KEY)?.ok_or(PrivateError::NoKey)
    }

    /// A fresh proxy token for a private launch of `session_id`. The key is read here and handed
    /// only to the loopback proxy.
    pub fn issue_proxy_token(
        &self,
        session_id: &str,
        model_id: &str,
    ) -> Result<IssuedToken, PrivateError> {
        let key = self.launch_key()?;
        self.proxy.issue(session_id, model_id, &key)
    }

    /// Drops one holder of a proxy token; the token goes when its agent process has no session left.
    pub fn release_proxy_token(&self, session_id: &str) {
        self.proxy.release(session_id);
    }

    /// Lets a private fork keep using its source's proxy token after the source stops.
    pub fn share_proxy_token(&self, source_id: &str, fork_id: &str) -> bool {
        self.proxy.share(source_id, fork_id)
    }

    /// The bundled MCP server script, once the app setup knows its resource path.
    pub fn set_mcp_script(&self, path: PathBuf) {
        *lock(&self.mcp_script) = Some(path);
    }

    pub fn mcp_script(&self) -> Option<PathBuf> {
        lock(&self.mcp_script).clone()
    }

    /// Verifies the session's private calls, reusing results already final. A turn that ended after
    /// Stop still has its last token's records, until the session is deleted.
    pub fn verify_proxy_records(
        &self,
        session_id: &str,
    ) -> Result<Vec<RecordVerification>, PrivateError> {
        let records = self.proxy.records(session_id);
        if records.is_empty() {
            return Ok(Vec::new());
        }
        let key = self.launch_key()?;
        Ok(self.verifier.verify(records, &key))
    }

    /// A deleted session drops its record lookup and, when no fork holds the token, its records.
    pub fn forget_proxy_session(&self, session_id: &str) {
        self.proxy.forget(session_id);
    }

    // ---- private sessions ----

    /// Records `acp_session_id` as an agent session that ran privately. The
    /// ids are no secret; a failed save is `Storage`, and the caller goes on.
    pub fn note_private_session(&self, acp_session_id: &str) -> Result<(), PrivateError> {
        self.update_state(|old| old.with_private_session(acp_session_id))
            .map(|_| ())
    }

    /// Whether `acp_session_id` was recorded by [`Self::note_private_session`],
    /// in any letter case.
    pub fn is_private_acp_session(&self, acp_session_id: &str) -> bool {
        self.private_acp_sessions()
            .contains(&acp_session_id.to_ascii_lowercase())
    }

    /// Every recorded private ACP session id, lower-cased.
    pub fn private_acp_sessions(&self) -> HashSet<String> {
        self.load_state().private_sessions.into_iter().collect()
    }

    // ---- stock and models ----

    pub fn stock(&self) -> Result<Stock, PrivateError> {
        let secret = self.ensure_device()?;
        self.worker(&secret, self.api.stock(&secret))
    }

    /// The memory copy for 10 minutes, then the Worker; when the Worker fails,
    /// the last list saved in the state file.
    pub fn models(&self) -> Result<Vec<ModelPrice>, PrivateError> {
        if let Some(list) = self.cached_models() {
            return Ok(list);
        }
        match self
            .ensure_device()
            .and_then(|secret| self.worker(&secret, self.api.models(&secret)))
        {
            Ok(list) => {
                self.remember_models(&list);
                Ok(list)
            }
            Err(error) => self
                .load_state()
                .models
                .map(|cached| cached.list)
                .ok_or(error),
        }
    }

    /// What `session_id`'s private calls cost, from billing where it answers and from token counts
    /// when it does not. It uses the key held by the proxy for that session and returns no key.
    pub fn session_usage(&self, session_id: &str) -> PrivateSessionUsage {
        let records = self.proxy.records(session_id);
        let key = self.proxy.key(session_id);
        let models = self.cached_models().unwrap_or_default();
        self.usage
            .usage(&records, &models, key.as_deref(), self.billing.as_ref())
    }

    fn cached_models(&self) -> Option<Vec<ModelPrice>> {
        lock(&self.models)
            .as_ref()
            .filter(|(at, _)| at.elapsed() < MODELS_TTL)
            .map(|(_, list)| list.clone())
    }

    fn remember_models(&self, list: &[ModelPrice]) {
        *lock(&self.models) = Some((Instant::now(), list.to_vec()));
        let cached = CachedModels {
            at: now_iso(),
            list: list.to_vec(),
        };
        self.change_state(|old| LocalState {
            models: Some(cached),
            ..old
        });
    }

    // ---- top-ups ----

    /// Creates a top-up and keeps its checkout for `open_checkout`. The
    /// checkout must be on `https://pay.pingpay.io`, otherwise nothing is
    /// kept; the normalized URL is kept, never the server's raw text.
    pub fn create_topup(&self, package_usd: u32) -> Result<PendingTopup, PrivateError> {
        let secret = self.ensure_device()?;
        let created = self.worker(&secret, self.api.create_topup(&secret, package_usd))?;
        let checkout = checkout_url(&created.session_url).ok_or(PrivateError::BadCheckoutUrl)?;
        let pending = PendingTopup {
            topup_id: created.topup_id.clone(),
            expires_at: created.expires_at,
            credits: u64::from(package_usd) * CREDITS_PER_USD,
            bought_before: self.bought_so_far(),
        };
        self.keep_pending(&pending);
        lock(&self.checkouts).insert(created.topup_id, checkout);
        Ok(pending)
    }

    /// Opens a checkout this run created; any other id is `NotFound`. A
    /// browser that does not open it is `OpenFailed`: the hold stands.
    pub fn open_checkout(&self, topup_id: &str) -> Result<(), PrivateError> {
        let url = lock(&self.checkouts)
            .get(topup_id)
            .cloned()
            .ok_or(PrivateError::NotFound)?;
        (self.open)(&url).map_err(|_| PrivateError::OpenFailed)
    }

    /// The top-up's status; a settled one is cleared here, and a credit also
    /// collects the key the server made for it.
    pub fn topup_status(&self, topup_id: &str) -> Result<TopupState, PrivateError> {
        let state = self.worker_call(|secret| self.api.topup(secret, topup_id))?;
        if SETTLED.contains(&state.status.as_str()) {
            let credited = (state.status == CREDITED).then_some(state.credits);
            self.settle_topup(topup_id, credited);
        }
        if state.status == CREDITED {
            if let Err(error) = self.collect_key(false) {
                // The next status reports it to the user.
                eprintln!(
                    "private mode: key handover after a credit failed: {}",
                    error.code()
                );
            }
        }
        Ok(state)
    }

    pub fn cancel_topup(&self, topup_id: &str) -> Result<(), PrivateError> {
        self.worker_call(|secret| self.api.cancel_topup(secret, topup_id))?;
        self.settle_topup(topup_id, None);
        Ok(())
    }

    /// Redeems a promo code; its credit is polled like a top-up's.
    pub fn redeem_promo(&self, code: &str) -> Result<PromoResult, PrivateError> {
        let code = code.trim();
        if code.is_empty() || code.chars().count() > MAX_PROMO_CHARS {
            return Err(PrivateError::BadCode);
        }
        let secret = self.ensure_device()?;
        let result = self
            .worker(&secret, self.api.redeem_promo(&secret, code))
            .map_err(|error| match error {
                PrivateError::BadRequest => PrivateError::BadCode,
                other => other,
            })?;
        self.keep_pending(&PendingTopup {
            topup_id: result.topup_id.clone(),
            expires_at: iso_from_unix(now_secs() + PROMO_HOLD_SECS),
            credits: result.credits,
            bought_before: self.bought_so_far(),
        });
        Ok(result)
    }

    /// Saves the top-up so a restart resumes polling it. A failed save does
    /// not stop the payment: polling goes on from the UI meanwhile.
    fn keep_pending(&self, pending: &PendingTopup) {
        self.change_state(|old| LocalState {
            pending_topup: Some(pending.clone()),
            ..old
        });
    }

    /// Credits bought so far, as the last balance shows them: what is left
    /// plus what was used, which a use does not change and a credit raises.
    /// `None` without a last balance: an unknown baseline, so a credit is
    /// always added (never taken as already counted).
    fn bought_so_far(&self) -> Option<u64> {
        self.load_state().last_balance.as_ref().map(bought_of)
    }

    /// Clears a settled top-up. A credited one is first added to the last
    /// balance (the server's amount, else the pending one's), so this Mac
    /// still reads as having credits of its own before the next balance,
    /// unless a balance read since the top-up started already shows it.
    /// A top-up no longer pending (already settled) changes nothing.
    fn settle_topup(&self, topup_id: &str, credited: Option<u64>) {
        lock(&self.checkouts).remove(topup_id);
        self.change_state(|old| {
            let Some(pending) = old
                .pending_topup
                .as_ref()
                .filter(|pending| pending.topup_id == topup_id)
            else {
                return old;
            };
            let credit = match credited {
                Some(0) => Some(pending.credits),
                other => other,
            };
            let last_balance = match credit {
                Some(credits) if !is_counted(pending, old.last_balance.as_ref(), credits) => {
                    Some(with_credit(old.last_balance.clone(), credits))
                }
                _ => old.last_balance.clone(),
            };
            LocalState {
                pending_topup: None,
                last_balance,
                ..old
            }
        });
    }

    /// The answer of a Worker call made with `secret`. A `401` means the
    /// server no longer knows that secret: the device is marked moved,
    /// whichever call heard it, so the next status says so even when it cannot
    /// read the balance. Only while `secret` is still this Mac's: a call made
    /// before a restore replaced it says nothing about the new device.
    fn worker<T>(&self, secret: &str, answer: Result<T, PrivateError>) -> Result<T, PrivateError> {
        let is_current = || matches!(self.store.get(DEVICE_SECRET), Ok(Some(now)) if now == secret);
        if answer.as_ref().err() == Some(&PrivateError::Unauthorized) && is_current() {
            self.change_state(|old| LocalState { moved: true, ..old });
        }
        answer
    }

    /// [`Self::worker`] for a call that needs only the device secret.
    fn worker_call<T>(
        &self,
        call: impl FnOnce(&str) -> Result<T, PrivateError>,
    ) -> Result<T, PrivateError> {
        let secret = self.device_secret()?;
        self.worker(&secret, call(&secret))
    }

    // ---- the state file ----

    fn load_state(&self) -> LocalState {
        LocalState::load(&self.dir)
    }

    fn update_state(
        &self,
        change: impl FnOnce(LocalState) -> LocalState,
    ) -> Result<LocalState, PrivateError> {
        let _guard = lock(&self.state);
        let next = change(LocalState::load(&self.dir));
        next.save(&self.dir)?;
        Ok(next)
    }

    /// `update_state` for what is only a convenience: a failed save is
    /// reported and the command goes on.
    fn change_state(&self, change: impl FnOnce(LocalState) -> LocalState) {
        if self.update_state(change).is_err() {
            report_storage_failure();
        }
    }
}

/// This Mac's device still holds credits or a top-up (and has not moved).
fn has_own_credits(state: &LocalState) -> bool {
    !state.moved
        && (state
            .last_balance
            .as_ref()
            .is_some_and(|last| last.credits > 0)
            || state.pending_topup.is_some())
}

/// Credits bought as a balance shows them: left plus used.
fn bought_of(last: &LastBalance) -> u64 {
    last.credits.saturating_add(last.used_credits)
}

/// Whether `last`, read after `pending` started, already holds its credit of
/// `credits`: the credits bought rose by more than half of it since (whole
/// credits round down on the server, so the rise can be a credit short).
/// Unknown without a baseline (a file from before it was kept), so the credit
/// is added, as before.
fn is_counted(pending: &PendingTopup, last: Option<&LastBalance>, credits: u64) -> bool {
    let (Some(before), Some(last)) = (pending.bought_before, last) else {
        return false;
    };
    let rise = bought_of(last).saturating_sub(before);
    rise.saturating_mul(2) > credits
}

fn with_credit(last: Option<LastBalance>, credits: u64) -> LastBalance {
    match last {
        Some(last) => LastBalance {
            credits: last.credits.saturating_add(credits),
            ..last
        },
        None => LastBalance {
            credits,
            used_credits: 0,
            at: now_iso(),
        },
    }
}

/// The normalized form of a `https://pay.pingpay.io/…` checkout, or `None`.
/// Text with a backslash, a control character or whitespace is refused before
/// parsing: the WHATWG parser and macOS's `open` read such text differently
/// (`https://pay.pingpay.io\@evil.com/`), and the parser drops tabs and
/// newlines silently. The URL then needs scheme `https`, host exactly
/// `pay.pingpay.io`, the default port and no credentials, and only its
/// re-serialized form is ever kept or opened.
fn checkout_url(raw: &str) -> Option<String> {
    let suspicious = |c: char| c == '\\' || c.is_control() || c.is_whitespace();
    if raw.chars().any(suspicious) {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    let valid = url.scheme() == "https"
        && url.host_str() == Some(CHECKOUT_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    valid.then(|| url.as_str().to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

fn now_millis() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis());
    i64::try_from(millis).unwrap_or(i64::MAX)
}

fn now_iso() -> String {
    iso_from_unix(now_secs())
}

/// `YYYY-MM-DDTHH:MM:SSZ` in UTC (Howard Hinnant's civil-from-days).
fn iso_from_unix(secs: u64) -> String {
    let days = secs / SECONDS_PER_DAY;
    let rest = secs % SECONDS_PER_DAY;
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests;
