//! The loopback listener private agents talk to. One listener per app run, bound to 127.0.0.1:0,
//! with one live token per private agent process; a native fork shares its source's token.

use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::CONTENT_TYPE;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rustls_platform_verifier::BuilderVerifierExt;
use tokio::net::TcpListener as TokioListener;
use tokio::sync::oneshot;

use super::forward;
use super::mcp::McpState;
use super::records::{hex, lock, RecordStore};
use super::topup::TopupRefusal;
use crate::private_mode::PrivateError;

/// A connect that takes longer than this fails the request.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// A stream that sends nothing for this long is treated as dead. There is no total timeout.
const READ_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// A top-up request is two short fields; anything larger is not one.
const MAX_TOPUP_REQUEST_BYTES: usize = 16 * 1024;

pub(super) type ProxyBody = BoxBody<Bytes, io::Error>;

/// What the agent process is allowed to spend: the real key stays here, never in the agent's
/// process. A native fork shares its source's process, so it is a second holder of the same token.
#[derive(Clone)]
pub(super) struct TokenEntry {
    pub(super) token: String,
    pub(super) app_session_id: String,
    pub(super) model: String,
    pub(super) key: String,
    /// The key is the user's own; its balance is not visible to Zorvo.
    pub(super) own_key: bool,
    holders: HashSet<String>,
}

#[cfg(test)]
impl TokenEntry {
    pub(super) fn for_test(app_session_id: &str, own_key: bool) -> Self {
        Self {
            token: "test-token".to_string(),
            app_session_id: app_session_id.to_string(),
            model: "Qwen/Qwen3.8-27B".to_string(),
            key: "test-key".to_string(),
            own_key,
            holders: HashSet::from([app_session_id.to_string()]),
        }
    }
}

#[derive(Default)]
struct TokenTable {
    by_token: HashMap<String, TokenEntry>,
    by_session: HashMap<String, String>,
    /// Every token each session has held this run, oldest first, so a reopen keeps its records.
    tokens_by_session: HashMap<String, Vec<String>>,
    /// The last token each session held, so a turn that ends after Stop can still be verified.
    last_by_session: HashMap<String, String>,
    /// The key behind that last token. Kept until the session is deleted, so a turn that ended
    /// after Stop can still be verified and billed; it never leaves the backend.
    last_key_by_session: HashMap<String, String>,
}

impl TokenTable {
    fn issue(
        &mut self,
        app_session_id: &str,
        model: &str,
        key: &str,
        own_key: bool,
    ) -> Result<String, PrivateError> {
        // Made before the old token is detached, so a random-source failure leaves the session as
        // it was.
        let token = random_token()?;
        self.detach(app_session_id);
        self.by_session
            .insert(app_session_id.to_string(), token.clone());
        self.last_by_session
            .insert(app_session_id.to_string(), token.clone());
        self.last_key_by_session
            .insert(app_session_id.to_string(), key.to_string());
        let held = self
            .tokens_by_session
            .entry(app_session_id.to_string())
            .or_default();
        if !held.contains(&token) {
            held.push(token.clone());
        }
        self.by_token.insert(
            token.clone(),
            TokenEntry {
                token: token.clone(),
                app_session_id: app_session_id.to_string(),
                model: model.to_string(),
                key: key.to_string(),
                own_key,
                holders: HashSet::from([app_session_id.to_string()]),
            },
        );
        Ok(token)
    }

    /// Makes `fork` a holder of `source`'s token, so stopping the source leaves the fork working.
    /// A source that never got a token (a plain session) adds nothing.
    fn share(&mut self, source: &str, fork: &str) -> bool {
        if source == fork {
            return false;
        }
        let Some(token) = self.by_session.get(source).cloned() else {
            return false;
        };
        if !self.by_token.contains_key(&token) {
            return false;
        }
        self.detach(fork);
        let Some(entry) = self.by_token.get_mut(&token) else {
            return false;
        };
        let key = entry.key.clone();
        entry.holders.insert(fork.to_string());
        self.last_key_by_session.insert(fork.to_string(), key);
        self.by_session.insert(fork.to_string(), token.clone());
        self.last_by_session.insert(fork.to_string(), token.clone());
        let held = self.tokens_by_session.entry(fork.to_string()).or_default();
        if !held.contains(&token) {
            held.push(token.clone());
        }
        true
    }

