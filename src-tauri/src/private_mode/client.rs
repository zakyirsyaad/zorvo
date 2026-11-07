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
    /// only be this Mac, so "already registered" counts as success.
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
        match status {
            201 | 400 => Ok(()),
            _ => Err(error_from(status, &text)),
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
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

    const SECRET: &str = "ZRV-ABCD-EFGH-JKMN-PQRS";
    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const TOPUP_ID: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

    fn http(status: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    fn header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
    }

    fn content_length(head: &str) -> usize {
        head.lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().ok())?
            })
            .unwrap_or(0)
    }

    /// Reads one whole request (head and body) off `stream` as text.
    fn read_request(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("read timeout");
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            if let Some(end) = header_end(&buf) {
                let head = String::from_utf8_lossy(&buf[..end]).to_string();
                if buf.len() >= end + content_length(&head) {
                    break;
                }
            }
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    /// A one-shot stub on 127.0.0.1: answers one request with `response`, then
    /// returns the request it saw. The base URL is for `HttpCredits::new`.
    fn serve_once(response: Vec<u8>) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("addr"));
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let request = read_request(&mut stream);
            // The client may stop reading a body it refuses; that is fine.
            let _ = stream.write_all(&response);
            request
        });
        (base, handle)
    }

    fn client(base: &str) -> HttpCredits {
        HttpCredits::new(base).expect("a local base is accepted")
    }

    // --- error_from -------------------------------------------------------

    #[test]
    fn error_from_maps_every_server_code() {
        let cases = [
            (409, r#"{"error":"stock"}"#, PrivateError::Stock),
            (409, r#"{"error":"device_cap"}"#, PrivateError::DeviceCap),
            (
                429,
                r#"{"error":"rate_limited"}"#,
                PrivateError::RateLimited,
            ),
            (
                401,
                r#"{"error":"unauthorized"}"#,
                PrivateError::Unauthorized,
            ),
            (404, r#"{"error":"not_found"}"#, PrivateError::NotFound),
            (400, r#"{"error":"bad_request"}"#, PrivateError::BadRequest),
            (502, r#"{"error":"upstream"}"#, PrivateError::Upstream),
            (500, "", PrivateError::Upstream),
        ];
        for (status, body, expected) in cases {
            assert_eq!(error_from(status, body), expected, "{status} {body}");
        }
    }

    #[test]
    fn error_from_falls_back_on_the_status() {
        assert_eq!(error_from(401, "nope"), PrivateError::Unauthorized);
        assert_eq!(error_from(404, "<html>"), PrivateError::NotFound);
        assert_eq!(error_from(429, ""), PrivateError::RateLimited);
        assert_eq!(error_from(502, "<html>"), PrivateError::Upstream);
        assert_eq!(error_from(409, "{}"), PrivateError::BadRequest);
        assert_eq!(error_from(302, ""), PrivateError::Upstream);
    }

    #[test]
    fn a_server_error_status_wins_over_a_body_code() {
        assert_eq!(
            error_from(503, r#"{"error":"stock"}"#),
            PrivateError::Upstream
        );
    }

    // --- base URL ---------------------------------------------------------

    #[test]
    fn new_accepts_only_https_or_loopback_http() {
        assert!(HttpCredits::new("https://x.workers.dev").is_ok());
        assert!(HttpCredits::new("https://x.workers.dev/").is_ok());
        assert!(HttpCredits::new("http://127.0.0.1:8787").is_ok());
        assert!(HttpCredits::new("http://127.0.0.1").is_ok());
        for bad in [
            "http://example.com",
            "http://localhost:8787",
            "http://127.0.0.1.evil.com",
            "http://127.0.0.1@evil.com",
            "http://user@127.0.0.1:8787",
            "ftp://x.workers.dev",
            "x.workers.dev",
            "",
        ] {
            assert_eq!(
                HttpCredits::new(bad).err(),
                Some(PrivateError::BadRequest),
                "{bad}"
            );
        }
    }

    // --- response shapes --------------------------------------------------

    #[test]
    fn stock_reads_the_spec_example() {
        let json = r#"{
          "availableCredits": 12400,
          "yourRoomCredits": 4500,
          "packages": [
            { "usd": 5,  "credits": 500,  "available": true },
            { "usd": 25, "credits": 2500, "available": false, "reason": "device_cap" }
          ],
          "updatedAt": "2026-11-07T01:10:00Z"
        }"#;
        let stock: Stock = parse(json).expect("parses");
        assert_eq!(stock.available_credits, 12400);
        assert_eq!(stock.your_room_credits, 4500);
        assert_eq!(stock.packages.len(), 2);
        assert_eq!(stock.packages[0].reason, None);
        assert_eq!(stock.packages[1].reason.as_deref(), Some("device_cap"));
        assert!(!stock.packages[1].available);
    }

    #[test]
    fn balance_reads_the_server_example_and_ignores_unknown_fields() {
        let json = r#"{"credits":1200,"usedCredits":300,"keyReady":true,
                       "updatedAt":"2026-11-07T01:10:00Z","extra":1}"#;
        let balance: Balance = parse(json).expect("parses");
        assert_eq!(balance.credits, 1200);
        assert_eq!(balance.used_credits, 300);
        assert!(balance.key_ready);
    }

    #[test]
    fn a_missing_required_field_is_an_upstream_error() {
        assert_eq!(parse::<Balance>("{}").err(), Some(PrivateError::Upstream));
        assert_eq!(
            parse::<Balance>("<html>").err(),
            Some(PrivateError::Upstream)
        );
    }

    // --- requests against a stub -----------------------------------------

    #[test]
    fn balance_fresh_sends_the_query_and_the_bearer_secret() {
        let body = br#"{"credits":1200,"usedCredits":300,"keyReady":true,"updatedAt":"t"}"#;
        let (base, served) = serve_once(http("200 OK", body));

        let balance = client(&base).balance(SECRET, true).expect("balance");

        assert_eq!(balance.credits, 1200);
        let request = served.join().expect("stub");
        assert!(
            request.starts_with("GET /v1/balance?fresh=1 HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(
            request.to_ascii_lowercase().contains(&format!(
                "authorization: bearer {}\r\n",
                SECRET.to_ascii_lowercase()
            )),
            "{request}"
        );
    }

    #[test]
    fn balance_without_fresh_has_no_query() {
        let body = br#"{"credits":0,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
        let (base, served) = serve_once(http("200 OK", body));

        client(&base).balance(SECRET, false).expect("balance");

        let request = served.join().expect("stub");
        assert!(
            request.starts_with("GET /v1/balance HTTP/1.1\r\n"),
            "{request}"
        );
    }

    #[test]
    fn register_posts_the_hash_without_a_bearer() {
        let (base, served) = serve_once(http("201 Created", br#"{"deviceId":"d1"}"#));

        client(&base).register(HASH).expect("registered");

        let request = served.join().expect("stub");
        assert!(
            request.starts_with("POST /v1/devices HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(!request.to_ascii_lowercase().contains("authorization"));
        assert!(
            request.ends_with(&format!(r#"{{"secretHash":"{HASH}"}}"#)),
            "{request}"
        );
    }

    #[test]
    fn register_treats_a_duplicate_hash_as_registered() {
        let (base, _served) = serve_once(http("400 Bad Request", br#"{"error":"bad_request"}"#));
        assert_eq!(client(&base).register(HASH), Ok(()));
    }

    #[test]
    fn register_reports_a_rate_limit() {
        let (base, _served) = serve_once(http(
            "429 Too Many Requests",
            br#"{"error":"rate_limited"}"#,
        ));
        assert_eq!(client(&base).register(HASH), Err(PrivateError::RateLimited));
    }

    #[test]
    fn create_topup_posts_the_package_and_reads_the_checkout() {
        let body = br#"{"topupId":"t1","sessionUrl":"https://pay.pingpay.io/x","expiresAt":"e"}"#;
        let (base, served) = serve_once(http("201 Created", body));

        let created = client(&base).create_topup(SECRET, 10).expect("topup");

        assert_eq!(created.topup_id, "t1");
        assert_eq!(created.session_url, "https://pay.pingpay.io/x");
        let request = served.join().expect("stub");
        assert!(
            request.starts_with("POST /v1/topups HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer "));
        assert!(request.ends_with(r#"{"packageUsd":10}"#), "{request}");
    }

    #[test]
    fn create_topup_maps_a_stock_refusal() {
        let (base, _served) = serve_once(http("409 Conflict", br#"{"error":"stock"}"#));
        assert_eq!(
            client(&base).create_topup(SECRET, 10).err(),
            Some(PrivateError::Stock)
        );
    }

    #[test]
    fn topup_and_cancel_use_the_topup_paths() {
        let (base, served) = serve_once(http("200 OK", br#"{"status":"credited","credits":500}"#));
        let state = client(&base).topup(SECRET, TOPUP_ID).expect("state");
        assert_eq!(state.status, "credited");
        assert_eq!(state.credits, 500);
        let request = served.join().expect("stub");
        assert!(
            request.starts_with(&format!("GET /v1/topups/{TOPUP_ID} HTTP/1.1\r\n")),
            "{request}"
        );

        let (base, served) = serve_once(http("200 OK", br#"{"ok":true}"#));
        client(&base)
            .cancel_topup(SECRET, TOPUP_ID)
            .expect("cancel");
        let request = served.join().expect("stub");
        assert!(
            request.starts_with(&format!("POST /v1/topups/{TOPUP_ID}/cancel HTTP/1.1\r\n")),
            "{request}"
        );
    }

    #[test]
    fn a_topup_id_that_is_not_a_plain_token_never_reaches_the_network() {
        // Nothing listens on port 1: a request would be Unreachable.
        let api = client("http://127.0.0.1:1");
        for id in ["", "../balance", "a/b", "a?b=1", "a b", &"x".repeat(65)] {
            assert_eq!(
                api.topup(SECRET, id).err(),
                Some(PrivateError::BadRequest),
                "{id:?}"
            );
            assert_eq!(
                api.cancel_topup(SECRET, id).err(),
                Some(PrivateError::BadRequest),
                "{id:?}"
            );
        }
    }

    #[test]
    fn take_key_returns_the_key_or_none() {
        let (base, served) = serve_once(http("200 OK", br#"{"key":"sk-live-1"}"#));
        assert_eq!(
            client(&base).take_key(SECRET),
            Ok(Some("sk-live-1".to_string()))
        );
        let request = served.join().expect("stub");
        assert!(request.starts_with("GET /v1/key HTTP/1.1\r\n"), "{request}");

        let (base, _served) = serve_once(http("404 Not Found", br#"{"error":"not_found"}"#));
        assert_eq!(client(&base).take_key(SECRET), Ok(None));
    }

    #[test]
    fn redeem_promo_posts_the_code() {
        let (base, served) = serve_once(http("201 Created", br#"{"topupId":"p1","credits":500}"#));

        let result = client(&base)
            .redeem_promo(SECRET, "HELLO-2026")
            .expect("promo");

        assert_eq!(result.topup_id, "p1");
        assert_eq!(result.credits, 500);
        let request = served.join().expect("stub");
        assert!(
            request.starts_with("POST /v1/promo HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(request.ends_with(r#"{"code":"HELLO-2026"}"#), "{request}");
    }

    #[test]
    fn recover_posts_both_values_without_a_bearer() {
        let (base, served) = serve_once(http("200 OK", br#"{"ok":true}"#));

        client(&base).recover(SECRET, HASH).expect("recovered");

        let request = served.join().expect("stub");
        assert!(
            request.starts_with("POST /v1/recover HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(!request.to_ascii_lowercase().contains("authorization"));
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).expect("body")).expect("json");
        assert_eq!(body["recoveryCode"], SECRET);
        assert_eq!(body["newSecretHash"], HASH);
    }

    #[test]
    fn stock_and_models_read_their_lists() {
        let stock =
            br#"{"availableCredits":100,"yourRoomCredits":50,"packages":[],"updatedAt":"t"}"#;
        let (base, served) = serve_once(http("200 OK", stock));
        client(&base).stock(SECRET).expect("stock");
        assert!(served
            .join()
            .expect("stub")
            .starts_with("GET /v1/stock HTTP/1.1\r\n"));

        let models = br#"{"models":[{"id":"qwen3-30b","inputPerM":0.15,"outputPerM":0.6}]}"#;
        let (base, served) = serve_once(http("200 OK", models));
        let list = client(&base).models(SECRET).expect("models");
        assert!(served
            .join()
            .expect("stub")
            .starts_with("GET /v1/models HTTP/1.1\r\n"));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "qwen3-30b");
        assert_eq!(list[0].input_per_m, 0.15);
    }

    #[test]
    fn a_401_is_unauthorized() {
        let (base, _served) = serve_once(http("401 Unauthorized", br#"{"error":"unauthorized"}"#));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Unauthorized)
        );
    }

    #[test]
    fn a_body_over_the_cap_is_an_upstream_error() {
        let big = vec![b' '; 4 * 1024 * 1024];
        let (base, _served) = serve_once(http("200 OK", &big));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Upstream)
        );
    }

    #[test]
    fn a_closed_connection_is_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("addr"));
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            drop(stream);
        });
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Unreachable)
        );
        handle.join().expect("stub");
    }

    #[test]
    fn a_refused_connection_is_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("addr"));
        drop(listener);
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Unreachable)
        );
    }

    // --- fix round 1 -----------------------------------------------------

    /// A raw response: status line and headers as given, the body as bytes.
    fn raw(head: &str, body: &[u8]) -> Vec<u8> {
        let mut out = head.as_bytes().to_vec();
        out.extend_from_slice(body);
        out
    }

    fn json_padded_to(len: usize) -> Vec<u8> {
        let head = br#"{"credits":1,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
        let mut body = head.to_vec();
        body.resize(len, b' ');
        body
    }

    #[test]
    fn a_body_of_exactly_the_cap_passes_and_one_more_byte_does_not() {
        let cap = MAX_BODY_BYTES as usize;
        let (base, _served) = serve_once(http("200 OK", &json_padded_to(cap)));
        assert_eq!(
            client(&base).balance(SECRET, false).map(|b| b.credits),
            Ok(1)
        );

        let (base, _served) = serve_once(http("200 OK", &json_padded_to(cap + 1)));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Upstream)
        );
    }

    #[test]
    fn an_unreadable_error_body_keeps_the_status() {
        let (base, _served) = serve_once(http("401 Unauthorized", &[0xff, 0xfe, 0xfd]));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Unauthorized)
        );

        // Promises 100 bytes, sends 5, closes.
        let truncated = raw(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 100\r\nConnection: close\r\n\r\n",
            b"{\"err",
        );
        let (base, _served) = serve_once(truncated);
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::RateLimited)
        );
    }

    #[test]
    fn an_unreadable_success_body_is_upstream() {
        let (base, _served) = serve_once(http("200 OK", &[0xff, 0xfe, 0xfd]));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Upstream)
        );
    }

    #[test]
    fn an_empty_key_is_never_handed_over() {
        let (base, _served) = serve_once(http("200 OK", br#"{"key":""}"#));
        assert_eq!(
            client(&base).take_key(SECRET).err(),
            Some(PrivateError::Upstream)
        );
    }

    #[test]
    fn new_rejects_more_odd_bases() {
        for bad in [
            "https://x@evil.com",
            "https://x?q=1",
            "https://x#f",
            "http://[::1]:8787",
        ] {
            assert_eq!(
                HttpCredits::new(bad).err(),
                Some(PrivateError::BadRequest),
                "{bad}"
            );
        }
    }

    #[test]
    fn new_reads_an_upper_case_scheme_as_the_same_scheme() {
        assert!(HttpCredits::new("HTTP://127.0.0.1:8787").is_ok());
        assert!(HttpCredits::new("HTTPS://x.workers.dev").is_ok());
        assert_eq!(
            HttpCredits::new("HTTP://example.com").err(),
            Some(PrivateError::BadRequest)
        );
    }

    #[test]
    fn a_base_with_a_path_joins_the_routes_without_a_double_slash() {
        let body = br#"{"credits":0,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
        let (base, served) = serve_once(http("200 OK", body));
        client(&format!("{base}/api/"))
            .balance(SECRET, false)
            .expect("balance");
        let request = served.join().expect("stub");
        assert!(
            request.starts_with("GET /api/v1/balance HTTP/1.1\r\n"),
            "{request}"
        );
    }

    #[test]
    fn statuses_reach_error_from_through_the_stub() {
        let cases: [(&str, &[u8], PrivateError); 4] = [
            ("500 Internal Server Error", b"boom", PrivateError::Upstream),
            (
                "409 Conflict",
                br#"{"error":"device_cap"}"#,
                PrivateError::DeviceCap,
            ),
            ("400 Bad Request", b"", PrivateError::BadRequest),
            ("302 Found", b"", PrivateError::Upstream),
        ];
        for (status, body, expected) in cases {
            let (base, _served) = serve_once(http(status, body));
            assert_eq!(
                client(&base).balance(SECRET, false).err(),
                Some(expected),
                "{status}"
            );
        }
    }

    #[test]
    fn a_success_body_that_is_not_json_is_upstream() {
        let (base, _served) = serve_once(http("200 OK", b"<html>hello</html>"));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(PrivateError::Upstream)
        );
    }

    #[test]
    fn more_topup_id_injections_never_reach_the_network() {
        let api = client("http://127.0.0.1:1");
        for id in ["#", "%2f", "..", "a.b", "a%2Fb"] {
            assert_eq!(
                api.topup(SECRET, id).err(),
                Some(PrivateError::BadRequest),
                "{id}"
            );
            assert_eq!(
                api.cancel_topup(SECRET, id).err(),
                Some(PrivateError::BadRequest),
                "{id}"
            );
        }
    }
}
