//! Zorvo Private (hackathon branch only): a device identity kept in the macOS
//! Keychain, a client for the Zorvo Credits Worker and private Qwen Code sessions.

pub mod client;
pub mod commands;
pub mod device;
pub mod launch;
pub mod local_state;
pub mod service;
#[cfg(test)]
pub(crate) mod testing;

use serde::Serialize;

/// Prefix of the error text the agent process reports when private credits ran
/// out or the key was refused. The reason follows as JSON, e.g.
/// `PRIVATE_CREDITS:{"reason":"empty"}`.
pub const PRIVATE_CREDITS_PREFIX: &str = "PRIVATE_CREDITS:";

/// The Zorvo Credits Worker, the only host the backend calls for private mode.
/// Set `ZORVO_CREDITS_URL` when building; the default is the local dev server.
pub const CREDITS_BASE_URL: &str = match option_env!("ZORVO_CREDITS_URL") {
    Some(url) => url,
    None => "http://127.0.0.1:8787",
};

/// Everything a private-mode command can fail with. Commands hand the UI only
/// the snake_case code (see `From<PrivateError> for String`), never a message
/// that could carry a secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivateError {
    Unreachable,
    Unauthorized,
    BadRequest,
    NotFound,
    Stock,
    DeviceCap,
    RateLimited,
    Upstream,
    Keychain,
    NoDevice,
    NoKey,
    /// The server says a key is ready but it never reached this Mac.
    KeyLost,
    BadCode,
    NotQwen,
    UnknownModel,
    BadCheckoutUrl,
    HasOwnCredits,
    /// This Mac's own state file could not be written.
    Storage,
    /// The system browser did not open the checkout; its hold stands.
    OpenFailed,
}

impl PrivateError {
    /// The snake_case code, identical to the serde form.
    pub fn code(self) -> &'static str {
        match self {
            Self::Unreachable => "unreachable",
            Self::Unauthorized => "unauthorized",
            Self::BadRequest => "bad_request",
            Self::NotFound => "not_found",
            Self::Stock => "stock",
            Self::DeviceCap => "device_cap",
            Self::RateLimited => "rate_limited",
            Self::Upstream => "upstream",
            Self::Keychain => "keychain",
            Self::NoDevice => "no_device",
            Self::NoKey => "no_key",
            Self::KeyLost => "key_lost",
            Self::BadCode => "bad_code",
            Self::NotQwen => "not_qwen",
            Self::UnknownModel => "unknown_model",
            Self::BadCheckoutUrl => "bad_checkout_url",
            Self::HasOwnCredits => "has_own_credits",
            Self::Storage => "storage",
            Self::OpenFailed => "open_failed",
        }
    }
}

impl From<PrivateError> for String {
    fn from(error: PrivateError) -> Self {
        error.code().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [PrivateError; 19] = [
        PrivateError::Unreachable,
        PrivateError::Unauthorized,
        PrivateError::BadRequest,
        PrivateError::NotFound,
        PrivateError::Stock,
        PrivateError::DeviceCap,
        PrivateError::RateLimited,
        PrivateError::Upstream,
        PrivateError::Keychain,
        PrivateError::NoDevice,
        PrivateError::NoKey,
        PrivateError::KeyLost,
        PrivateError::BadCode,
        PrivateError::NotQwen,
        PrivateError::UnknownModel,
        PrivateError::BadCheckoutUrl,
        PrivateError::HasOwnCredits,
        PrivateError::Storage,
        PrivateError::OpenFailed,
    ];

    #[test]
    fn code_matches_the_serde_form_for_every_variant() {
        for error in ALL {
            let json = serde_json::to_value(error).expect("serializes");
            assert_eq!(json, serde_json::Value::String(error.code().to_string()));
        }
    }

    #[test]
    fn converts_to_the_snake_case_code() {
        assert_eq!(String::from(PrivateError::HasOwnCredits), "has_own_credits");
        assert_eq!(String::from(PrivateError::KeyLost), "key_lost");
        assert_eq!(String::from(PrivateError::OpenFailed), "open_failed");
    }
}