    /// The live entry a bearer token names. Tokens are compared without an early exit, so a wrong
    /// token learns nothing from timing.
    fn find(&self, raw: &str) -> Option<TokenEntry> {
        let candidate = raw.as_bytes();
        let mut found = None;
        for (token, entry) in &self.by_token {
            if constant_time_eq(token.as_bytes(), candidate) {
                found = Some(entry.clone());
            }
        }
        found
    }

    fn token_of(&self, app_session_id: &str) -> Option<String> {
        self.by_session
            .get(app_session_id)
            .or_else(|| self.last_by_session.get(app_session_id))
            .cloned()
    }

    fn key_of(&self, app_session_id: &str) -> Option<String> {
        if let Some(key) = self.last_key_by_session.get(app_session_id) {
            return Some(key.clone());
        }
        let token = self.token_of(app_session_id)?;
        self.by_token.get(&token).map(|entry| entry.key.clone())
    }

    /// Removes one holder; the token goes only when no session is left on that process.
    fn release(&mut self, app_session_id: &str) {
        let Some(token) = self.by_session.remove(app_session_id) else {
            return;
        };
        let empty = match self.by_token.get_mut(&token) {
            Some(entry) => {
                entry.holders.remove(app_session_id);
                entry.holders.is_empty()
            }
            None => false,
        };
        if empty {
            self.by_token.remove(&token);
        }
    }

    fn detach(&mut self, app_session_id: &str) {
        if self.by_session.contains_key(app_session_id) {
            self.release(app_session_id);
        }
    }

    /// Forgets a deleted session: its token history goes, and every token no other session holds is
    /// returned, so its records can go too.
    fn forget(&mut self, app_session_id: &str) -> Vec<String> {
        self.last_key_by_session.remove(app_session_id);
        let mut tokens = self
            .tokens_by_session
            .remove(app_session_id)
            .unwrap_or_default();
        if let Some(last) = self.last_by_session.remove(app_session_id) {
            if !tokens.contains(&last) {
                tokens.push(last);
            }
        }
        self.release(app_session_id);
        tokens
            .into_iter()
            .filter(|token| !self.by_token.contains_key(token))
            .collect()
    }

    /// Every token the session has held this run, oldest first.
    fn tokens_of(&self, app_session_id: &str) -> Vec<String> {
        let mut tokens = self
            .tokens_by_session
            .get(app_session_id)
            .cloned()
            .unwrap_or_default();
        for token in [
            self.by_session.get(app_session_id),
            self.last_by_session.get(app_session_id),
        ]
        .into_iter()
        .flatten()
        {
            if !tokens.contains(token) {
                tokens.push(token.clone());
            }
        }
        tokens
    }

    /// Drops every token that spends the user's own key, with all its holders. The key is gone
    /// from the Keychain, so a running session must not keep using a token that still holds it.
    fn revoke_own_key(&mut self) -> Vec<String> {
        let revoked: Vec<String> = self
            .by_token
            .iter()
            .filter(|(_, entry)| entry.own_key)
            .map(|(token, _)| token.clone())
            .collect();
        for token in &revoked {
            let Some(entry) = self.by_token.remove(token) else {
                continue;
            };
            for holder in entry.holders {
                if self.by_session.get(&holder) == Some(token) {
                    self.by_session.remove(&holder);
                }
                if self.last_by_session.get(&holder) == Some(token) {
                    self.last_by_session.remove(&holder);
                }
                self.last_key_by_session.remove(&holder);
                self.tokens_by_session.remove(&holder);
            }
        }
        revoked
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

/// The proxy's TLS config: the OS root store through rustls-platform-verifier and the ring
/// provider ureq already uses, so the release build keeps one native crypto stack.
fn tls_config() -> io::Result<rustls::ClientConfig> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(io::Error::other)?
        .with_platform_verifier()
        .map_err(io::Error::other)?
        .with_no_client_auth())
}

fn random_token() -> Result<String, PrivateError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| {
        eprintln!("private proxy: the OS random source failed; no session token was made");
        PrivateError::Unreachable
    })?;
    Ok(hex(&bytes))
}

