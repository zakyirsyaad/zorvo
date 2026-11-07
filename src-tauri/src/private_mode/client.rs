//! The HTTP client for the Zorvo Credits Worker (`server/`).
//!
//! The Worker is the only host this module ever calls, and `HttpCredits::new`
//! accepts only an `https://` base or `http://127.0.0.1` (for local
//! development). Every device call sends the device secret as a bearer token;
//! the secret and the recovery code appear in no error value, log line or
//! `Debug` output: errors are the `Copy` codes of [`PrivateError`], and
//! [`error_from`] never echoes a response body.

use std::net::Ipv4Addr;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ureq::http::{Method, Request};
use url::{Host, Url};

use super::PrivateError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
/// Every Worker answer is small JSON; anything larger is not the Worker.
const MAX_BODY_BYTES: u64 = 64 * 1024;
const MAX_TOPUP_ID_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub credits: u64,
    pub used_credits: u64,
    pub key_ready: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPackage {
    pub usd: u32,
    pub credits: u64,
    pub available: bool,
    /// `stock` or `device_cap` when the package is not available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    pub available_credits: u64,
    pub your_room_credits: u64,
    pub packages: Vec<StockPackage>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub id: String,
    pub input_per_m: f64,
    pub output_per_m: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTopup {
    pub topup_id: String,
    pub session_url: String,
    pub expires_at: String,
}

/// `status` is one of `created`, `paid`, `credited`, `expired`, `failed` or
/// `paid_waiting_stock`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupState {
    pub status: String,
    pub credits: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoResult {
    pub topup_id: String,
    pub credits: u64,
}

#[derive(Deserialize)]
struct ModelList {
    models: Vec<ModelPrice>,
}

#[derive(Deserialize)]
struct KeyAnswer {
    key: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<String>,
}

/// What the rest of the backend needs from the Credits Worker. A trait so
/// tests can inject a fake. Methods that take `secret` send it as the bearer
/// token; `register` and `recover` carry no bearer.
pub trait CreditsApi: Send + Sync {
    /// Registers the hash of this Mac's secret. A duplicate 80-bit hash can
    /// only be this Mac, so "already registered" counts as success. The Worker
    /// words it `400 {"error":"bad_request"}`, its answer to a malformed hash
    /// too, which Zorvo never sends.
    fn register(&self, secret_hash: &str) -> Result<(), PrivateError>;
    fn balance(&self, secret: &str, fresh: bool) -> Result<Balance, PrivateError>;
    fn stock(&self, secret: &str) -> Result<Stock, PrivateError>;
    fn models(&self, secret: &str) -> Result<Vec<ModelPrice>, PrivateError>;
    fn create_topup(&self, secret: &str, package_usd: u32) -> Result<CreatedTopup, PrivateError>;
    fn topup(&self, secret: &str, id: &str) -> Result<TopupState, PrivateError>;
    fn cancel_topup(&self, secret: &str, id: &str) -> Result<(), PrivateError>;
    /// The NEAR AI key, handed over once; `None` when there is none to take.
    fn take_key(&self, secret: &str) -> Result<Option<String>, PrivateError>;
    fn redeem_promo(&self, secret: &str, code: &str) -> Result<PromoResult, PrivateError>;
    /// Moves the device behind `code` to a new secret. Sends no bearer.
    fn recover(&self, code: &str, new_secret_hash: &str) -> Result<(), PrivateError>;
}

// The service holds the Worker as `Box<dyn CreditsApi>`: a method that made
// the trait unusable as an object must fail here, not at a distant use.
const _: Option<&dyn CreditsApi> = None;

/// Maps a failed answer to a code. The status decides for 401, 404 and 5xx;
/// otherwise the body's `error` code does, then the status. The body is parsed
/// and dropped, never echoed.
pub fn error_from(status: u16, body: &str) -> PrivateError {
    match status {
        401 => return PrivateError::Unauthorized,
        404 => return PrivateError::NotFound,
        500.. => return PrivateError::Upstream,
        _ => {}
    }
    let code = serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|parsed| parsed.error);
    match code.as_deref() {
        Some("stock") => PrivateError::Stock,
        Some("device_cap") => PrivateError::DeviceCap,
        Some("rate_limited") => PrivateError::RateLimited,
        Some("unauthorized") => PrivateError::Unauthorized,
        Some("not_found") => PrivateError::NotFound,
        Some("bad_request") => PrivateError::BadRequest,
        Some("upstream") => PrivateError::Upstream,
        _ => match status {
            429 => PrivateError::RateLimited,
            400..=499 => PrivateError::BadRequest,
            _ => PrivateError::Upstream,
        },
    }
}

