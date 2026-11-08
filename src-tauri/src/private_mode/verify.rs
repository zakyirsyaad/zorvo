//! Verifying NEAR AI's per-answer signature and the signer's attestation (extension B, B2).
//!
//! The proxy kept, for each completion, the completion id and the SHA-256 of the exact request
//! and response bytes. This module asks NEAR AI for the signature of that id, checks the signed
//! text against those hashes, recovers the signer's address with EIP-191/secp256k1, and checks
//! that address against NEAR AI's attestation report. It never stores a body, a prompt or a key.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha3::{Digest, Keccak256};
use url::Url;

use super::proxy::ProxyRecord;

const MAX_BODY_BYTES: u64 = 1024 * 1024;
const MAX_ATTEMPTS: u8 = 3;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
const PRODUCTION_RETRY: Duration = Duration::from_secs(3);

/// What the UI shows for one record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationState {
    Verified,
    DidntVerify,
    NotSigned,
    Checking,
}

/// How NEAR AI signed: the model's TEE, its attested gateway, or a form the answer did not name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureKind {
    ProviderTee,
    Gateway,
    Unknown,
}

/// One record's result, as the command returns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordVerification {
    pub started_at: u64,
    pub ended_at: u64,
    pub state: VerificationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<SignatureKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
}

#[derive(Clone)]
struct Checked {
    state: VerificationState,
    kind: Option<SignatureKind>,
    signer: Option<String>,
    attempts: u8,
}

#[derive(Clone)]
struct Attestation {
    model_signers: HashSet<String>,
    gateway_signer: Option<String>,
}

impl Attestation {
    fn allows(&self, proof: &SignatureProof) -> bool {
        match proof.kind {
            SignatureKind::ProviderTee => self.model_signers.contains(&proof.signer),
            // The gateway report has no request_nonce to bind. Without DCAP the nonce proves
            // nothing extra, so the gateway signer is checked by address alone.
            SignatureKind::Gateway => self.gateway_signer.as_deref() == Some(proof.signer.as_str()),
            SignatureKind::Unknown => {
                self.model_signers.contains(&proof.signer)
                    || self.gateway_signer.as_deref() == Some(proof.signer.as_str())
            }
        }
    }
}

struct SignatureProof {
    text: String,
    signature: String,
    signer: String,
    kind: SignatureKind,
}

enum SignatureLookup {
    Found(SignatureProof),
    NotFound,
    /// A 2xx whose body says the signature is not available (or does not carry one): retry later.
    Unavailable,
    Unreachable,
}

#[derive(Deserialize)]
struct SignatureAnswer {
    text: String,
    signature: String,
    signing_address: String,
    #[serde(default)]
    signature_kind: Option<String>,
    /// NEAR AI can answer 200 with an error body instead of a signature.
    #[serde(default)]
    error_code: Option<String>,
}

/// The signature and attestation checks, with their caches for this app run.
pub struct PrivateVerifier {
    base: String,
    agent: ureq::Agent,
    retry: Duration,
    /// Per model, a report fetched once; a failed report is not cached and is tried again.
    attestations: Mutex<HashMap<String, Attestation>>,
    /// Per completion id, a final result or a retryable `checking` with its attempts.
    results: Mutex<HashMap<String, Checked>>,
}

impl PrivateVerifier {
    pub fn new(base: &str) -> Self {
        Self::with_retry(base, PRODUCTION_RETRY)
    }

