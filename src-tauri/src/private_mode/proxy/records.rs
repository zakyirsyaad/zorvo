//! What the private proxy remembers about a completion: its chat id and the SHA-256 of the exact
//! request and response bytes. Bodies are never stored or logged; a record is kept in memory only
//! and is dropped with the app.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// How many completed calls one app session keeps; older records fall off first.
pub const MAX_RECORDS_PER_SESSION: usize = 500;
/// A response's first bytes are enough to find a completion id in JSON or an SSE `data:` line;
/// the proxy never buffers a whole response to do it.
const MAX_ID_PREFIX: usize = 1024 * 1024;
/// A single SSE line is short; a larger one is not the completion id.
const MAX_SSE_LINE: usize = 1024 * 1024;
/// Longest completion id kept in a record.
const MAX_CHAT_ID: usize = 200;

/// One finished private call. Hashes are lowercase hex of the exact bytes; no body or prompt is
/// kept. `signed` is true only for a complete 2xx answer that named a completion id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRecord {
    pub chat_id: Option<String>,
    pub model: String,
    pub request_sha256: String,
    pub response_sha256: String,
    pub started: u64,
    pub ended: u64,
    pub app_session_id: String,
    pub signed: bool,
}

/// The records of every app session, in memory only.
#[derive(Default)]
pub(super) struct RecordStore {
    by_session: HashMap<String, VecDeque<ProxyRecord>>,
}

impl RecordStore {
    pub(super) fn push(&mut self, record: ProxyRecord) {
        let records = self
            .by_session
            .entry(record.app_session_id.clone())
            .or_default();
        if records.len() == MAX_RECORDS_PER_SESSION {
            records.pop_front();
        }
        records.push_back(record);
    }

    pub(super) fn records(&self, app_session_id: &str) -> Vec<ProxyRecord> {
        self.by_session
            .get(app_session_id)
            .map(|records| records.iter().cloned().collect())
            .unwrap_or_default()
    }
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub(super) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

/// Hashes a response while the proxy streams it, and records the completion once the stream ends
/// or is dropped. `Drop` is what makes an interrupted stream a record marked not signed.
pub(super) struct RecordBuilder {
    app_session_id: String,
    model: String,
    request_sha256: String,
    started: u64,
    hasher: Sha256,
    sniffer: IdSniffer,
    records: Arc<Mutex<RecordStore>>,
    finished: bool,
}

impl RecordBuilder {
    pub(super) fn new(
        app_session_id: &str,
        model: &str,
        request_sha256: String,
        started: u64,
        records: Arc<Mutex<RecordStore>>,
    ) -> Self {
        Self {
            app_session_id: app_session_id.to_string(),
            model: model.to_string(),
            request_sha256,
            started,
            hasher: Sha256::new(),
            sniffer: IdSniffer::default(),
            records,
            finished: false,
        }
    }

    pub(super) fn observe(&mut self, bytes: &[u8]) {
        if self.finished {
            return;
        }
        self.hasher.update(bytes);
        self.sniffer.observe(bytes);
    }

    pub(super) fn finish(&mut self, complete: bool) {
        if self.finished {
            return;
        }
        self.finished = true;
        let chat_id = self.sniffer.id();
        let record = ProxyRecord {
            chat_id: chat_id.clone(),
            model: self.model.clone(),
            request_sha256: self.request_sha256.clone(),
            response_sha256: hex(&self.hasher.clone().finalize()),
            started: self.started,
            ended: now_ms(),
            app_session_id: self.app_session_id.clone(),
            signed: complete && chat_id.is_some(),
        };
        lock(&self.records).push(record);
    }
}

impl Drop for RecordBuilder {
    fn drop(&mut self) {
        self.finish(false);
    }
}

/// Finds the first completion id in a response while its bytes pass through. A streamed answer's
/// `data:` line and a plain JSON object are both read from a bounded prefix, never a whole body.
#[derive(Default)]
struct IdSniffer {
    id: Option<String>,
    line: Vec<u8>,
    json: Vec<u8>,
}

impl IdSniffer {
    fn observe(&mut self, bytes: &[u8]) {
        if self.id.is_some() {
            return;
        }
        for &byte in bytes {
            if byte == b'\n' {
                let line = std::mem::take(&mut self.line);
                self.sse_line(&line);
            } else if self.line.len() < MAX_SSE_LINE {
                self.line.push(byte);
            }
        }
        if self.json.len() < MAX_ID_PREFIX {
            let room = MAX_ID_PREFIX - self.json.len();
            self.json.extend_from_slice(&bytes[..bytes.len().min(room)]);
            self.plain_json();
        }
    }