/// Whether `body` is the Worker's `{"error":"bad_request"}`.
fn is_bad_request_body(body: &str) -> bool {
    serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|parsed| parsed.error)
        .is_some_and(|code| code == "bad_request")
}

/// Reads a success body; a body that is not the expected shape is the
/// Worker's fault.
fn parse<T: DeserializeOwned>(body: &str) -> Result<T, PrivateError> {
    serde_json::from_str(body).map_err(|_| PrivateError::Upstream)
}

/// Topup ids go into a URL path, so only a plain token may.
fn is_plain_token(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_TOPUP_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub struct HttpCredits {
    base: String,
    agent: ureq::Agent,
}

impl HttpCredits {
    /// `base` must be `https://…` or `http://127.0.0.1…` with no credentials,
    /// query or fragment. `localhost` is not accepted: only the literal
    /// loopback address is.
    pub fn new(base: &str) -> Result<Self, PrivateError> {
        let url = Url::parse(base).map_err(|_| PrivateError::BadRequest)?;
        let host_ok = match url.scheme() {
            "https" => url.host().is_some(),
            "http" => url.host() == Some(Host::Ipv4(Ipv4Addr::LOCALHOST)),
            _ => false,
        };
        let plain = url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none();
        if !(host_ok && plain) {
            return Err(PrivateError::BadRequest);
        }
        let mut config = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .max_redirects(0)
            .http_status_as_error(false);
        if url.scheme() == "http" {
            // The loopback dev base: a proxy would resolve 127.0.0.1 on its own
            // host and see the bearer secret in the clear. https keeps the
            // user's proxy settings, where the proxy only sees a CONNECT.
            config = config.proxy(None);
        }
        let agent: ureq::Agent = config.build().into();
        Ok(Self {
            base: url.as_str().trim_end_matches('/').to_string(),
            agent,
        })
    }

    /// The one place a request is made. Returns the status and the (capped)
    /// body whatever the status; a transport failure is `Unreachable`.
    fn request(
        &self,
        method: Method,
        path: &str,
        secret: Option<&str>,
        body: Option<Value>,
    ) -> Result<(u16, String), PrivateError> {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("{}{path}", self.base));
        if let Some(secret) = secret {
            builder = builder.header("Authorization", format!("Bearer {secret}"));
        }
        let payload = match body {
            Some(value) => {
                builder = builder.header("Content-Type", "application/json");
                value.to_string()
            }
            None => String::new(),
        };
        let request = builder
            .body(payload)
            .map_err(|_| PrivateError::BadRequest)?;
        let mut response = self
            .agent
            .run(request)
            .map_err(|_| PrivateError::Unreachable)?;
        let status = response.status().as_u16();
        // ureq's reader errors once the limit is used up, before it sees EOF,
        // so ask for one byte more: exactly MAX_BODY_BYTES still passes.
        let read = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES + 1)
            .read_to_string();
        match read {
            Ok(text) if text.len() as u64 <= MAX_BODY_BYTES => Ok((status, text)),
            Ok(_) | Err(ureq::Error::BodyExceedsLimit(_)) => Err(PrivateError::Upstream),
            // The server answered, so its status still says what happened.
            Err(_) if status >= 400 => Ok((status, String::new())),
            Err(_) => Err(PrivateError::Upstream),
        }
    }

    /// `request`, then the body of a 2xx answer or the code of any other.
    fn succeed(
        &self,
        method: Method,
        path: &str,
        secret: Option<&str>,
        body: Option<Value>,
    ) -> Result<String, PrivateError> {
        let (status, text) = self.request(method, path, secret, body)?;
        if (200..300).contains(&status) {
            Ok(text)
        } else {
            Err(error_from(status, &text))
        }
    }

    fn get<T: DeserializeOwned>(&self, path: &str, secret: &str) -> Result<T, PrivateError> {
        parse(&self.succeed(Method::GET, path, Some(secret), None)?)
    }
}