    /// Tests use a zero retry delay; production waits between 404 attempts.
    #[doc(hidden)]
    pub fn with_retry(base: &str, retry: Duration) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .max_redirects(0)
            .http_status_as_error(false)
            .build()
            .into();
        Self {
            base: base.trim_end_matches('/').to_string(),
            agent,
            retry,
            attestations: Mutex::new(HashMap::new()),
            results: Mutex::new(HashMap::new()),
        }
    }

    /// Verifies every record, reusing a final result from an earlier turn, and returns a result for each.
    pub fn verify(&self, records: Vec<ProxyRecord>, key: &str) -> Vec<RecordVerification> {
        let mut out = Vec::new();
        let mut local_attestations: HashMap<String, Result<Attestation, ()>> = HashMap::new();
        for record in records {
            let Some(id) = record.chat_id.clone().filter(|id| !id.is_empty()) else {
                out.push(result_of(&record, VerificationState::NotSigned, None, None));
                continue;
            };
            let cached = lock(&self.results).get(&id).cloned();
            if let Some(checked) = cached.as_ref() {
                if checked.state != VerificationState::Checking {
                    out.push(result_of(
                        &record,
                        checked.state,
                        checked.kind,
                        checked.signer.as_deref(),
                    ));
                    continue;
                }
                if checked.attempts >= MAX_ATTEMPTS {
                    self.emit(
                        &mut out,
                        &record,
                        VerificationState::NotSigned,
                        None,
                        None,
                        MAX_ATTEMPTS,
                    );
                    continue;
                }
            }
            if !record.signed {
                self.emit(
                    &mut out,
                    &record,
                    VerificationState::NotSigned,
                    None,
                    None,
                    0,
                );
                continue;
            }
            let attempts = cached.as_ref().map_or(0, |checked| checked.attempts);
            match self.signature(&id, &record.model, key) {
                SignatureLookup::NotFound => {
                    self.emit(
                        &mut out,
                        &record,
                        VerificationState::NotSigned,
                        None,
                        None,
                        0,
                    );
                }
                SignatureLookup::Unavailable | SignatureLookup::Unreachable => {
                    self.retry_later(&mut out, &record, attempts);
                }
                SignatureLookup::Found(proof) => {
                    if !text_matches(&proof, &record) {
                        self.emit(
                            &mut out,
                            &record,
                            VerificationState::DidntVerify,
                            Some(proof.kind),
                            Some(&proof.signer),
                            0,
                        );
                        continue;
                    }
                    if recover_address(&proof.text, &proof.signature)
                        .is_none_or(|address| address != proof.signer)
                    {
                        self.emit(
                            &mut out,
                            &record,
                            VerificationState::DidntVerify,
                            Some(proof.kind),
                            Some(&proof.signer),
                            0,
                        );
                        continue;
                    }
                    match self.attestation(&record.model, key, &mut local_attestations) {
                        Err(()) => self.retry_later(&mut out, &record, attempts),
                        Ok(attestation) if attestation.allows(&proof) => {
                            self.emit(
                                &mut out,
                                &record,
                                VerificationState::Verified,
                                Some(proof.kind),
                                Some(&proof.signer),
                                0,
                            );
                        }
                        Ok(_) => {
                            self.emit(
                                &mut out,
                                &record,
                                VerificationState::DidntVerify,
                                Some(proof.kind),
                                Some(&proof.signer),
                                0,
                            );
                        }
                    }
                }
            }
        }
        out
    }

    fn retry_later(&self, out: &mut Vec<RecordVerification>, record: &ProxyRecord, attempts: u8) {
        let attempts = attempts.saturating_add(1);
        let state = if attempts >= MAX_ATTEMPTS {
            VerificationState::NotSigned
        } else {
            VerificationState::Checking
        };
        self.emit(out, record, state, None, None, attempts);
    }

    fn emit(
        &self,
        out: &mut Vec<RecordVerification>,
        record: &ProxyRecord,
        state: VerificationState,
        kind: Option<SignatureKind>,
        signer: Option<&str>,
        attempts: u8,
    ) {
        if let Some(id) = record.chat_id.as_ref().filter(|id| !id.is_empty()) {
            lock(&self.results).insert(
                id.clone(),
                Checked {
                    state,
                    kind,
                    signer: signer.map(str::to_string),
                    attempts,
                },
            );
        }
        out.push(result_of(record, state, kind, signer));
    }

    fn signature(&self, id: &str, model: &str, key: &str) -> SignatureLookup {
        for attempt in 0..MAX_ATTEMPTS {
            match self.get(
                &["signature", id],
                &[("model", model), ("signing_algo", "ecdsa")],
                key,
            ) {
                Ok((200, body)) => {
                    return match parse_signature(&body) {
                        Some(proof) => SignatureLookup::Found(proof),
                        None => SignatureLookup::Unavailable,
                    };
                }
                Ok((404, _)) => {
                    if attempt + 1 < MAX_ATTEMPTS {
                        std::thread::sleep(self.retry);
                    } else {
                        return SignatureLookup::NotFound;
                    }
                }
                _ => return SignatureLookup::Unreachable,
            }
        }
        SignatureLookup::NotFound
    }

    fn attestation(
        &self,
        model: &str,
        key: &str,
        local: &mut HashMap<String, Result<Attestation, ()>>,
    ) -> Result<Attestation, ()> {
        if let Some(attestation) = lock(&self.attestations).get(model).cloned() {
            return Ok(attestation);
        }
        if let Some(answer) = local.get(model) {
            return answer.clone();
        }
        let answer = (|| {
            let nonce = random_nonce().ok_or(())?;
            let (status, body) = self.get(
                &["attestation", "report"],
                &[
                    ("model", model),
                    ("signing_algo", "ecdsa"),
                    ("nonce", &nonce),
                ],
                key,
            )?;
            if status != 200 {
                return Err(());
            }
            parse_attestation(&body, &nonce).ok_or(())
        })();
        local.insert(model.to_string(), answer.clone());
        if let Ok(attestation) = &answer {
            lock(&self.attestations).insert(model.to_string(), attestation.clone());
        }
        answer
    }

    fn get(
        &self,
        segments: &[&str],
        query: &[(&str, &str)],
        key: &str,
    ) -> Result<(u16, String), ()> {
        let mut url = Url::parse(&self.base).map_err(|_| ())?;
        let mut path = url.path_segments_mut().map_err(|_| ())?;
        for segment in segments {
            path.push(segment);
        }
        drop(path);
        {
            let mut pairs = url.query_pairs_mut();
            for (name, value) in query {
                pairs.append_pair(name, value);
            }
        }
        let request = ureq::http::Request::builder()
            .method(ureq::http::Method::GET)
            .uri(url.as_str())
            .header("Authorization", format!("Bearer {key}"))
            .body(String::new())
            .map_err(|_| ())?;
        let mut response = self.agent.run(request).map_err(|_| ())?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_string()
            .map_err(|_| ())?;
        Ok((status, body))
    }
}

