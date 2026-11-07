//! The logic behind every private-mode command: the device and its lazy
//! registration, the one-time key handover, models, top-ups, promo codes and
//! recovery. Shared by every async command, so state lives behind short
//! `Mutex` sections; only `handover` is held across a network call, because it
//! exists to serialize the steps that move a secret or a key (key collection,
//! recovery, creating or forgetting a device). Nothing here logs or returns a
//! secret, a key or a code, except `recovery_code` and `recover`, whose values
//! the UI is meant to show.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use url::Url;

use super::client::{Balance, CreditsApi, ModelPrice, PromoResult, Stock, TopupState};
use super::device::{
    new_recovery_code, normalize_recovery_code, secret_hash, SecretStore, DEVICE_SECRET,
    DEVICE_SECRET_NEXT, NEARAI_KEY,
};
use super::local_state::{CachedModels, LastBalance, LocalState, PendingTopup};
use super::PrivateError;

const MODELS_TTL: Duration = Duration::from_secs(10 * 60);
/// 1 USDC paid buys 100 credits.
const CREDITS_PER_USD: u64 = 100;
const MAX_PROMO_CHARS: usize = 64;
const CHECKOUT_HOST: &str = "pay.pingpay.io";
const CREDITED: &str = "credited";
/// Top-up statuses after which there is nothing left to wait for.
const SETTLED: [&str; 3] = [CREDITED, "failed", "expired"];
const SECONDS_PER_DAY: u64 = 86_400;

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
    store: Box<dyn SecretStore>,
    api: Box<dyn CreditsApi>,
    dir: PathBuf,
    open: Opener,
    models: Mutex<Option<(Instant, Vec<ModelPrice>)>>,
    checkouts: Mutex<HashMap<String, String>>,
    /// The current secret is known to the server, this run.
    registered: AtomicBool,
    handover: Mutex<()>,
    /// Serializes read-modify-write of the state file.
    state: Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The state file could not be written; what it holds is a convenience (the
/// Keychain and the server are the truth), so the command goes on.
fn report_storage_failure() {
    eprintln!("private mode: couldn't save the local state file");
}

impl PrivateMode {
    pub fn new(
        store: Box<dyn SecretStore>,
        api: Box<dyn CreditsApi>,
        dir: PathBuf,
        open: Opener,
    ) -> Self {
        Self {
            store,
            api,
            dir,
            open,
            models: Mutex::new(None),
            checkouts: Mutex::new(HashMap::new()),
            registered: AtomicBool::new(false),
            handover: Mutex::new(()),
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
    /// never show for this one, and a failed reset creates nothing.
    fn create_secret(&self) -> Result<String, PrivateError> {
        self.update_state(|old| LocalState {
            models: old.models,
            ..LocalState::default()
        })?;
        let code = new_recovery_code();
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
            Err(PrivateError::Unauthorized) => DeviceReport::new(DeviceState::Moved),
            Err(error) => DeviceReport {
                key_ready: self.has_local_key().unwrap_or(false),
                balance_error: Some(error),
                ..DeviceReport::new(DeviceState::Ready)
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
        let saved = self.update_state(|old| LocalState {
            last_balance: Some(last),
            ..old
        });
        if saved.is_err() {
            report_storage_failure();
        }
    }

    // ---- the key handover ----

    fn has_local_key(&self) -> Result<bool, PrivateError> {
        Ok(self.store.get(NEARAI_KEY)?.is_some())
    }

    /// Whether a key is on this Mac after collecting one the server holds.
    /// The server hands a key over once (`keyReady` is false while it waits),
    /// so collection runs under `handover` and checks again inside it: two
    /// callers never both take it. `None` from the server while it says the
    /// key was handed over (`keyReady`) means it never got here: `KeyLost`.
    fn collect_key(&self, server_key_ready: bool) -> Result<bool, PrivateError> {
        if self.has_local_key()? {
            return Ok(true);
        }
        let _guard = lock(&self.handover);
        if self.has_local_key()? {
            return Ok(true);
        }
        match self.api.take_key(&self.device_secret()?)? {
            Some(key) => self.save_key(&key).map(|()| true),
            None if server_key_ready => Err(PrivateError::KeyLost),
            None => Ok(false),
        }
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

    /// The key a private Qwen Code launch puts in its env.
    pub fn launch_key(&self) -> Result<String, PrivateError> {
        self.store.get(NEARAI_KEY)?.ok_or(PrivateError::NoKey)
    }

    // ---- recovery ----

    fn finish_recovery(&self, fresh: bool) -> Result<Option<(String, Balance)>, PrivateError> {
        let _guard = lock(&self.handover);
        self.finish_recovery_locked(fresh)
    }

    /// Settles a recovery left in `device-secret-next`, with `handover` held:
    /// a balance with it that succeeds means the server took it, so it is
    /// promoted; a `401` means the server never did, so it is deleted; any
    /// other error leaves it for next time.
    fn finish_recovery_locked(
        &self,
        fresh: bool,
    ) -> Result<Option<(String, Balance)>, PrivateError> {
        let Some(next) = self.store.get(DEVICE_SECRET_NEXT)? else {
            return Ok(None);
        };
        if self.store.get(DEVICE_SECRET)?.as_deref() == Some(next.as_str()) {
            // Already promoted; only its delete failed.
            self.store.delete(DEVICE_SECRET_NEXT)?;
            return Ok(None);
        }
        match self.api.balance(&next, fresh) {
            Ok(balance) => {
                self.promote(&next)?;
                Ok(Some((next, balance)))
            }
            Err(PrivateError::Unauthorized) => {
                self.store.delete(DEVICE_SECRET_NEXT)?;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    /// Makes `next` this Mac's secret once the server holds its hash. The old
    /// key is dropped (the server revokes it and hands over a new one), and the
    /// new code has not been saved by the user yet.
    fn promote(&self, next: &str) -> Result<(), PrivateError> {
        self.store.delete(NEARAI_KEY)?;
        self.store.set(DEVICE_SECRET, next)?;
        self.registered.store(true, Ordering::SeqCst);
        // A leftover copy equals the secret now; `finish_recovery_locked`
        // deletes it next time without promoting it again.
        let _ = self.store.delete(DEVICE_SECRET_NEXT);
        let saved = self.update_state(|old| LocalState {
            recovery_saved: false,
            recovery_prompted: false,
            ..old
        });
        if saved.is_err() {
            report_storage_failure();
        }
        Ok(())
    }

    /// Moves the device behind the typed code to this Mac and returns this
    /// Mac's new code. The new code is stored under `device-secret-next`
    /// before the server is called, so it is never lost: a failure after the
    /// server took it is finished by the next `status`.
    pub fn recover(&self, input: &str) -> Result<String, PrivateError> {
        let typed = normalize_recovery_code(input).ok_or(PrivateError::BadCode)?;
        let _guard = lock(&self.handover);
        if let Some((promoted, _)) = self.finish_recovery_locked(false)? {
            return Ok(promoted);
        }
        self.refuse_if_own_credits(&typed)?;
        let new = new_recovery_code();
        self.store.set(DEVICE_SECRET_NEXT, &new)?;
        match self.api.recover(&typed, &secret_hash(&new)) {
            Ok(()) => self.promote(&new).map(|()| new),
            Err(PrivateError::BadRequest) => {
                self.store.delete(DEVICE_SECRET_NEXT)?;
                Err(PrivateError::BadCode)
            }
            Err(error) => Err(error),
        }
    }

    /// Restoring another Mac's code here would orphan this Mac's own credits
    /// or top-up. This Mac's own code is allowed: it re-issues a key that was
    /// never collected.
    fn refuse_if_own_credits(&self, typed: &str) -> Result<(), PrivateError> {
        let Some(own) = self.store.get(DEVICE_SECRET)? else {
            return Ok(());
        };
        if normalize_recovery_code(&own).as_deref() == Some(typed) {
            return Ok(());
        }
        let state = self.load_state();
        let has_credits = state.last_balance.is_some_and(|last| last.credits > 0)
            || state.pending_topup.is_some();
        if has_credits {
            return Err(PrivateError::HasOwnCredits);
        }
        Ok(())
    }

    /// The recovery code, for the UI to show.
    pub fn recovery_code(&self) -> Result<String, PrivateError> {
        self.device_secret()
    }

    pub fn mark_recovery(&self, saved: bool) -> Result<(), PrivateError> {
        self.update_state(|old| LocalState {
            recovery_saved: saved,
            recovery_prompted: true,
            ..old
        })
        .map(|_| ())
    }

    /// Deletes every Keychain item and resets the state file.
    pub fn forget_device(&self) -> Result<(), PrivateError> {
        let _guard = lock(&self.handover);
        for account in [NEARAI_KEY, DEVICE_SECRET_NEXT, DEVICE_SECRET] {
            self.store.delete(account)?;
        }
        self.registered.store(false, Ordering::SeqCst);
        lock(&self.checkouts).clear();
        self.update_state(|_| LocalState::default()).map(|_| ())
    }

    // ---- stock and models ----

    pub fn stock(&self) -> Result<Stock, PrivateError> {
        let secret = self.ensure_device()?;
        self.api.stock(&secret)
    }

    /// The memory copy for 10 minutes, then the Worker; when the Worker fails,
    /// the last list saved in the state file.
    pub fn models(&self) -> Result<Vec<ModelPrice>, PrivateError> {
        if let Some(list) = self.cached_models() {
            return Ok(list);
        }
        match self
            .ensure_device()
            .and_then(|secret| self.api.models(&secret))
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
        let saved = self.update_state(|old| LocalState {
            models: Some(cached),
            ..old
        });
        if saved.is_err() {
            report_storage_failure();
        }
    }

    // ---- top-ups ----

    /// Creates a top-up and opens its checkout, which must be on
    /// `https://pay.pingpay.io`; otherwise nothing is opened or kept.
    pub fn create_topup(&self, package_usd: u32) -> Result<PendingTopup, PrivateError> {
        let secret = self.ensure_device()?;
        let created = self.api.create_topup(&secret, package_usd)?;
        if !is_checkout_url(&created.session_url) {
            return Err(PrivateError::BadCheckoutUrl);
        }
        let pending = PendingTopup {
            topup_id: created.topup_id.clone(),
            expires_at: created.expires_at,
            credits: u64::from(package_usd) * CREDITS_PER_USD,
        };
        self.keep_pending(&pending);
        lock(&self.checkouts).insert(created.topup_id, created.session_url.clone());
        if (self.open)(&created.session_url).is_err() {
            // The top-up stands; the UI can open it again with open_checkout.
            eprintln!("private mode: couldn't open the checkout in the browser");
        }
        Ok(pending)
    }

    /// Opens a checkout this run created; any other id is `NotFound`.
    pub fn open_checkout(&self, topup_id: &str) -> Result<(), PrivateError> {
        let url = lock(&self.checkouts)
            .get(topup_id)
            .cloned()
            .ok_or(PrivateError::NotFound)?;
        (self.open)(&url).map_err(|_| PrivateError::Upstream)
    }

    /// The top-up's status; a settled one is cleared here, and a credit also
    /// collects the key the server made for it.
    pub fn topup_status(&self, topup_id: &str) -> Result<TopupState, PrivateError> {
        let state = self.api.topup(&self.device_secret()?, topup_id)?;
        if SETTLED.contains(&state.status.as_str()) {
            self.drop_topup(topup_id);
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
        self.api.cancel_topup(&self.device_secret()?, topup_id)?;
        self.drop_topup(topup_id);
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
            .api
            .redeem_promo(&secret, code)
            .map_err(|error| match error {
                PrivateError::BadRequest => PrivateError::BadCode,
                other => other,
            })?;
        self.keep_pending(&PendingTopup {
            topup_id: result.topup_id.clone(),
            expires_at: now_iso(),
            credits: result.credits,
        });
        Ok(result)
    }

    /// Saves the top-up so a restart resumes polling it. A failed save does
    /// not stop the payment: polling goes on from the UI meanwhile.
    fn keep_pending(&self, pending: &PendingTopup) {
        let saved = self.update_state(|old| LocalState {
            pending_topup: Some(pending.clone()),
            ..old
        });
        if saved.is_err() {
            report_storage_failure();
        }
    }

    fn drop_topup(&self, topup_id: &str) {
        lock(&self.checkouts).remove(topup_id);
        let saved = self.update_state(|old| LocalState {
            pending_topup: old
                .pending_topup
                .filter(|pending| pending.topup_id != topup_id),
            ..old
        });
        if saved.is_err() {
            report_storage_failure();
        }
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
}

/// `https://pay.pingpay.io/…` exactly: no other scheme, host, port or
/// credentials.
fn is_checkout_url(raw: &str) -> bool {
    Url::parse(raw).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some(CHECKOUT_HOST)
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    iso_from_unix(secs)
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
