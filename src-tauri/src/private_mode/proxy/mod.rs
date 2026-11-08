//! A loopback proxy for private Qwen Code sessions (extension B, B-full).
//!
//! The agent never holds the NEAR AI key. Each private launch gets a fresh token and a URL on
//! `127.0.0.1`; the proxy adds the real key, forwards `/v1/chat/completions` and `/v1/models`
//! unchanged to NEAR AI, streams the answer back byte for byte, and keeps only the completion id
//! and the SHA-256 of the exact request and response bytes.
//!
//! Known limit: a fork lives in its source's agent process and keeps the source's token, so its
//! calls are recorded under the source's app session and are told apart by time, not by session.

mod forward;
pub mod mcp;
mod records;
mod server;

use std::sync::{Arc, Mutex};

use super::launch::NEAR_AI_BASE_URL;
use super::PrivateError;
pub use mcp::{McpState, SharedModels};
use records::lock;

pub use records::ProxyRecord;

/// A token for one private launch and the base URL the agent should use. The token is a
/// capability, not the NEAR AI key; it is dropped when its session stops.
#[derive(Clone, PartialEq, Eq)]
pub struct IssuedToken {
    pub token: String,
    pub base_url: String,
}

/// The app's one proxy listener, started on the first private launch and alive for the app run.
pub struct PrivateProxy {
    upstream: String,
    server: Mutex<Option<Arc<server::ProxyServer>>>,
    mcp: Mutex<Option<Arc<McpState>>>,
}

impl PrivateProxy {
    /// The app's proxy, forwarding to NEAR AI Cloud.
    pub fn new() -> Self {
        Self::with_upstream(NEAR_AI_BASE_URL)
    }

    /// Tests only: a proxy whose upstream is a local fake, never a URL the UI can set.
    #[doc(hidden)]
    pub fn with_upstream(upstream: impl Into<String>) -> Self {
        Self {
            upstream: upstream.into(),
            server: Mutex::new(None),
            mcp: Mutex::new(None),
        }
    }

    /// Gives the loopback listener the read-only MCP view. Set once when private mode is built,
    /// before the first private launch starts the listener.
    pub(crate) fn set_mcp_state(&self, mcp: Arc<McpState>) {
        *lock(&self.mcp) = Some(Arc::clone(&mcp));
        if let Some(server) = lock(&self.server).as_ref() {
            server.set_mcp_state(mcp);
        }
    }

    /// Tests only: a proxy with its MCP view already attached.
    #[doc(hidden)]
    pub fn with_mcp_state(upstream: impl Into<String>, mcp: Arc<McpState>) -> Self {
        let proxy = Self::with_upstream(upstream);
        proxy.set_mcp_state(mcp);
        proxy
    }

    fn server(&self) -> Result<Arc<server::ProxyServer>, PrivateError> {
        let mut slot = lock(&self.server);
        if let Some(server) = slot.as_ref() {
            return Ok(Arc::clone(server));
        }
        let started = Arc::new(
            server::ProxyServer::start(&self.upstream, lock(&self.mcp).clone()).map_err(
                |error| {
                    eprintln!("private proxy: could not listen on 127.0.0.1 ({error})");
                    PrivateError::Unreachable
                },
            )?,
        );
        *slot = Some(Arc::clone(&started));
        Ok(started)
    }

    /// A fresh token for `app_session_id`, replacing any token that session had, and the URL the
    /// agent's `OPENAI_BASE_URL` should name.
    pub fn issue(
        &self,
        app_session_id: &str,
        model: &str,
        key: &str,
    ) -> Result<IssuedToken, PrivateError> {
        let server = self.server()?;
        let token = server.issue(app_session_id, model, key)?;
        Ok(IssuedToken {
            token,
            base_url: server.base_url().to_string(),
        })
    }

    /// Drops one holder of a token; the token goes only when its agent process has no session left.
    pub fn release(&self, app_session_id: &str) {
        if let Some(server) = lock(&self.server).as_ref() {
            server.release(app_session_id);
        }
    }

    /// Makes `fork` a holder of `source`'s token, so the fork keeps working when its source stops.
    /// Returns false when the source has no token (it ran plain).
    pub fn share(&self, source: &str, fork: &str) -> bool {
        lock(&self.server)
            .as_ref()
            .is_some_and(|server| server.share(source, fork))
    }

    /// The completed calls of `app_session_id`, oldest first. A stopped session keeps its last token's
    /// records for verification; a deleted one calls [`Self::forget`].
    pub fn records(&self, app_session_id: &str) -> Vec<ProxyRecord> {
        lock(&self.server)
            .as_ref()
            .map(|server| server.records(app_session_id))
            .unwrap_or_default()
    }

    /// A deleted session: no more record lookups, and its records go with its process's last token.
    pub fn forget(&self, app_session_id: &str) {
        if let Some(server) = lock(&self.server).as_ref() {
            server.forget(app_session_id);
        }
    }

    /// Starts the listener if it has not started yet and returns its base URL.
    pub fn base_url(&self) -> Result<String, PrivateError> {
        Ok(self.server()?.base_url().to_string())
    }
}

impl Default for PrivateProxy {
    fn default() -> Self {
        Self::new()
    }
}