fn result_of(
    record: &ProxyRecord,
    state: VerificationState,
    kind: Option<SignatureKind>,
    signer: Option<&str>,
) -> RecordVerification {
    RecordVerification {
        started_at: record.started,
        ended_at: record.ended,
        state,
        kind,
        signer: signer.map(str::to_string),
    }
}

fn text_matches(proof: &SignatureProof, record: &ProxyRecord) -> bool {
    let provider = format!(
        "{}:{}:{}",
        record.model, record.request_sha256, record.response_sha256
    );
    let gateway = format!("{}:{}", record.request_sha256, record.response_sha256);
    match proof.kind {
        SignatureKind::ProviderTee => proof.text == provider,
        SignatureKind::Gateway => proof.text == gateway,
        SignatureKind::Unknown => proof.text == provider || proof.text == gateway,
    }
}

fn parse_signature(body: &str) -> Option<SignatureProof> {
    let answer: SignatureAnswer = serde_json::from_str(body).ok()?;
    // A 2xx can say "not available" instead of signing, or carry an incomplete signature.
    // Neither is tamper evidence: retry later, and never mark it Didn't verify.
    if answer.error_code.is_some()
        || answer.text.is_empty()
        || answer.signature.is_empty()
        || answer.signing_address.is_empty()
    {
        return None;
    }
    let kind = match answer.signature_kind.as_deref() {
        Some(kind) if kind.eq_ignore_ascii_case("provider_tee") => SignatureKind::ProviderTee,
        Some(kind) if kind.eq_ignore_ascii_case("gateway") => SignatureKind::Gateway,
        _ => SignatureKind::Unknown,
    };
    Some(SignatureProof {
        text: answer.text,
        signature: answer.signature,
        signer: normalize_address(&answer.signing_address),
        kind,
    })
}

fn parse_attestation(body: &str, nonce: &str) -> Option<Attestation> {
    let value: Value = serde_json::from_str(body).ok()?;
    let mut model_signers = HashSet::new();
    if let Some(models) = value.get("model_attestations").and_then(Value::as_array) {
        for model in models {
            if model.get("request_nonce").and_then(Value::as_str) != Some(nonce) {
                continue;
            }
            if let Some(address) = model.get("signing_address").and_then(Value::as_str) {
                model_signers.insert(normalize_address(address));
            }
        }
    }
    let gateway_signer = gateway_address(&value);
    Some(Attestation {
        model_signers,
        gateway_signer,
    })
}

fn gateway_address(value: &Value) -> Option<String> {
    for key in ["gateway_attestation", "gateway"] {
        if let Some(address) = value
            .get(key)
            .and_then(|gateway| gateway.get("signing_address"))
            .and_then(Value::as_str)
        {
            return Some(normalize_address(address));
        }
    }
    if let Some(first) = value
        .get("gateway_attestations")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
    {
        if let Some(address) = first.get("signing_address").and_then(Value::as_str) {
            return Some(normalize_address(address));
        }
    }
    value
        .get("gateway_signing_address")
        .and_then(Value::as_str)
        .map(normalize_address)
}