/// The listener, its tokens and its records. `ProxyServer::start` owns the thread; dropping it
/// stops the listener and every stream still running on it.
pub(super) struct ProxyServer {
    state: Arc<ProxyState>,
    base_url: String,
    shutdown: std::sync::Mutex<Option<oneshot::Sender<()>>>,
    thread: std::sync::Mutex<Option<thread::JoinHandle<()>>>,
}

pub(super) struct ProxyState {
    /// `https://cloud-api.near.ai/v1` in the app; a test's local URL in tests.
    pub(super) upstream: String,
    pub(super) client: reqwest::Client,
    tokens: std::sync::Mutex<TokenTable>,
    pub(super) records: Arc<std::sync::Mutex<RecordStore>>,
    /// App sessions whose capped session key NEAR AI rejected; shared with `PrivateProxy` so the
    /// service can drop their records before the next launch.
    rejected: Arc<std::sync::Mutex<HashSet<String>>>,
    mcp: std::sync::Mutex<Option<Arc<McpState>>>,
}

impl ProxyState {
    pub(super) fn token(&self, raw: &str) -> Option<TokenEntry> {
        lock(&self.tokens).find(raw)
    }

    /// Records that NEAR AI refused this session's key. The proxy answer still passes through;
    /// the next launch drops the local cap record and makes a new Worker session.
    pub(super) fn reject_session(&self, app_session_id: &str) {
        lock(&self.rejected).insert(app_session_id.to_string());
    }

    pub(super) fn mcp(&self) -> Option<Arc<McpState>> {
        lock(&self.mcp).clone()
    }
}

impl ProxyServer {
    pub(super) fn start(
        upstream: &str,
        mcp: Option<Arc<McpState>>,
        rejected: Arc<std::sync::Mutex<HashSet<String>>>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .use_preconfigured_tls(tls_config()?)
            .build()
            .map_err(io::Error::other)?;
        let state = Arc::new(ProxyState {
            upstream: upstream.trim_end_matches('/').to_string(),
            client,
            tokens: std::sync::Mutex::new(TokenTable::default()),
            records: Arc::new(std::sync::Mutex::new(RecordStore::default())),
            rejected,
            mcp: std::sync::Mutex::new(mcp),
        });
        let (shutdown, mut stopped) = oneshot::channel();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let serve_state = Arc::clone(&state);
        let handle = thread::Builder::new()
            .name("zorvo-private-proxy".to_string())
            .spawn(move || {
                runtime.block_on(async move {
                    let listener = match TokioListener::from_std(listener) {
                        Ok(listener) => listener,
                        Err(_) => return,
                    };
                    loop {
                        tokio::select! {
                            _ = &mut stopped => break,
                            accepted = listener.accept() => match accepted {
                                Ok((stream, _)) => {
                                    let state = Arc::clone(&serve_state);
                                    tokio::spawn(async move {
                                        let service = service_fn(move |request| {
                                            let state = Arc::clone(&state);
                                            async move { Ok::<_, std::convert::Infallible>(handle(request, state).await) }
                                        });
                                        let _ = http1::Builder::new()
                                            .serve_connection(TokioIo::new(stream), service)
                                            .await;
                                    });
                                }
                                // One transient accept failure must not end the listener for the run.
                                Err(error) => {
                                    eprintln!("private proxy: accepting a connection failed ({:?}); retrying", error.kind());
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                }
                            }
                        }
                    }
                });
            })?;
        Ok(Self {
            state,
            base_url: format!("http://127.0.0.1:{port}/v1"),
            shutdown: std::sync::Mutex::new(Some(shutdown)),
            thread: std::sync::Mutex::new(Some(handle)),
        })
    }

    pub(super) fn base_url(&self) -> &str {
        &self.base_url
    }

    pub(super) fn set_mcp_state(&self, mcp: Arc<McpState>) {
        *lock(&self.state.mcp) = Some(mcp);
    }

    pub(super) fn issue(
        &self,
        app_session_id: &str,
        model: &str,
        key: &str,
        own_key: bool,
    ) -> Result<String, PrivateError> {
        lock(&self.state.tokens).issue(app_session_id, model, key, own_key)
    }

    pub(super) fn release(&self, app_session_id: &str) {
        lock(&self.state.tokens).release(app_session_id);
    }

