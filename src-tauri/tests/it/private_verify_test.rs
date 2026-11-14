//! The private verifier against a raw local signature/attestation server: provider TEE and gateway
//! signatures, text and signer mismatches, a signer missing from the report, 404 retries and an
//! unreachable endpoint. The upstream base is a test constructor argument, never a UI value.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use k256::ecdsa::SigningKey;
use serde_json::json;
use sha3::{Digest, Keccak256};
use zorvo_lib::private_mode::proxy::ProxyRecord;
use zorvo_lib::private_mode::verify::{PrivateVerifier, SignatureKind, VerificationState};

const MODEL: &str = "Qwen/Qwen3.8-27B";
const KEY: &str = "sk-real-key";
const REQUEST_SHA: &str = "11";
const RESPONSE_SHA: &str = "22";

#[derive(Clone)]
struct Recorded {
    path: String,
    query: String,
}

struct FakeServer {
    addr: SocketAddr,
    requests: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl FakeServer {
    fn start(handler: impl Fn(Recorded, &mut TcpStream) + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind the fake verifier");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let addr = listener.local_addr().expect("fake verifier address");
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
            .iter()
            .map(|request| Recorded {
                path: request.path.clone(),
                query: request.query.clone(),
            })
            .collect()
    }
}

impl Drop for FakeServer {
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
    let mut request_line = text.lines().next()?.split_whitespace();
    let _method = request_line.next()?;
    let target = request_line.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    Some(Recorded {
        path: path.to_string(),
        query: query.to_string(),
    })
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    stream.flush().unwrap();
}

fn signing_key() -> SigningKey {
    SigningKey::from_slice(&[9u8; 32]).expect("a valid scalar")
}

fn address_of(key: &SigningKey) -> String {
    let point = key.verifying_key().to_sec1_point(false);
    let digest = Keccak256::digest(&point.as_bytes()[1..]);
    format!("0x{}", hex(&digest[12..]))
}

fn sign(text: &str) -> String {
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let digest = Keccak256::digest(prefixed.as_bytes());
    let (signature, recovery) = signing_key().sign_prehash_recoverable(&digest);
    let mut bytes = signature.to_bytes().to_vec();
    bytes.push(recovery.to_byte());
    hex(&bytes)
}

fn record(id: &str) -> ProxyRecord {
    ProxyRecord {
        chat_id: Some(id.to_string()),
        inference_id: None,
        usage: None,
        model: MODEL.to_string(),
        request_sha256: REQUEST_SHA.to_string(),
        response_sha256: RESPONSE_SHA.to_string(),
        started: 1,
        ended: 2,
        app_session_id: "app-session-1".to_string(),
        signed: true,
    }
}

fn provider_text() -> String {
    format!("{MODEL}:{REQUEST_SHA}:{RESPONSE_SHA}")
}

fn gateway_text() -> String {
    format!("{REQUEST_SHA}:{RESPONSE_SHA}")
}

fn nonce_of(query: &str) -> String {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("nonce="))
        .unwrap_or("")
        .to_string()
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

#[test]
fn a_provider_tee_signature_matching_the_report_is_verified() {
    let address = address_of(&signing_key());
    let expected = address.clone();
    let signature = sign(&provider_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": provider_text(),
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            let nonce = nonce_of(&request.query);
            respond(
                stream,
                "200 OK",
                &json!({
                    "model_attestations": [{
                        "signing_address": address,
                        "request_nonce": nonce
                    }]
                })
                .to_string(),
            );
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-1")], KEY);

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].state, VerificationState::Verified);
    assert_eq!(results[0].kind, Some(SignatureKind::ProviderTee));
    assert_eq!(results[0].signer.as_deref(), Some(expected.as_str()));
    let requests = fake.requests();
    assert_eq!(requests.len(), 2, "one signature and one attestation");
    assert!(requests.iter().any(|r| r.path == "/v1/signature/chat-1"));
    assert!(requests.iter().any(|r| r.path == "/v1/attestation/report"));
}

#[test]
fn a_gateway_signature_without_a_kind_is_accepted_as_unknown() {
    let address = address_of(&signing_key());
    let signature = sign(&gateway_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": gateway_text(),
                    "signature": signature,
                    "signing_address": address
                })
                .to_string(),
            );
        } else {
            respond(
                stream,
                "200 OK",
                &json!({ "gateway_attestation": { "signing_address": address } }).to_string(),
            );
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-gateway")], KEY);

    assert_eq!(results[0].state, VerificationState::Verified);
    assert_eq!(results[0].kind, Some(SignatureKind::Unknown));
}