fn normalize_address(address: &str) -> String {
    format!(
        "0x{}",
        address
            .strip_prefix("0x")
            .or_else(|| address.strip_prefix("0X"))
            .unwrap_or(address)
            .to_ascii_lowercase()
    )
}

/// Recover the checksum-less EIP-191 address a personal_sign signature names.
fn recover_address(text: &str, signature_hex: &str) -> Option<String> {
    let bytes = decode_hex(signature_hex)?;
    if bytes.len() != 65 {
        return None;
    }
    let recovery = match bytes[64] {
        0 | 1 => bytes[64],
        27 | 28 => bytes[64] - 27,
        _ => return None,
    };
    let signature = Signature::from_slice(&bytes[..64]).ok()?;
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let digest = Keccak256::digest(prefixed.as_bytes());
    let key =
        VerifyingKey::recover_from_prehash(&digest, &signature, RecoveryId::from_byte(recovery)?)
            .ok()?;
    let point = key.to_encoded_point(false);
    let address = Keccak256::digest(&point.as_bytes()[1..]);
    Some(format!("0x{}", hex(&address[12..])))
}

fn random_nonce() -> Option<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    let text = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .unwrap_or(text);
    if !text.len().is_multiple_of(2) || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;

    fn signing_key() -> SigningKey {
        SigningKey::from_slice(&[7u8; 32]).expect("a valid scalar")
    }

    fn address_of(key: &SigningKey) -> String {
        let point = key.verifying_key().to_encoded_point(false);
        let digest = Keccak256::digest(&point.as_bytes()[1..]);
        format!("0x{}", hex(&digest[12..]))
    }

    fn sign(text: &str, v_offset: u8) -> String {
        let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
        let digest = Keccak256::digest(prefixed.as_bytes());
        let (signature, recovery) = signing_key()
            .sign_prehash_recoverable(&digest)
            .expect("sign");
        let mut bytes = signature.to_bytes().to_vec();
        bytes.push(recovery.to_byte() + v_offset);
        hex(&bytes)
    }

    #[test]
    fn recovers_the_eip_191_address_from_a_signature() {
        let text = "Qwen/Qwen3.8-27B:req:resp";

        assert_eq!(
            recover_address(text, &sign(text, 0)),
            Some(address_of(&signing_key()))
        );
        assert_eq!(
            recover_address(text, &sign(text, 27)),
            Some(address_of(&signing_key()))
        );
    }

    #[test]
    fn a_signature_for_another_text_recovers_another_signer_not_this_one() {
        let signature = sign("another text", 0);

        assert_ne!(
            recover_address("Qwen/Qwen3.8-27B:req:resp", &signature),
            Some(address_of(&signing_key()))
        );
    }

    #[test]
    fn malformed_signatures_recover_nothing() {
        assert_eq!(recover_address("text", "00"), None);
        assert_eq!(recover_address("text", &"00".repeat(65)), None);
        assert_eq!(
            recover_address("text", &format!("{}ff", "11".repeat(64))),
            None
        );
    }

    #[test]
    fn an_absent_kind_accepts_either_text_and_reports_unknown() {
        let body = serde_json::json!({
            "text": "req:resp",
            "signature": "00",
            "signing_address": "0xABC"
        })
        .to_string();

        let proof = parse_signature(&body).expect("parsed");

        assert_eq!(proof.kind, SignatureKind::Unknown);
        assert_eq!(proof.signer, "0xabc");
    }

    #[test]
    fn an_error_code_makes_a_200_unavailable_even_with_signature_fields() {
        let body = serde_json::json!({
            "text": "req:resp",
            "signature": "00",
            "signing_address": "0xABC",
            "error_code": "signature_unavailable"
        })
        .to_string();

        assert!(parse_signature(&body).is_none());
    }

    #[test]
    fn an_attestation_matches_the_nonce_and_finds_the_gateway() {
        let body = serde_json::json!({
            "model_attestations": [
                {"signing_address": "0xAa", "request_nonce": "n1"},
                {"signing_address": "0xBb", "request_nonce": "other"}
            ],
            "gateway_attestation": {"signing_address": "0xCc"}
        })
        .to_string();

        let attestation = parse_attestation(&body, "n1").expect("parsed");

        assert!(attestation.model_signers.contains("0xaa"));
        assert!(!attestation.model_signers.contains("0xbb"));
        assert_eq!(attestation.gateway_signer.as_deref(), Some("0xcc"));
    }
}