    /// Adds `fork` as a holder of `source`'s token; false when the source has no token.
    pub(super) fn share(&self, source: &str, fork: &str) -> bool {
        lock(&self.state.tokens).share(source, fork)
    }

    /// Drops every own-key token and its records; a running own-key session stops working at once.
    pub(super) fn revoke_own_key(&self) {
        let revoked = lock(&self.state.tokens).revoke_own_key();
        let mut records = lock(&self.state.records);
        for token in revoked {
            records.remove(&token);
        }
    }

    /// The records of every token this session has held this run, oldest first.
    pub(super) fn records(&self, app_session_id: &str) -> Vec<super::ProxyRecord> {
        let tokens = lock(&self.state.tokens).tokens_of(app_session_id);
        let records = lock(&self.state.records);
        tokens
            .iter()
            .flat_map(|token| records.records(token))
            .collect()
    }

    /// The key behind a session's current or last token, for a billing read. It never leaves the
    /// backend or reaches an event.
    pub(super) fn key(&self, app_session_id: &str) -> Option<String> {
        lock(&self.state.tokens).key_of(app_session_id)
    }

    /// A deleted session leaves no lookup; its records go with every token no other session holds.
    pub(super) fn forget(&self, app_session_id: &str) {
        let tokens = lock(&self.state.tokens).forget(app_session_id);
        if !tokens.is_empty() {
            let mut records = lock(&self.state.records);
            for token in tokens {
                records.remove(&token);
            }
        }
    }
}

impl Drop for ProxyServer {
    fn drop(&mut self) {
        if let Some(shutdown) = lock(&self.shutdown).take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = lock(&self.thread).take() {
            let _ = handle.join();
        }
    }
}

async fn handle(request: Request<Incoming>, state: Arc<ProxyState>) -> Response<ProxyBody> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/v1/chat/completions") => forward::chat(request, state).await,
        (&Method::GET, "/v1/models") => forward::models(request, state).await,
        (&Method::GET, "/zorvo/v1/credits") => mcp_credits(request, state).await,
        (&Method::GET, "/zorvo/v1/models") => mcp_models(request, state),
        (&Method::POST, "/zorvo/v1/topup-requests") => mcp_topup_request(request, state).await,
        _ => forward::json_error(StatusCode::NOT_FOUND, "not found"),
    }
}

