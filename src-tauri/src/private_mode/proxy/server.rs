//! The loopback listener private agents talk to. One listener per app run, bound to 127.0.0.1:0,
//! with one live token per private agent process; a native fork shares its source's token.

use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use http_body_util::combinators::BoxBody;
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rustls_platform_verifier::BuilderVerifierExt;
use tokio::net::TcpListener as TokioListener;
use tokio::sync::oneshot;

use super::forward;
use super::records::{hex, lock, RecordStore};
use crate::private_mode::PrivateError;

/// A connect that takes longer than this fails the request.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// A stream that sends nothing for this long is treated as dead. There is no total timeout.
const READ_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(super) type ProxyBody = BoxBody<Bytes, io::Error>;

/// What the agent process is allowed to spend: the real key stays here, never in the agent's
/// process. A native fork shares its source's process, so it is a second holder of the same token.
#[derive(Clone)]
pub(super) struct TokenEntry {
    pub(super) token: String,
    pub(super) app_session_id: String,
    pub(super) model: String,
    pub(super) key: String,
    holders: HashSet<String>,
}

#[derive(Default)]
struct TokenTable {
    by_token: HashMap<String, TokenEntry>,
    by_session: HashMap<String, String>,
}

impl TokenTable {
    fn issue(
        &mut self,
        app_session_id: &str,
        model: &str,
        key: &str,
    ) -> Result<String, PrivateError> {
        // Made before the old token is detached, so a random-source failure leaves the session as
        // it was.
        let token = random_token()?;
        self.detach(app_session_id);
        self.by_session
            .insert(app_session_id.to_string(), token.clone());
        self.by_token.insert(
            token.clone(),
            TokenEntry {
                token: token.clone(),
                app_session_id: app_session_id.to_string(),
                model: model.to_string(),
                key: key.to_string(),
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
        entry.holders.insert(fork.to_string());
        self.by_session.insert(fork.to_string(), token);
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
        self.by_session.get(app_session_id).cloned()
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
}

impl ProxyState {
    pub(super) fn token(&self, raw: &str) -> Option<TokenEntry> {
        lock(&self.tokens).find(raw)
    }
}

impl ProxyServer {
    pub(super) fn start(upstream: &str) -> io::Result<Self> {
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

    pub(super) fn issue(
        &self,
        app_session_id: &str,
        model: &str,
        key: &str,
    ) -> Result<String, PrivateError> {
        lock(&self.state.tokens).issue(app_session_id, model, key)
    }

    pub(super) fn release(&self, app_session_id: &str) {
        lock(&self.state.tokens).release(app_session_id);
    }

    /// Adds `fork` as a holder of `source`'s token; false when the source has no token.
    pub(super) fn share(&self, source: &str, fork: &str) -> bool {
        lock(&self.state.tokens).share(source, fork)
    }

    /// The records of the token this session holds, whether it owns it or forked it.
    pub(super) fn records(&self, app_session_id: &str) -> Vec<super::ProxyRecord> {
        let Some(token) = lock(&self.state.tokens).token_of(app_session_id) else {
            return Vec::new();
        };
        lock(&self.state.records).records(&token)
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
        _ => forward::json_error(StatusCode::NOT_FOUND, "not found"),
    }
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
        let first = table.issue("s1", "model", "key").expect("first");
        let second = table.issue("s1", "model", "key").expect("second");

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
        let token = table.issue("source", "model", "key").expect("token");
        assert!(table.share("source", "fork"));

        table.release("source");
        assert!(table.find(&token).is_some());
        assert_eq!(table.token_of("fork"), Some(token.clone()));

        table.release("fork");
        assert!(table.find(&token).is_none());
        assert!(table.token_of("source").is_none());
        assert!(table.token_of("fork").is_none());
    }

    #[test]
    fn stopping_the_fork_first_leaves_the_source_working() {
        let mut table = TokenTable::default();
        let token = table.issue("source", "model", "key").expect("token");
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
}
