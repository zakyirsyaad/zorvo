//! The Zorvo Private loopback proxy, run against a raw local fake upstream: exact request bytes,
//! incremental SSE, hashes and records, auth/model/path refusals, pass-through errors and a cut
//! stream. The upstream URL is a test constructor argument, never a UI value.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use zorvo_lib::private_mode::client::{
    Balance, CreatedSession, CreatedTopup, CreditsApi, ModelPrice, PromoResult, Stock, TopupState,
};
use zorvo_lib::private_mode::device::{SecretStore, DEVICE_SECRET};
use zorvo_lib::private_mode::proxy::{McpState, PrivateProxy, TokenUsage};
use zorvo_lib::private_mode::PrivateError;

const MODEL: &str = "Qwen/Qwen3.8-27B";
const KEY: &str = "sk-real-key";
const SESSION: &str = "app-session-1";

#[derive(Clone)]
struct Recorded {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Recorded {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

struct FakeUpstream {
    addr: SocketAddr,
    requests: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl FakeUpstream {
    fn start(handler: impl Fn(Recorded, &mut TcpStream) + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind the fake upstream");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let addr = listener.local_addr().expect("fake upstream address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Arc::new(AtomicBool::new(false));
        let handler = Arc::new(handler);
        let seen = Arc::clone(&requests);
        let stop = Arc::clone(&shutdown);
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let seen = Arc::clone(&seen);
                        let handler = Arc::clone(&handler);
                        thread::spawn(move || {
                            if let Some(request) = read_request(&mut stream) {
                                seen.lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                                    .push(request.clone());
                                handler(request, &mut stream);
                            }
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            addr,
            requests,
            shutdown,
            thread: Some(thread),
        }
    }

    fn base(&self) -> String {
        format!("http://{}/v1", self.addr)
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl Drop for FakeUpstream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).ok()? == 0 {
            return None;
        }
        head.push(byte[0]);
        if head.len() > 64 * 1024 {
            return None;
        }
    }
    let text = String::from_utf8_lossy(&head);
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    if length > 0 {
        stream.read_exact(&mut body).ok()?;
    }
    Some(Recorded {
        method,
        path,
        headers,
        body,
    })
}

fn respond_with_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\n"
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    write!(
        stream,
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .unwrap();
    stream.write_all(body).unwrap();
    stream.flush().unwrap();
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    respond_with_headers(stream, status, content_type, &[], body);
}

fn sse_head_with_headers(stream: &mut TcpStream, headers: &[(&str, &str)]) {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n"
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    write!(stream, "Connection: close\r\n\r\n").unwrap();
    stream.flush().unwrap();
}

fn sse_head(stream: &mut TcpStream) {
    sse_head_with_headers(stream, &[]);
}

fn chunk(stream: &mut TcpStream, bytes: &[u8]) {
    write!(stream, "{:X}\r\n", bytes.len()).unwrap();
    stream.write_all(bytes).unwrap();
    stream.write_all(b"\r\n").unwrap();
    stream.flush().unwrap();
}

fn end_chunks(stream: &mut TcpStream) {
    stream.write_all(b"0\r\n\r\n").unwrap();
    stream.flush().unwrap();
}

fn client() -> reqwest::Client {
    // reqwest is built with `rustls-no-provider`; the test client needs one for its own TLS
    // stack, while the proxy passes its own ring-based config through `use_preconfigured_tls`.
    static PROVIDER: std::sync::Once = std::sync::Once::new();
    PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("test HTTP client")
}

fn issue(proxy: &PrivateProxy) -> (String, String) {
    let issued = proxy
        .issue(SESSION, MODEL, KEY, false)
        .expect("a proxy token");
    (issued.token, issued.base_url)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(text, "{byte:02x}");
    }
    text
}

async fn chat_response(base: &str, token: &str, body: Vec<u8>) -> reqwest::Response {
    client()
        .post(format!("{base}/chat/completions"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .header("x-client-only", "not forwarded")
        .body(body)
        .send()
        .await
        .expect("the proxy answers")
}

#[tokio::test]
async fn forwards_the_exact_request_bytes_and_records_both_hashes() {
    let reply = br#"{"id":"chat-1","object":"chat.completion","choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", reply);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);
    let request = b" {\n  \"model\" : \"Qwen/Qwen3.8-27B\",\n  \"messages\" : []\n} ";

    let response = chat_response(&base, &token, request.to_vec()).await;
    assert_eq!(response.status(), 200);
    let body = response.bytes().await.expect("the full answer");

    let seen = fake.requests();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].path, "/v1/chat/completions");
    assert_eq!(seen[0].body, request);
    assert_eq!(seen[0].header("authorization"), Some("Bearer sk-real-key"));
    assert_eq!(seen[0].header("accept-encoding"), Some("identity"));
    assert_eq!(seen[0].header("x-no-aliasing"), Some("true"));
    assert_eq!(seen[0].header("content-type"), Some("application/json"));
    assert_eq!(seen[0].header("x-client-only"), None);

    let records = proxy.records(SESSION);
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.chat_id.as_deref(), Some("chat-1"));
    assert_eq!(record.model, MODEL);
    assert_eq!(record.app_session_id, SESSION);
    assert_eq!(record.request_sha256, sha256_hex(request));
    assert_eq!(record.response_sha256, sha256_hex(&body));
    assert!(record.signed);
    assert!(record.started <= record.ended);
}

#[tokio::test]
async fn keeps_the_inference_id_and_usage_from_a_plain_response() {
    let inference = "123e4567-e89b-12d3-a456-426614174000";
    let reply =
        br#"{"id":"chat-plain","usage":{"prompt_tokens":10,"completion_tokens":20},"choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond_with_headers(
            stream,
            "200 OK",
            "application/json",
            &[("inference-id", inference)],
            reply,
        );
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 200);
    response.bytes().await.expect("the answer");

    let records = proxy.records(SESSION);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].inference_id.as_deref(), Some(inference));
    assert_eq!(
        records[0].usage,
        Some(TokenUsage {
            prompt_tokens: 10,
            completion_tokens: 20,
        })
    );
    assert_eq!(proxy.key(SESSION).as_deref(), Some(KEY));
}

