//! Forwarding one private call: check the token and model, send the exact bytes upstream with the
//! real key, and stream the answer back while hashing both sides.

use std::io;
use std::sync::Arc;

use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, Limited, StreamBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::header::{ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE};
use hyper::http::HeaderValue;
use hyper::{Request, Response, StatusCode};
use serde_json::Value;
use tokio::sync::mpsc;

use super::records::{now_ms, sanitize_inference_id, sha256_hex, RecordBuilder};
use super::server::{ProxyBody, ProxyState, TokenEntry};

/// The most one agent request may carry. Qwen's requests are far smaller; a larger body is refused
/// before anything is forwarded or hashed.
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;

/// The JSON body every error answer carries, so Qwen Code can show its message.
pub(super) fn json_error(status: StatusCode, message: &str) -> Response<ProxyBody> {
    json(serde_json::json!({ "error": { "message": message } })).with_status(status)
}

pub(super) fn json_ok(value: serde_json::Value) -> Response<ProxyBody> {
    json(value)
}

fn json(value: serde_json::Value) -> Response<ProxyBody> {
    let body = value.to_string();
    let body = Full::new(Bytes::from(body))
        .map_err(|never| match never {})
        .boxed();
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .expect("a JSON response is valid")
}

trait WithStatus {
    fn with_status(self, status: StatusCode) -> Self;
}

impl WithStatus for Response<ProxyBody> {
    fn with_status(mut self, status: StatusCode) -> Self {
        *self.status_mut() = status;
        self
    }
}

pub(super) fn authorize(request: &Request<Incoming>, state: &ProxyState) -> Option<TokenEntry> {
    let value = request.headers().get(AUTHORIZATION)?.to_str().ok()?;
    state.token(value.strip_prefix("Bearer ")?)
}

pub(super) async fn chat(
    request: Request<Incoming>,
    state: Arc<ProxyState>,
) -> Response<ProxyBody> {
    let Some(entry) = authorize(&request, &state) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    let (parts, body) = request.into_parts();
    let request_bytes = match Limited::new(body, MAX_REQUEST_BYTES).collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => {
            return json_error(StatusCode::PAYLOAD_TOO_LARGE, "request is too large");
        }
    };
    let parsed: Value = match serde_json::from_slice(&request_bytes) {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad request"),
    };
    if parsed.get("model").and_then(Value::as_str) != Some(entry.model.as_str()) {
        return json_error(
            StatusCode::BAD_REQUEST,
            "the model does not belong to this session",
        );
    }

    let request_sha256 = sha256_hex(&request_bytes);
    let started = now_ms();
    let mut builder = state
        .client
        .post(format!("{}/chat/completions", state.upstream))
        .body(request_bytes)
        .bearer_auth(&entry.key)
        .header(ACCEPT_ENCODING, "identity")
        .header("x-no-aliasing", "true");
    if let Some(content_type) = parts.headers.get(CONTENT_TYPE) {
        builder = builder.header(CONTENT_TYPE, content_type);
    }
    let upstream = match builder.send().await {
        Ok(upstream) => upstream,
        Err(_) => {
            eprintln!("private proxy: POST /v1/chat/completions could not reach NEAR AI");
            return json_error(StatusCode::BAD_GATEWAY, "NEAR AI is unreachable");
        }
    };
    let status = upstream.status();
    if status == StatusCode::UNAUTHORIZED && !entry.own_key {
        // The Worker revoked a capped session's key (usually the 24 h sweep). The agent still
        // sees NEAR AI's answer; the next launch drops the record and makes a new Worker session.
        state.reject_session(&entry.app_session_id);
        eprintln!(
            "private proxy: NEAR AI refused this session's key; the next launch will make a new one"
        );
    }
    let content_type = upstream.headers().get(CONTENT_TYPE).cloned();
    let inference_id = upstream
        .headers()
        .get("inference-id")
        .and_then(|value| value.to_str().ok())
        .and_then(sanitize_inference_id);
    let record = status.is_success().then(|| {
        RecordBuilder::new(
            &entry.token,
            &entry.app_session_id,
            inference_id,
            &entry.model,
            request_sha256,
            started,
            Arc::clone(&state.records),
        )
    });
    stream_response(upstream, status, content_type, record)
}

pub(super) async fn models(
    request: Request<Incoming>,
    state: Arc<ProxyState>,
) -> Response<ProxyBody> {
    let Some(entry) = authorize(&request, &state) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    let upstream = match state
        .client
        .get(format!("{}/models", state.upstream))
        .bearer_auth(&entry.key)
        .header(ACCEPT_ENCODING, "identity")
        .header("x-no-aliasing", "true")
        .send()
        .await
    {
        Ok(upstream) => upstream,
        Err(_) => {
            eprintln!("private proxy: GET /v1/models could not reach NEAR AI");
            return json_error(StatusCode::BAD_GATEWAY, "NEAR AI is unreachable");
        }
    };
    let status = upstream.status();
    if status == StatusCode::UNAUTHORIZED && !entry.own_key {
        state.reject_session(&entry.app_session_id);
        eprintln!(
            "private proxy: NEAR AI refused this session's key; the next launch will make a new one"
        );
    }
    let content_type = upstream.headers().get(CONTENT_TYPE).cloned();
    stream_response(upstream, status, content_type, None)
}

/// Streams `upstream` back chunk by chunk. The spawned task hashes and sniffs each chunk before
/// passing it on; the body is never collected whole. A dropped client, an upstream error or a
/// runtime shutdown drops the builder, which records the call as not signed.
fn stream_response(
    upstream: reqwest::Response,
    status: StatusCode,
    content_type: Option<HeaderValue>,
    mut record: Option<RecordBuilder>,
) -> Response<ProxyBody> {
    let (sender, receiver) = mpsc::channel::<Result<Frame<Bytes>, io::Error>>(1);
    tokio::spawn(async move {
        let mut body = upstream.bytes_stream();
        let mut complete = true;
        while let Some(chunk) = body.next().await {
            match chunk {
                Ok(bytes) => {
                    if let Some(record) = record.as_mut() {
                        record.observe(&bytes);
                    }
                    if sender.send(Ok(Frame::data(bytes))).await.is_err() {
                        complete = false;
                        break;
                    }
                }
                Err(_) => {
                    complete = false;
                    break;
                }
            }
        }
        if let Some(record) = record.as_mut() {
            record.finish(complete);
        }
    });

    let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|item| (item, receiver))
    });
    let body = BodyExt::boxed(StreamBody::new(stream));
    let mut response = Response::builder().status(status);
    if let Some(content_type) = content_type {
        response = response.header(CONTENT_TYPE, content_type);
    }
    response
        .body(body)
        .unwrap_or_else(|_| json_error(StatusCode::BAD_GATEWAY, "NEAR AI is unreachable"))
}
