//! The real error behind Qwen Code's failed requests.
//!
//! Over ACP, Qwen Code reports a failed request only as lifecycle metadata
//! without the error. Its own log has it: `<base>/projects/<folder>/chats/
//! <session id>.jsonl` holds a `qwen-code.api_error` event per failed request.
//! This reads the newest one of the current turn. It never logs what it reads.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::env_resolver;

/// How much of the log's end is read: a turn's errors are at the end.
const TAIL_BYTES: u64 = 256 * 1024;
const MAX_MESSAGE_CHARS: usize = 300;
const MAX_ID_LEN: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QwenApiError {
    pub status_code: Option<u16>,
    pub message: String,
}

/// The newest `api_error` Qwen Code logged for this ACP session at or after
/// `since_ms` (Unix time, in milliseconds), if any.
pub fn last_api_error(acp_session_id: &str, since_ms: u64) -> Option<QwenApiError> {
    let env = env_resolver::cached_user_env().unwrap_or_default();
    last_api_error_in(&base_dir(&env)?, acp_session_id, since_ms)
}

fn base_dir(env: &HashMap<String, String>) -> Option<PathBuf> {
    let pick = |key: &str| {
        env.get(key)
            .cloned()
            .or_else(|| std::env::var(key).ok())
            .filter(|value| !value.is_empty())
    };
    pick("QWEN_RUNTIME_DIR")
        .or_else(|| pick("QWEN_HOME"))
        .map(PathBuf::from)
        .or_else(|| pick("HOME").map(|home| Path::new(&home).join(".qwen")))
}

fn last_api_error_in(base: &Path, acp_session_id: &str, since_ms: u64) -> Option<QwenApiError> {
    if !is_valid_session_id(acp_session_id) {
        return None;
    }
    let log = find_log(base, acp_session_id)?;
    let tail = read_tail(&log)?;
    tail.lines()
        .rev()
        .filter_map(api_error_of)
        .find(|(at_ms, _)| *at_ms >= since_ms)
        .map(|(_, error)| error)
}

/// Qwen's session ids are UUIDs; anything else never reaches a path.
pub(crate) fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Finds the session's log without re-deriving how Qwen names its folders.
fn find_log(base: &Path, acp_session_id: &str) -> Option<PathBuf> {
    let file_name = format!("{acp_session_id}.jsonl");
    fs::read_dir(base.join("projects"))
        .ok()?
        .flatten()
        .map(|folder| folder.path().join("chats").join(&file_name))
        .find(|candidate| candidate.is_file())
}

/// The last `TAIL_BYTES` of the file as text. A cut-off first line is dropped.
fn read_tail(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if start == 0 {
        return Some(text);
    }
    text.split_once('\n').map(|(_, rest)| rest.to_string())
}

/// The event's time and error, when the line is a `qwen-code.api_error`.
fn api_error_of(line: &str) -> Option<(u64, QwenApiError)> {
    let value: Value = serde_json::from_str(line).ok()?;
    let event = value.get("systemPayload")?.get("uiEvent")?;
    if event.get("event.name")?.as_str()? != "qwen-code.api_error" {
        return None;
    }
    let at_ms = match event.get("event.timestamp")? {
        Value::String(text) => parse_iso_ms(text)?,
        Value::Number(number) => number.as_u64()?,
        _ => return None,
    };
    let message = one_line(event.get("error_message")?.as_str()?);
    if message.is_empty() {
        return None;
    }
    let status_code = match event.get("status_code") {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.trim().parse().ok(),
        _ => None,
    }
    .and_then(|code| u16::try_from(code).ok());
    Some((
        at_ms,
        QwenApiError {
            status_code,
            message,
        },
    ))
}

fn one_line(text: &str) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match joined.char_indices().nth(MAX_MESSAGE_CHARS) {
        Some((cut, _)) => format!("{}…", &joined[..cut]),
        None => joined,
    }
}

/// `2026-10-16T17:08:40.443Z` (or with a `±hh:mm` offset) as Unix milliseconds.
fn parse_iso_ms(text: &str) -> Option<u64> {
    let (date, time) = text.split_once('T')?;
    let mut ymd = date.split('-');
    let year: i64 = ymd.next()?.parse().ok()?;
    let month: i64 = ymd.next()?.parse().ok()?;
    let day: i64 = ymd.next()?.parse().ok()?;
    if ymd.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (clock, offset_min) = match time.find(['Z', '+', '-']) {
        Some(at) if &time[at..] == "Z" => (&time[..at], 0),
        Some(at) => {
            let sign = if time.as_bytes()[at] == b'-' { -1 } else { 1 };
            let (h, m) = time[at + 1..].split_once(':')?;
            (
                &time[..at],
                sign * (h.parse::<i64>().ok()? * 60 + m.parse::<i64>().ok()?),
            )
        }
        None => return None,
    };
    let mut parts = clock.split(':');
    let hour: i64 = parts.next()?.parse().ok()?;
    let minute: i64 = parts.next()?.parse().ok()?;
    let seconds = parts.next()?;
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let second: i64 = whole.parse().ok()?;
    if !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let millis: i64 = format!("{fraction:0<3}")[..3].parse().ok()?;
    let secs = days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second
        - offset_min * 60;
    u64::try_from(secs * 1000 + millis).ok()
}