impl CreditsApi for HttpCredits {
    fn register(&self, secret_hash: &str) -> Result<(), PrivateError> {
        let body = json!({ "secretHash": secret_hash });
        let (status, text) = self.request(Method::POST, "/v1/devices", None, Some(body))?;
        match (status, error_from(status, &text)) {
            (201, _) => Ok(()),
            // The Worker answers a hash it already holds with this, and the
            // hash Zorvo sends is always well formed. A 400 without the
            // Worker's own code (a proxy's page, an empty body) is a failure.
            (400, PrivateError::BadRequest) if is_bad_request_body(&text) => Ok(()),
            (_, error) => Err(error),
        }
    }

    fn balance(&self, secret: &str, fresh: bool) -> Result<Balance, PrivateError> {
        let path = if fresh {
            "/v1/balance?fresh=1"
        } else {
            "/v1/balance"
        };
        self.get(path, secret)
    }

    fn stock(&self, secret: &str) -> Result<Stock, PrivateError> {
        self.get("/v1/stock", secret)
    }

    fn models(&self, secret: &str) -> Result<Vec<ModelPrice>, PrivateError> {
        Ok(self.get::<ModelList>("/v1/models", secret)?.models)
    }

    fn create_topup(&self, secret: &str, package_usd: u32) -> Result<CreatedTopup, PrivateError> {
        let body = json!({ "packageUsd": package_usd });
        let text = self.succeed(Method::POST, "/v1/topups", Some(secret), Some(body))?;
        parse(&text)
    }

    fn topup(&self, secret: &str, id: &str) -> Result<TopupState, PrivateError> {
        if !is_plain_token(id) {
            return Err(PrivateError::BadRequest);
        }
        self.get(&format!("/v1/topups/{id}"), secret)
    }

    fn cancel_topup(&self, secret: &str, id: &str) -> Result<(), PrivateError> {
        if !is_plain_token(id) {
            return Err(PrivateError::BadRequest);
        }
        let path = format!("/v1/topups/{id}/cancel");
        self.succeed(Method::POST, &path, Some(secret), None)
            .map(|_| ())
    }

    fn take_key(&self, secret: &str) -> Result<Option<String>, PrivateError> {
        let (status, text) = self.request(Method::GET, "/v1/key", Some(secret), None)?;
        match status {
            200 => match parse::<KeyAnswer>(&text)?.key {
                key if key.is_empty() => Err(PrivateError::Upstream),
                key => Ok(Some(key)),
            },
            404 => Ok(None),
            _ => Err(error_from(status, &text)),
        }
    }

    fn redeem_promo(&self, secret: &str, code: &str) -> Result<PromoResult, PrivateError> {
        let body = json!({ "code": code });
        let text = self.succeed(Method::POST, "/v1/promo", Some(secret), Some(body))?;
        parse(&text)
    }

    fn recover(&self, code: &str, new_secret_hash: &str) -> Result<(), PrivateError> {
        let body = json!({ "recoveryCode": code, "newSecretHash": new_secret_hash });
        self.succeed(Method::POST, "/v1/recover", None, Some(body))
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests;