#[tokio::test]
async fn keeps_the_last_usage_from_a_streamed_response() {
    let inference = "123e4567-e89b-12d3-a456-426614174000";
    let fake = FakeUpstream::start(move |_request, stream| {
        sse_head_with_headers(stream, &[("inference-id", inference)]);
        chunk(
            stream,
            b"data: {\"id\":\"chat-stream-usage\",\"choices\":[]}\n\n",
        );
        chunk(
            stream,
            b"data: {\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":22}}\n\n",
        );
        chunk(stream, b"data: [DONE]\n\n");
        end_chunks(stream);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[],"stream":true}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 200);
    response.bytes().await.expect("the stream");

    let records = proxy.records(SESSION);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].inference_id.as_deref(), Some(inference));
    assert_eq!(
        records[0].usage,
        Some(TokenUsage {
            prompt_tokens: 11,
            completion_tokens: 22,
        })
    );
}

#[tokio::test]
async fn streams_sse_chunks_before_the_upstream_finishes() {
    let (release, released) = mpsc::channel::<()>();
    let released = Arc::new(Mutex::new(released));
    let fake = FakeUpstream::start(move |_request, stream| {
        sse_head(stream);
        chunk(stream, b"data: {\"id\":\"chat-stream\",\"choices\":[]}\n\n");
        let _ = released
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(5));
        chunk(stream, b"data: {\"choices\":[]}\n\n");
        chunk(stream, b"data: [DONE]\n\n");
        end_chunks(stream);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[],"stream":true}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 200);
    let mut stream = response.bytes_stream();
    let mut seen = Vec::new();
    while !String::from_utf8_lossy(&seen).contains("chat-stream") {
        let next = tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("the first SSE chunk arrives while upstream waits")
            .expect("a chunk")
            .expect("a readable chunk");
        seen.extend_from_slice(&next);
    }
    assert!(
        !String::from_utf8_lossy(&seen).contains("[DONE]"),
        "the proxy must not wait for the upstream to finish"
    );
    release.send(()).expect("release the fake upstream");
    while let Some(next) = stream.next().await {
        seen.extend_from_slice(&next.expect("the rest of the stream"));
    }
    assert!(String::from_utf8_lossy(&seen).contains("[DONE]"));

    let records = proxy.records(SESSION);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].chat_id.as_deref(), Some("chat-stream"));
    assert!(records[0].signed);
}