#[test]
fn a_200_error_code_is_unavailable_then_not_signed() {
    let fake = FakeServer::start(|_request, stream| {
        respond(
            stream,
            "200 OK",
            &json!({
                "error_code": "signature_unavailable",
                "message": "Try again later."
            })
            .to_string(),
        );
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);
    let record = record("chat-error-code");

    let first = verifier.verify(vec![record.clone()], KEY);
    let second = verifier.verify(vec![record.clone()], KEY);
    let third = verifier.verify(vec![record], KEY);

    assert_eq!(first[0].state, VerificationState::Checking);
    assert_eq!(second[0].state, VerificationState::Checking);
    assert_eq!(third[0].state, VerificationState::NotSigned);
    assert_eq!(fake.requests().len(), 3);
}

#[test]
fn a_200_missing_signature_is_unavailable_then_not_signed() {
    let address = address_of(&signing_key());
    let fake = FakeServer::start(move |_request, stream| {
        respond(
            stream,
            "200 OK",
            &json!({
                "text": provider_text(),
                "signing_address": address,
                "signature_kind": "provider_tee"
            })
            .to_string(),
        );
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);
    let record = record("chat-missing-signature");

    let first = verifier.verify(vec![record.clone()], KEY);
    let second = verifier.verify(vec![record.clone()], KEY);
    let third = verifier.verify(vec![record], KEY);

    assert_eq!(first[0].state, VerificationState::Checking);
    assert_eq!(second[0].state, VerificationState::Checking);
    assert_eq!(third[0].state, VerificationState::NotSigned);
    assert_eq!(fake.requests().len(), 3);
}

#[test]
fn a_text_mismatch_does_not_verify() {
    let address = address_of(&signing_key());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            let returned = format!("{MODEL}:other:{RESPONSE_SHA}");
            let signature = sign(&returned);
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": returned,
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            respond(stream, "500 Internal Server Error", "{}");
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-text-bad")], KEY);

    assert_eq!(results[0].state, VerificationState::DidntVerify);
    assert_eq!(
        fake.requests().len(),
        1,
        "the text check fails before the report"
    );
}

#[test]
fn a_signer_mismatch_does_not_verify() {
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            let text = provider_text();
            let signature = sign(&text);
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": text,
                    "signature": signature,
                    "signing_address": "0x0000000000000000000000000000000000000001",
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            respond(stream, "500 Internal Server Error", "{}");
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-signer-bad")], KEY);

    assert_eq!(results[0].state, VerificationState::DidntVerify);
    assert_eq!(
        fake.requests().len(),
        1,
        "the signer check fails before the report"
    );
}

#[test]
fn a_signer_missing_from_the_report_does_not_verify() {
    let address = address_of(&signing_key());
    let signature = sign(&provider_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": provider_text(),
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            respond(
                stream,
                "200 OK",
                &json!({
                    "model_attestations": [{
                        "signing_address": "0x0000000000000000000000000000000000000002",
                        "request_nonce": nonce_of(&request.query)
                    }]
                })
                .to_string(),
            );
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-other-signer")], KEY);

    assert_eq!(results[0].state, VerificationState::DidntVerify);
}

#[test]
fn a_gateway_signer_missing_from_the_report_does_not_verify() {
    let address = address_of(&signing_key());
    let signature = sign(&gateway_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": gateway_text(),
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "gateway"
                })
                .to_string(),
            );
        } else {
            respond(
                stream,
                "200 OK",
                &json!({
                    "gateway_attestation": {
                        "signing_address": "0x0000000000000000000000000000000000000003"
                    }
                })
                .to_string(),
            );
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-other-gateway")], KEY);

    assert_eq!(results[0].state, VerificationState::DidntVerify);
}

#[test]
fn the_report_is_fetched_once_per_model() {
    let address = address_of(&signing_key());
    let signature = sign(&provider_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": provider_text(),
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            respond(
                stream,
                "200 OK",
                &json!({
                    "model_attestations": [{
                        "signing_address": address,
                        "request_nonce": nonce_of(&request.query)
                    }]
                })
                .to_string(),
            );
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-a"), record("chat-b")], KEY);

    assert!(results
        .iter()
        .all(|result| result.state == VerificationState::Verified));
    let requests = fake.requests();
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.path.starts_with("/v1/signature/"))
            .count(),
        2
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.path == "/v1/attestation/report")
            .count(),
        1
    );
}

#[test]
fn an_unreachable_report_stays_checking_and_gives_up_after_three_tries() {
    let address = address_of(&signing_key());
    let signature = sign(&provider_text());
    let fake = FakeServer::start(move |request, stream| {
        if request.path.starts_with("/v1/signature/") {
            respond(
                stream,
                "200 OK",
                &json!({
                    "text": provider_text(),
                    "signature": signature,
                    "signing_address": address,
                    "signature_kind": "provider_tee"
                })
                .to_string(),
            );
        } else {
            respond(stream, "500 Internal Server Error", "{}");
        }
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);
    let record = record("chat-report-unreachable");

    let first = verifier.verify(vec![record.clone()], KEY);
    let second = verifier.verify(vec![record.clone()], KEY);
    let third = verifier.verify(vec![record], KEY);

    assert_eq!(first[0].state, VerificationState::Checking);
    assert_eq!(second[0].state, VerificationState::Checking);
    assert_eq!(third[0].state, VerificationState::NotSigned);
    let requests = fake.requests();
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.path.starts_with("/v1/signature/"))
            .count(),
        3
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.path == "/v1/attestation/report")
            .count(),
        3
    );
}

#[test]
fn a_signature_404_is_retried_three_times_then_not_signed() {
    let fake = FakeServer::start(|_request, stream| {
        respond(stream, "404 Not Found", "{}");
    });
    let verifier = PrivateVerifier::with_retry(&fake.base(), Duration::ZERO);

    let results = verifier.verify(vec![record("chat-404")], KEY);

    assert_eq!(results[0].state, VerificationState::NotSigned);
    assert_eq!(fake.requests().len(), 3);
}

#[test]
fn an_unreachable_endpoint_stays_checking_and_gives_up_after_three_tries() {
    let verifier = PrivateVerifier::with_retry("http://127.0.0.1:1/v1", Duration::ZERO);
    let record = record("chat-unreachable");

    let first = verifier.verify(vec![record.clone()], KEY);
    let second = verifier.verify(vec![record.clone()], KEY);
    let third = verifier.verify(vec![record], KEY);

    assert_eq!(first[0].state, VerificationState::Checking);
    assert_eq!(second[0].state, VerificationState::Checking);
    assert_eq!(third[0].state, VerificationState::NotSigned);
}
