//! Recovery: moving a device to this Mac with a recovery code, settling a
//! recovery left in `device-secret-next`, and forgetting a device.

use std::sync::atomic::Ordering;

use super::super::client::Balance;
use super::super::device::{
    new_recovery_code, normalize_recovery_code, secret_hash, DEVICE_SECRET, DEVICE_SECRET_NEXT,
    NEARAI_KEY,
};
use super::super::local_state::LocalState;
use super::super::PrivateError;
use super::{has_own_credits, lock, now_millis, PrivateMode, ROTATION_WINDOW_MS};

impl PrivateMode {
    pub(super) fn finish_recovery(
        &self,
        fresh: bool,
    ) -> Result<Option<(String, Balance)>, PrivateError> {
        let _guard = lock(&self.handover);
        self.finish_recovery_locked(fresh)
    }

    /// Settles a recovery left in `device-secret-next`, with `handover` held:
    /// a balance with it that succeeds means the server took it, so it is
    /// promoted; a `401` means the server never did, so it is deleted; any
    /// other error leaves it for next time.
    pub(super) fn finish_recovery_locked(
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
                self.promote(&next, false)?;
                self.remember_balance(&balance);
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
    /// key is dropped (the server revokes it and rotates a new one in, which
    /// is expected for a while), the device is no longer moved, and the new
    /// code has not been saved by the user yet. The last balance is dropped
    /// too unless the device is the one this Mac already had (`same_device`,
    /// its own code restored): another device's balance says nothing about
    /// this one, and a top-up's baseline must never be read from it.
    fn promote(&self, next: &str, same_device: bool) -> Result<(), PrivateError> {
        self.store.delete(NEARAI_KEY)?;
        self.store.set(DEVICE_SECRET, next)?;
        self.registered.store(true, Ordering::SeqCst);
        *lock(&self.unsaved_key) = None;
        // A leftover copy equals the secret now; `finish_recovery_locked`
        // deletes it next time without promoting it again.
        let _ = self.store.delete(DEVICE_SECRET_NEXT);
        self.change_state(|old| LocalState {
            recovery_saved: false,
            recovery_prompted: false,
            moved: false,
            rotation_expected_until: Some(now_millis().saturating_add(ROTATION_WINDOW_MS)),
            last_balance: if same_device { old.last_balance } else { None },
            ..old
        });
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
        let same_device = self.is_own_code(&typed)?;
        // Only a secret this Mac still holds has credits to orphan: with the
        // Keychain item lost, a leftover balance in the state file must not
        // block the restore that brings the credits back.
        let has_own_secret = self.store.get(DEVICE_SECRET)?.is_some();
        if !same_device && has_own_secret && has_own_credits(&self.load_state()) {
            return Err(PrivateError::HasOwnCredits);
        }
        let new = new_recovery_code()?;
        self.store.set(DEVICE_SECRET_NEXT, &new)?;
        match self.api.recover(&typed, &secret_hash(&new)) {
            Ok(()) => {
                self.promote(&new, same_device)?;
                self.remember_recovered_balance(&new);
                Ok(new)
            }
            Err(PrivateError::BadRequest) => {
                self.store.delete(DEVICE_SECRET_NEXT)?;
                Err(PrivateError::BadCode)
            }
            Err(error) => Err(error),
        }
    }

    /// Reads and keeps the balance of the device a recovery just brought here,
    /// so its credits guard Forget and another restore before the next status.
    /// Best effort: the recovery has happened either way, and the next status
    /// reads the balance again.
    fn remember_recovered_balance(&self, secret: &str) {
        if let Ok(balance) = self.api.balance(secret, false) {
            self.remember_balance(&balance);
        }
    }

    /// Whether `typed` (canonical) is this Mac's own code. Restoring another
    /// Mac's code here would orphan this Mac's own credits or top-up, so
    /// `recover` refuses that; this Mac's own code is allowed: it re-issues a
    /// key that was never collected. A moved device has nothing left here to
    /// orphan.
    fn is_own_code(&self, typed: &str) -> Result<bool, PrivateError> {
        Ok(self
            .store
            .get(DEVICE_SECRET)?
            .is_some_and(|own| normalize_recovery_code(&own).as_deref() == Some(typed)))
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

    /// Deletes every Keychain item and resets the state file. The UI offers
    /// it only for a moved device; these guards keep a stray call from
    /// wiping credits:
    /// - a recovery in flight that cannot be settled: `Unreachable`, since
    ///   `device-secret-next` may be the only working secret;
    /// - a recovery settled by this very call: `Unreachable`, since the user
    ///   has not seen the recovered device's code yet (the next status shows it);
    /// - a device that is not moved and has credits or a top-up: `HasOwnCredits`.
    ///
    /// Without a device it only resets the state file.
    pub fn forget_device(&self) -> Result<(), PrivateError> {
        let _guard = lock(&self.handover);
        match self.finish_recovery_locked(false) {
            Ok(None) => {}
            Ok(Some(_)) => return Err(PrivateError::Unreachable),
            Err(PrivateError::Keychain) => return Err(PrivateError::Keychain),
            Err(_) => return Err(PrivateError::Unreachable),
        }
        if self.store.get(DEVICE_SECRET)?.is_some() && has_own_credits(&self.load_state()) {
            return Err(PrivateError::HasOwnCredits);
        }
        for account in [NEARAI_KEY, DEVICE_SECRET_NEXT, DEVICE_SECRET] {
            self.store.delete(account)?;
        }
        self.registered.store(false, Ordering::SeqCst);
        *lock(&self.unsaved_key) = None;
        lock(&self.checkouts).clear();
        // The record of private sessions belongs to the agent's store, not to
        // the device: forgetting the device must not unlock those sessions.
        self.update_state(|old| LocalState {
            private_sessions: old.private_sessions,
            ..LocalState::default()
        })
        .map(|_| ())
    }
}