#[tokio::test]
async fn a_fork_keeps_working_and_shares_records_when_the_source_stops() {
    let reply = br#"{"id":"chat-shared","object":"chat.completion","choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", reply);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);
    let fork = "app-session-fork";
    assert!(proxy.share(SESSION, fork));

    let first = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(first.status(), 200);
    first.bytes().await.expect("the source's answer");

    proxy.release(SESSION);
    let second = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(second.status(), 200);
    second.bytes().await.expect("the fork's answer");

    let records = proxy.records(fork);
    assert_eq!(records.len(), 2, "the fork sees the process's calls");
    assert_eq!(
        proxy.records(SESSION).len(),
        2,
        "a stopped source keeps its last token's records"
    );

    proxy.release(fork);
    let after = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(after.status(), 401, "the last holder dropped the token");
}

#[tokio::test]
async fn removing_the_own_key_revokes_its_tokens_but_not_credits_tokens() {
    let reply = br#"{"id":"chat-key","object":"chat.completion","choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", reply);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let own = proxy
        .issue(SESSION, MODEL, "own-key", true)
        .expect("own token");
    let credits = proxy
        .issue("app-session-credits", MODEL, KEY, false)
        .expect("credits token");
    let body = br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec();

    proxy.revoke_own_key();

    assert_eq!(
        chat_response(&own.base_url, &own.token, body.clone())
            .await
            .status(),
        401,
        "the removed key's token stops working"
    );
    assert_eq!(
        chat_response(&credits.base_url, &credits.token, body)
            .await
            .status(),
        200,
        "a Zorvo credits token is untouched"
    );
}

#[tokio::test]
async fn a_reopen_keeps_the_sessions_earlier_records() {
    let reply = br#"{"id":"chat-reopen","object":"chat.completion","choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", reply);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let first = proxy
        .issue(SESSION, MODEL, KEY, false)
        .expect("first token");
    let body = br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec();
    let answer = chat_response(&first.base_url, &first.token, body.clone()).await;
    assert_eq!(answer.status(), 200);
    answer.bytes().await.expect("the first answer");

    let second = proxy
        .issue(SESSION, MODEL, KEY, false)
        .expect("reopened token");
    let answer = chat_response(&second.base_url, &second.token, body).await;
    assert_eq!(answer.status(), 200);
    answer.bytes().await.expect("the reopened answer");

    assert_eq!(
        proxy.records(SESSION).len(),
        2,
        "a reopen keeps the earlier token's records"
    );
    assert_ne!(first.token, second.token);
}

#[tokio::test]
async fn a_stopped_session_keeps_its_last_tokens_records_until_forgotten() {
    let reply = br#"{"id":"chat-last","object":"chat.completion","choices":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", reply);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 200);
    response.bytes().await.expect("the answer");

    proxy.release(SESSION);
    assert_eq!(
        proxy.records(SESSION).len(),
        1,
        "a turn that ended after Stop must still verify"
    );

    proxy.forget(SESSION);
    assert!(proxy.records(SESSION).is_empty());
}

#[tokio::test]
async fn sharing_from_a_plain_session_adds_nothing() {
    let proxy = PrivateProxy::with_upstream("http://127.0.0.1:1/v1");

    assert!(!proxy.share("plain-source", "plain-fork"));
    assert!(proxy.records("plain-fork").is_empty());
}

#[tokio::test]
async fn answers_502_json_when_near_ai_is_unreachable() {
    let proxy = PrivateProxy::with_upstream("http://127.0.0.1:1/v1");
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 502);
    let body: serde_json::Value = response.json().await.expect("the error body");
    assert_eq!(
        body,
        serde_json::json!({ "error": { "message": "NEAR AI is unreachable" } })
    );
    assert!(proxy.records(SESSION).is_empty());
}

