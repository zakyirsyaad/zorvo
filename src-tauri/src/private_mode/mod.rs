//! Zorvo Private (hackathon branch only): a device identity kept in the macOS
//! Keychain, a client for the Zorvo Credits Worker and private Qwen Code sessions.

pub mod client;
pub mod commands;
pub mod device;
pub mod launch;
pub mod local_state;
pub mod proxy;
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

/// Declares [`PrivateError`] with each variant's code, and the list of every
/// variant, from one table, so the code, the serde form and the list cannot
/// drift apart (tests check the serde form against the code).
macro_rules! private_errors {
    ($($(#[$doc:meta])* $variant:ident => $code:literal,)+) => {
        /// Everything a private-mode command can fail with. Commands hand the UI only
        /// the snake_case code (see `From<PrivateError> for String`), never a message
        /// that could carry a secret.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum PrivateError {
            $($(#[$doc])* $variant,)+
        }

        impl PrivateError {
            /// Every variant, in declaration order.
            #[cfg(test)]
            pub(crate) const ALL: &'static [PrivateError] = &[$(Self::$variant,)+];

            /// The snake_case code, identical to the serde form.
            pub fn code(self) -> &'static str {
                match self {
                    $(Self::$variant => $code,)+
                }
            }
        }
    };
}

private_errors! {
    Unreachable => "unreachable",
    Unauthorized => "unauthorized",
    BadRequest => "bad_request",
    NotFound => "not_found",
    Stock => "stock",
    DeviceCap => "device_cap",
    RateLimited => "rate_limited",
    Upstream => "upstream",
    Keychain => "keychain",
    NoDevice => "no_device",
    NoKey => "no_key",
    /// The server says a key is ready but it never reached this Mac.
    KeyLost => "key_lost",
    BadCode => "bad_code",
    NotQwen => "not_qwen",
    UnknownModel => "unknown_model",
    BadCheckoutUrl => "bad_checkout_url",
    HasOwnCredits => "has_own_credits",
    /// This Mac's own state file could not be written.
    Storage => "storage",
    /// The system browser did not open the checkout; its hold stands.
    OpenFailed => "open_failed",
    /// An agent session that ran privately may only be opened privately.
    PrivateSession => "private_session",
    /// A private session keeps the model Zorvo launched it on.
    ModelLocked => "model_locked",
}

impl From<PrivateError> for String {
    fn from(error: PrivateError) -> Self {
        error.code().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_matches_the_serde_form_for_every_variant() {
        // `ALL` comes from the same macro call as the enum, so it cannot miss a variant.
        for error in PrivateError::ALL {
            let json = serde_json::to_value(error).expect("serializes");
            assert_eq!(json, serde_json::Value::String(error.code().to_string()));
        }
    }

    #[test]
    fn every_variant_has_a_code_of_its_own() {
        let codes: std::collections::HashSet<&str> =
            PrivateError::ALL.iter().map(|error| error.code()).collect();
        assert_eq!(codes.len(), PrivateError::ALL.len());
    }

    #[test]
    fn converts_to_the_snake_case_code() {
        assert_eq!(String::from(PrivateError::HasOwnCredits), "has_own_credits");
        assert_eq!(String::from(PrivateError::KeyLost), "key_lost");
        assert_eq!(String::from(PrivateError::OpenFailed), "open_failed");
        assert_eq!(
            String::from(PrivateError::PrivateSession),
            "private_session"
        );
    }
}