    fn sse_line(&mut self, line: &[u8]) {
        let line = trim_ascii(line);
        let Some(data) = line.strip_prefix(b"data:") else {
            return;
        };
        let data = trim_ascii(data);
        if data == b"[DONE]" {
            return;
        }
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) {
            self.set(&value);
        }
    }

    fn plain_json(&mut self) {
        let body = trim_ascii(&self.json);
        if body.first() != Some(&b'{') || body.last() != Some(&b'}') {
            return;
        }
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) {
            self.set(&value);
        }
    }

    fn set(&mut self, value: &serde_json::Value) {
        if let Some(id) = value.get("id").and_then(serde_json::Value::as_str) {
            if !id.is_empty() && id.len() <= MAX_CHAT_ID {
                self.id = Some(id.to_string());
            }
        }
    }

    fn id(&self) -> Option<String> {
        self.id.clone()
    }
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .map_or(start, |index| index + 1);
    &bytes[start..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builder(records: Arc<Mutex<RecordStore>>) -> RecordBuilder {
        RecordBuilder::new("s1", "model", sha256_hex(b"{}"), 1, records)
    }

    #[test]
    fn an_sse_data_line_gives_the_id_and_a_hash_of_every_byte() {
        let records = Arc::new(Mutex::new(RecordStore::default()));
        let mut record = builder(Arc::clone(&records));
        record.observe(b"data: {\"id\":\"chat-1\",\"choices\":[]}\n\n");

        record.finish(true);

        let stored = lock(&records).records("s1");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].chat_id.as_deref(), Some("chat-1"));
        assert_eq!(
            stored[0].response_sha256,
            sha256_hex(b"data: {\"id\":\"chat-1\",\"choices\":[]}\n\n")
        );
        assert!(stored[0].signed);
        assert_eq!(stored[0].model, "model");
        assert_eq!(stored[0].app_session_id, "s1");
    }

    #[test]
    fn a_complete_plain_json_body_gives_the_id() {
        let records = Arc::new(Mutex::new(RecordStore::default()));
        let mut record = builder(Arc::clone(&records));

        record.observe(b"{\"id\":\"chat-2\",");
        record.observe(b"\"object\":\"chat.completion\"}");
        record.finish(true);

        let stored = lock(&records).records("s1");
        assert_eq!(stored[0].chat_id.as_deref(), Some("chat-2"));
        assert!(stored[0].signed);
    }

    #[test]
    fn an_interrupted_or_idless_stream_is_recorded_as_not_signed() {
        let records = Arc::new(Mutex::new(RecordStore::default()));
        let mut interrupted = builder(Arc::clone(&records));
        interrupted.observe(b"data: {\"id\":\"chat-3\"}\n\n");
        interrupted.finish(false);

        let mut idless = builder(Arc::clone(&records));
        idless.observe(b"data: {\"choices\":[]}\n\n");
        idless.finish(true);

        let stored = lock(&records).records("s1");
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].chat_id.as_deref(), Some("chat-3"));
        assert!(!stored[0].signed);
        assert_eq!(stored[1].chat_id, None);
        assert!(!stored[1].signed);
    }

    #[test]
    fn a_session_keeps_only_the_newest_five_hundred_records() {
        let records = Arc::new(Mutex::new(RecordStore::default()));
        for id in 0..(MAX_RECORDS_PER_SESSION + 2) {
            let mut record = builder(Arc::clone(&records));
            record.observe(format!("data: {{\"id\":\"chat-{id}\"}}\n\n").as_bytes());
            record.finish(true);
        }

        let stored = lock(&records).records("s1");
        assert_eq!(stored.len(), MAX_RECORDS_PER_SESSION);
        assert_eq!(stored[0].chat_id.as_deref(), Some("chat-2"));
        assert_eq!(
            stored[MAX_RECORDS_PER_SESSION - 1].chat_id.as_deref(),
            Some("chat-501")
        );
    }

    #[test]
    fn hex_is_lowercase_and_fixed_width() {
        assert_eq!(hex(&[0x00, 0x0a, 0xff]), "000aff");
    }
}