#[tokio::test]
async fn refuses_a_missing_unknown_or_released_token_without_forwarding() {
    let fake = FakeUpstream::start(|_request, stream| {
        respond(stream, "200 OK", "application/json", b"{}");
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);
    let body = br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec();

    let missing = client()
        .post(format!("{base}/chat/completions"))
        .body(body.clone())
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(missing.status(), 401);

    let wrong = chat_response(&base, "not-a-token", body.clone()).await;
    assert_eq!(wrong.status(), 401);
    assert!(fake.requests().is_empty(), "nothing may be forwarded");

    proxy.release(SESSION);
    let released = chat_response(&base, &token, body).await;
    assert_eq!(released.status(), 401);
    assert!(fake.requests().is_empty());
}

#[tokio::test]
async fn refuses_another_model_and_other_paths_without_forwarding() {
    let fake = FakeUpstream::start(|_request, stream| {
        respond(stream, "200 OK", "application/json", b"{}");
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let wrong_model = chat_response(
        &base,
        &token,
        br#"{"model":"Other/Model-1","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(wrong_model.status(), 400);

    let other_path = client()
        .get(format!("{base}/completions"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(other_path.status(), 404);
    assert!(fake.requests().is_empty());
}

#[tokio::test]
async fn passes_a_402_through_unchanged_and_records_nothing() {
    let body = br#"{"error":"payment required"}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "402 Payment Required", "application/json", body);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 402);
    assert_eq!(
        response.bytes().await.expect("the upstream body"),
        &body[..]
    );
    assert!(proxy.records(SESSION).is_empty());
}

#[tokio::test]
async fn a_stream_cut_mid_way_leaves_a_not_signed_record() {
    let fake = FakeUpstream::start(|_request, stream| {
        sse_head(stream);
        chunk(stream, b"data: {\"id\":\"chat-cut\",\"choices\":[]}\n\n");
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = chat_response(
        &base,
        &token,
        br#"{"model":"Qwen/Qwen3.8-27B","messages":[]}"#.to_vec(),
    )
    .await;
    assert_eq!(response.status(), 200);
    let mut stream = response.bytes_stream();
    let mut seen = Vec::new();
    while let Some(next) = stream.next().await {
        match next {
            Ok(bytes) => seen.extend_from_slice(&bytes),
            Err(_) => break,
        }
    }
    assert!(String::from_utf8_lossy(&seen).contains("chat-cut"));

    let records = proxy.records(SESSION);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].chat_id.as_deref(), Some("chat-cut"));
    assert!(!records[0].signed);
}

#[tokio::test]
async fn forwards_models_without_recording_a_completion() {
    let answer = br#"{"data":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", answer);
    });
    let proxy = PrivateProxy::with_upstream(fake.base());
    let (token, base) = issue(&proxy);

    let response = client()
        .get(format!("{base}/models"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(response.status(), 200);
    assert_eq!(response.bytes().await.expect("the model list"), &answer[..]);
    let seen = fake.requests();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].path, "/v1/models");
    assert_eq!(seen[0].header("authorization"), Some("Bearer sk-real-key"));
    assert!(proxy.records(SESSION).is_empty());
}

struct McpStore;

impl SecretStore for McpStore {
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
        Ok((account == DEVICE_SECRET).then(|| "device".to_string()))
    }
    fn set(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), PrivateError> {
        Ok(())
    }
}

struct McpApi {
    reads: AtomicUsize,
}

impl CreditsApi for McpApi {
    fn register(&self, _: &str) -> Result<(), PrivateError> {
        Ok(())
    }
    fn balance(&self, _: &str, _: bool) -> Result<Balance, PrivateError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(Balance {
            credits: 49,
            used_credits: 0,
            key_ready: true,
            updated_at: "2026-11-08T10:00:00Z".to_string(),
        })
    }
    fn stock(&self, _: &str) -> Result<Stock, PrivateError> {
        unimplemented!()
    }
    fn models(&self, _: &str) -> Result<Vec<ModelPrice>, PrivateError> {
        unimplemented!()
    }
    fn create_topup(&self, _: &str, _: u32) -> Result<CreatedTopup, PrivateError> {
        unimplemented!()
    }
    fn topup(&self, _: &str, _: &str) -> Result<TopupState, PrivateError> {
        unimplemented!()
    }
    fn cancel_topup(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        unimplemented!()
    }
    fn take_key(&self, _: &str) -> Result<Option<String>, PrivateError> {
        unimplemented!()
    }
    fn redeem_promo(&self, _: &str, _: &str) -> Result<PromoResult, PrivateError> {
        unimplemented!()
    }
    fn recover(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        unimplemented!()
    }
    fn create_session(&self, _: &str, _: u64) -> Result<CreatedSession, PrivateError> {
        unimplemented!()
    }
    fn end_session(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        unimplemented!()
    }
    fn seen_session(&self, _: &str, _: &str) -> Result<(), PrivateError> {
        unimplemented!()
    }
    fn raise_session(&self, _: &str, _: &str, _: u64) -> Result<u64, PrivateError> {
        unimplemented!()
    }
}

#[tokio::test]
async fn the_credits_route_says_an_own_key_balance_is_not_visible() {
    let proxy = PrivateProxy::with_upstream("http://127.0.0.1:1/v1");
    let issued = proxy
        .issue(SESSION, MODEL, "own-key-3f9a", true)
        .expect("a proxy token");
    let root = issued.base_url.strip_suffix("/v1").expect("the proxy base");

    let answer = client()
        .get(format!("{root}/zorvo/v1/credits"))
        .bearer_auth(&issued.token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(answer.status(), 200);
    let answer: serde_json::Value = answer.json().await.expect("credits JSON");
    assert_eq!(answer["ownKey"], true);
    assert_eq!(
        answer["message"],
        "Paying with your own NEAR AI key. Its balance isn't visible to Zorvo, so plan as usual."
    );
}

#[tokio::test]
async fn mcp_routes_need_the_proxy_token_and_never_reach_upstream() {
    let answer = br#"{"data":[]}"#;
    let fake = FakeUpstream::start(move |_request, stream| {
        respond(stream, "200 OK", "application/json", answer);
    });
    let api = Arc::new(McpApi {
        reads: AtomicUsize::new(0),
    });
    let models = Arc::new(Mutex::new(Some((
        Instant::now(),
        vec![ModelPrice {
            id: MODEL.to_string(),
            input_per_m: 0.0,
            output_per_m: 100.0,
        }],
    ))));
    let mcp = Arc::new(McpState::new(Arc::new(McpStore), api.clone(), models));
    let proxy = PrivateProxy::with_mcp_state(fake.base(), mcp);
    let (token, base) = issue(&proxy);
    let root = base.strip_suffix("/v1").expect("the proxy base");

    let unauthorized = client()
        .get(format!("{root}/zorvo/v1/credits"))
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(unauthorized.status(), 401);
    let unauthorized = client()
        .get(format!("{root}/zorvo/v1/models"))
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(unauthorized.status(), 401);

    let credits = client()
        .get(format!("{root}/zorvo/v1/credits"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(credits.status(), 200);
    let credits: serde_json::Value = credits.json().await.expect("credits JSON");
    assert_eq!(credits["credits"], 49);
    assert_eq!(credits["model"], MODEL);
    assert_eq!(credits["approxTurns"], 4);
    assert_eq!(credits["updatedAt"], "2026-11-08T10:00:00Z");

    // The same answer comes from the cache, not a second Worker read.
    let cached = client()
        .get(format!("{root}/zorvo/v1/credits"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(cached.status(), 200);
    assert_eq!(api.reads.load(Ordering::SeqCst), 1);

    let models = client()
        .get(format!("{root}/zorvo/v1/models"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("the proxy answers");
    assert_eq!(models.status(), 200);
    let models: serde_json::Value = models.json().await.expect("models JSON");
    assert_eq!(models["models"][0]["label"], "Qwen 3.8 27B");
    assert_eq!(models["models"][0]["approxCreditsPerTurn"], 12.0);
    assert!(fake.requests().is_empty(), "the MCP routes are local");
    assert!(proxy.records(SESSION).is_empty());
}