/// Days since 1970-01-01 of a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    /// A scratch folder removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "zorvo-qwen-log-{}-{}",
                std::process::id(),
                NEXT_DIR.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const ID: &str = "4307113b-0096-47c3-89ed-3af3f9f845de";
    /// 2026-10-16T17:08:40.443Z
    const AT_MS: u64 = 1_792_170_520_443;

    fn api_error_line(timestamp: &str, status: Option<u16>, message: &str) -> String {
        let mut event = serde_json::json!({
            "event.name": "qwen-code.api_error",
            "event.timestamp": timestamp,
            "error_message": message,
        });
        if let Some(code) = status {
            event["status_code"] = code.into();
        }
        serde_json::json!({ "type": "system", "systemPayload": { "uiEvent": event } }).to_string()
    }

    fn write_log(base: &Path, lines: &[String]) {
        let chats = base.join("projects").join("-Users-me-app").join("chats");
        fs::create_dir_all(&chats).unwrap();
        fs::write(chats.join(format!("{ID}.jsonl")), lines.join("\n")).unwrap();
    }

    #[test]
    fn parses_an_iso_timestamp_to_unix_milliseconds() {
        assert_eq!(parse_iso_ms("2026-10-16T17:08:40.443Z"), Some(AT_MS));
        assert_eq!(parse_iso_ms("2026-10-16T18:08:40+01:00"), Some(AT_MS - 443));
        assert_eq!(parse_iso_ms("yesterday"), None);
    }

    #[test]
    fn rejects_a_timestamp_whose_fraction_is_not_digits_without_panicking() {
        assert_eq!(parse_iso_ms("2026-10-16T17:08:40.\u{e9}1Z"), None);
        assert_eq!(parse_iso_ms("2026-10-16T17:08:40.4x3Z"), None);
        assert_eq!(parse_iso_ms("2026-10-16T17:08:40.443999Z"), Some(AT_MS));
    }

    #[test]
    fn finds_the_newest_error_of_the_turn() {
        let base = TempDir::new();
        write_log(
            base.path(),
            &[
                api_error_line("2026-10-16T17:08:30.000Z", Some(500), "older"),
                api_error_line("2026-10-16T17:08:40.443Z", Some(429), "Quota\nexhausted."),
            ],
        );

        let found = last_api_error_in(base.path(), ID, AT_MS - 20_000).unwrap();

        assert_eq!(
            found,
            QwenApiError {
                status_code: Some(429),
                message: "Quota exhausted.".into()
            }
        );
    }

    #[test]
    fn ignores_errors_from_before_the_turn() {
        let base = TempDir::new();
        write_log(
            base.path(),
            &[api_error_line(
                "2026-10-16T17:08:40.443Z",
                Some(429),
                "stale",
            )],
        );

        assert_eq!(last_api_error_in(base.path(), ID, AT_MS + 1), None);
    }

    #[test]
    fn skips_broken_lines_and_other_events() {
        let base = TempDir::new();
        write_log(
            base.path(),
            &[
                api_error_line("2026-10-16T17:08:40.443Z", None, "terminated"),
                "{not json".to_string(),
                r#"{"systemPayload":{"uiEvent":{"event.name":"qwen-code.api_response"}}}"#
                    .to_string(),
                "{\"systemPayload\":".to_string(),
            ],
        );

        let found = last_api_error_in(base.path(), ID, 0).unwrap();

        assert_eq!(found.message, "terminated");
        assert_eq!(found.status_code, None);
    }

    #[test]
    fn returns_none_when_the_log_is_missing() {
        let base = TempDir::new();
        fs::create_dir_all(base.path().join("projects").join("x").join("chats")).unwrap();

        assert_eq!(last_api_error_in(base.path(), ID, 0), None);
        assert_eq!(last_api_error_in(&base.path().join("nope"), ID, 0), None);
    }

    #[test]
    fn refuses_an_id_that_is_not_a_plain_session_id() {
        let base = TempDir::new();
        write_log(
            base.path(),
            &[api_error_line("2026-10-16T17:08:40.443Z", None, "x")],
        );

        for bad in ["", "../x", "a/b", "a.b", &"a".repeat(129)] {
            assert_eq!(last_api_error_in(base.path(), bad, 0), None, "{bad}");
        }
    }

    #[test]
    fn cuts_a_long_message_to_one_short_line() {
        let long = "word ".repeat(200);
        assert_eq!(one_line(&long).chars().count(), MAX_MESSAGE_CHARS + 1);
    }

    #[test]
    fn reads_only_the_end_of_a_large_log() {
        let base = TempDir::new();
        let filler = "x".repeat(300 * 1024);
        write_log(
            base.path(),
            &[
                api_error_line("2026-10-16T17:08:41.000Z", Some(500), "buried"),
                filler,
                api_error_line("2026-10-16T17:08:42.000Z", Some(429), "latest"),
            ],
        );

        assert_eq!(
            last_api_error_in(base.path(), ID, 0).unwrap().message,
            "latest"
        );
        assert_eq!(
            last_api_error_in(base.path(), ID, AT_MS + 1_000)
                .unwrap()
                .message,
            "latest"
        );
    }
}