async fn mcp_credits(request: Request<Incoming>, state: Arc<ProxyState>) -> Response<ProxyBody> {
    let Some(entry) = forward::authorize(&request, &state) else {
        return forward::json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    if entry.own_key {
        return forward::json_ok(serde_json::json!({
            "ownKey": true,
            "message": "Paying with your own NEAR AI key. Its balance isn't visible to Zorvo, so plan as usual."
        }));
    }
    let Some(mcp) = state.mcp() else {
        return forward::json_error(StatusCode::SERVICE_UNAVAILABLE, "credits unavailable");
    };
    let model = entry.model;
    let answer = tokio::task::spawn_blocking(move || mcp.credits(&model)).await;
    match answer {
        Ok(Ok(answer)) => forward::json_ok(serde_json::json!(answer)),
        _ => forward::json_error(StatusCode::SERVICE_UNAVAILABLE, "credits unavailable"),
    }
}

fn mcp_models(request: Request<Incoming>, state: Arc<ProxyState>) -> Response<ProxyBody> {
    if forward::authorize(&request, &state).is_none() {
        return forward::json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Some(mcp) = state.mcp() else {
        return forward::json_error(StatusCode::SERVICE_UNAVAILABLE, "credits unavailable");
    };
    forward::json_ok(serde_json::json!({ "models": mcp.models() }))
}

/// An agent asks its user to approve a top-up. The package is checked against the Worker, the
/// request is recorded for the user, and nothing is sent to NEAR AI or charged here.
async fn mcp_topup_request(
    request: Request<Incoming>,
    state: Arc<ProxyState>,
) -> Response<ProxyBody> {
    let Some(entry) = forward::authorize(&request, &state) else {
        return forward::json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    let body = match Limited::new(request.into_body(), MAX_TOPUP_REQUEST_BYTES)
        .collect()
        .await
    {
        Ok(collected) => collected.to_bytes(),
        Err(_) => {
            return forward::json_error(StatusCode::PAYLOAD_TOO_LARGE, "request is too large")
        }
    };
    let parsed: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return forward::json_error(StatusCode::BAD_REQUEST, "bad request"),
    };
    let usd = parsed
        .get("usd")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    let reason = parsed
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let (Some(usd), Some(reason)) = (usd, reason) else {
        return forward::json_error(StatusCode::BAD_REQUEST, "usd and reason are required");
    };
    let Some(mcp) = state.mcp() else {
        return forward::json_error(StatusCode::SERVICE_UNAVAILABLE, "credits unavailable");
    };
    let answer = tokio::task::spawn_blocking(move || mcp.request_topup(&entry, usd, &reason)).await;
    match answer {
        Ok(Ok(event)) => forward::json_ok(serde_json::json!(event)),
        Ok(Err(refusal)) => topup_refusal(refusal),
        Err(_) => forward::json_error(StatusCode::BAD_GATEWAY, "top-up request failed"),
    }
}

/// The proxy route's refusal body: a stable code and the sentence the agent's tool shows.
fn topup_refusal(refusal: TopupRefusal) -> Response<ProxyBody> {
    let status = match refusal.code {
        "bad_request" => StatusCode::BAD_REQUEST,
        "cooldown" => StatusCode::TOO_MANY_REQUESTS,
        "upstream" => StatusCode::BAD_GATEWAY,
        _ => StatusCode::CONFLICT,
    };
    let body = serde_json::json!({ "error": refusal.code, "message": refusal.message }).to_string();
    let body = Full::new(Bytes::from(body))
        .map_err(|never| match never {})
        .boxed();
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .expect("a top-up refusal is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_thirty_two_random_bytes_as_hex() {
        let token = random_token().expect("token");
        assert_eq!(token.len(), 64);
        assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(token, random_token().expect("another token"));
    }

    #[test]
    fn token_comparison_is_length_and_byte_exact() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
    }

    #[test]
    fn issuing_a_new_token_for_a_session_retires_the_old_one() {
        let mut table = TokenTable::default();
        let first = table.issue("s1", "model", "key", false).expect("first");
        let second = table.issue("s1", "model", "key", false).expect("second");

        assert!(table.find(&first).is_none());
        assert_eq!(
            table.find(&second).map(|entry| entry.app_session_id),
            Some("s1".to_string())
        );
        table.release("s1");
        assert!(table.find(&second).is_none());
    }

    #[test]
    fn a_fork_holds_the_sources_token_until_both_stop() {
        let mut table = TokenTable::default();
        let token = table.issue("source", "model", "key", false).expect("token");
        assert!(table.share("source", "fork"));

        table.release("source");
        assert!(table.find(&token).is_some());
        assert_eq!(table.token_of("fork"), Some(token.clone()));

        table.release("fork");
        assert!(table.find(&token).is_none());
    }

    #[test]
    fn stopping_the_fork_first_leaves_the_source_working() {
        let mut table = TokenTable::default();
        let token = table.issue("source", "model", "key", false).expect("token");
        assert!(table.share("source", "fork"));

        table.release("fork");
        assert!(table.find(&token).is_some());
        assert_eq!(table.token_of("source"), Some(token));
    }

    #[test]
    fn sharing_from_a_plain_session_adds_nothing() {
        let mut table = TokenTable::default();
        assert!(!table.share("plain", "fork"));
        assert!(table.token_of("fork").is_none());
    }

    #[test]
    fn revoking_own_key_tokens_leaves_credits_tokens_and_drops_every_holder() {
        let mut table = TokenTable::default();
        let own = table
            .issue("own", "model", "own-key", true)
            .expect("own token");
        assert!(table.share("own", "own-fork"));
        let credits = table
            .issue("credits", "model", "credits-key", false)
            .expect("credits token");

        let revoked = table.revoke_own_key();

        assert_eq!(revoked, vec![own.clone()]);
        assert!(table.find(&own).is_none());
        assert!(table.token_of("own").is_none());
        assert!(table.token_of("own-fork").is_none());
        assert!(table.key_of("own").is_none());
        assert!(table.find(&credits).is_some());
        assert_eq!(table.key_of("credits").as_deref(), Some("credits-key"));
    }
}
