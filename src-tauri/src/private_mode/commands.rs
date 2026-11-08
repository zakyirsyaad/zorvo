//! The `private_*` Tauri commands: thin wrappers over [`PrivateMode`]. Each
//! runs on a blocking thread (`async`), since most call the Credits Worker or
//! the Keychain, and fails with the snake_case code of a [`PrivateError`],
//! never a message.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;

use super::client::{
    Balance, CreatedTopup, CreditsApi, HttpCredits, ModelPrice, PromoResult, Stock, TopupState,
};
use super::device::{keychain_service, KeychainStore};
use super::launch::NEAR_AI_BASE_URL;
use super::local_state::PendingTopup;
use super::proxy::PrivateProxy;
use super::service::{PrivateMode, PrivateStatus};
use super::verify::{PrivateVerifier, RecordVerification};
use super::{PrivateError, CREDITS_BASE_URL};

const STATE_DIR: &str = "private";

/// The `PrivateMode` the app manages: the Keychain, the Credits Worker at
/// `CREDITS_BASE_URL`, `<data_dir>/private`, the system browser and the loopback
/// proxy. A base URL the client refuses leaves private mode offline instead of
/// stopping the app.
pub fn private_mode_for(
    data_dir: &Path,
    proxy: Arc<PrivateProxy>,
    mcp_script: Option<PathBuf>,
) -> PrivateMode {
    let api: Box<dyn CreditsApi> = match HttpCredits::new(CREDITS_BASE_URL) {
        Ok(api) => Box::new(api),
        Err(error) => {
            eprintln!(
                "private mode: the credits server address is not usable ({}); private mode stays offline",
                error.code()
            );
            Box::new(OfflineCredits)
        }
    };
    let mode = PrivateMode::new(
        Box::new(KeychainStore::new(keychain_service(data_dir))),
        api,
        data_dir.join(STATE_DIR),
        Box::new(crate::windows::open_url),
        proxy,
        PrivateVerifier::new(NEAR_AI_BASE_URL),
    );
    if let Some(path) = mcp_script {
        mode.set_mcp_script(path);
    }
    mode
}

/// A Credits Worker that is never reachable.
struct OfflineCredits;

impl CreditsApi for OfflineCredits {
    fn register(&self, _: &str) -> Result<(), PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn balance(&self, _: &str, _: bool) -> Result<Balance, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn stock(&self, _: &str) -> Result<Stock, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn models(&self, _: &str) -> Result<Vec<ModelPrice>, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn create_topup(&self, _: &str, _: u32) -> Result<CreatedTopup, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn topup(&self, _: &str, _: &str) -> Result<TopupState, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn cancel_topup(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn take_key(&self, _: &str) -> Result<Option<String>, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn redeem_promo(&self, _: &str, _: &str) -> Result<PromoResult, PrivateError> {
        Err(PrivateError::Unreachable)
    }
    fn recover(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        Err(PrivateError::Unreachable)
    }
}

#[tauri::command(async)]
pub fn private_status(
    private: State<'_, PrivateMode>,
    fresh: bool,
) -> Result<PrivateStatus, String> {
    Ok(private.status(fresh))
}

#[tauri::command(async)]
pub fn private_stock(private: State<'_, PrivateMode>) -> Result<Stock, String> {
    Ok(private.stock()?)
}

#[tauri::command(async)]
pub fn private_models(private: State<'_, PrivateMode>) -> Result<Vec<ModelPrice>, String> {
    Ok(private.models()?)
}

#[tauri::command(async)]
pub fn private_create_topup(
    private: State<'_, PrivateMode>,
    package_usd: u32,
) -> Result<PendingTopup, String> {
    Ok(private.create_topup(package_usd)?)
}

#[tauri::command(async)]
pub fn private_open_checkout(
    private: State<'_, PrivateMode>,
    topup_id: String,
) -> Result<(), String> {
    Ok(private.open_checkout(&topup_id)?)
}

#[tauri::command(async)]
pub fn private_topup_status(
    private: State<'_, PrivateMode>,
    topup_id: String,
) -> Result<TopupState, String> {
    Ok(private.topup_status(&topup_id)?)
}

#[tauri::command(async)]
pub fn private_cancel_topup(
    private: State<'_, PrivateMode>,
    topup_id: String,
) -> Result<(), String> {
    Ok(private.cancel_topup(&topup_id)?)
}

#[tauri::command(async)]
pub fn private_redeem_promo(
    private: State<'_, PrivateMode>,
    code: String,
) -> Result<PromoResult, String> {
    Ok(private.redeem_promo(&code)?)
}

#[tauri::command(async)]
pub fn private_recovery_code(private: State<'_, PrivateMode>) -> Result<String, String> {
    Ok(private.recovery_code()?)
}

#[tauri::command(async)]
pub fn private_mark_recovery(private: State<'_, PrivateMode>, saved: bool) -> Result<(), String> {
    Ok(private.mark_recovery(saved)?)
}

#[tauri::command(async)]
pub fn private_recover(private: State<'_, PrivateMode>, code: String) -> Result<String, String> {
    Ok(private.recover(&code)?)
}

#[tauri::command(async)]
pub fn private_forget_device(private: State<'_, PrivateMode>) -> Result<(), String> {
    Ok(private.forget_device()?)
}

/// The private calls of `session_id` that are not final yet, checked against NEAR AI's signature
/// and attestation. Called at each private turn's end.
#[tauri::command(async)]
pub fn private_verify(
    private: State<'_, PrivateMode>,
    session_id: String,
) -> Result<Vec<RecordVerification>, String> {
    Ok(private.verify_proxy_records(&session_id)?)
}

/// A deleted session no longer needs its last token's records.
#[tauri::command(async)]
pub fn private_forget_session(private: State<'_, PrivateMode>, session_id: String) {
    private.forget_proxy_session(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_credits_answer_unreachable_to_everything() {
        let api = OfflineCredits;
        let unreachable = Err(PrivateError::Unreachable);
        assert_eq!(api.register("h"), unreachable);
        assert_eq!(api.balance("s", true).map(|_| ()), unreachable);
        assert_eq!(api.stock("s").map(|_| ()), unreachable);
        assert_eq!(api.models("s").map(|_| ()), unreachable);
        assert_eq!(api.create_topup("s", 5).map(|_| ()), unreachable);
        assert_eq!(api.topup("s", "t").map(|_| ()), unreachable);
        assert_eq!(api.cancel_topup("s", "t"), unreachable);
        assert_eq!(api.take_key("s").map(|_| ()), unreachable);
        assert_eq!(api.redeem_promo("s", "c").map(|_| ()), unreachable);
        assert_eq!(api.recover("c", "h"), unreachable);
    }
}
