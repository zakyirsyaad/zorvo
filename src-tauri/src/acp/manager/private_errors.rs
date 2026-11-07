//! Turns NEAR AI's credit and key refusals, as Qwen Code reports them, into
//! the error the UI reads for a Zorvo Private session, and says which requests
//! would move a private session off its model.

use serde_json::Value;

use crate::private_mode::PRIVATE_CREDITS_PREFIX;

/// Qwen Code's slash commands (and their other names) that switch the model or
/// the provider of the running process, which would take a private session's
/// history out of the TEE: `login` and `connect` are names of `auth`.
const MODEL_COMMANDS: [&str; 4] = ["model", "auth", "login", "connect"];

/// The option id Qwen Code gives its model, refused even when the session's
/// answer reported no options (a resume answer omits them).
const MODEL_OPTION_ID: &str = "model";

/// Whether `c` is whitespace to JavaScript's `\s`, which Qwen Code splits a
/// command with: ASCII whitespace (with the vertical tab), U+00A0, U+1680,
/// U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Rust's
/// `char::is_whitespace` differs (U+0085 is in it, U+FEFF is not).
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// Whether `text`, as a prompt, runs one of [`MODEL_COMMANDS`], parsed as
/// Qwen Code 0.26.1 does: a command only when the raw text starts with `/`
/// (leading whitespace makes it an ordinary prompt), its name the first word
/// after the slash and any whitespace, in any letter case.
pub(super) fn is_model_command(text: &str) -> bool {
    let Some(rest) = text.strip_prefix('/') else {
        return false;
    };
    rest.split(is_js_whitespace)
        .find(|word| !word.is_empty())
        .is_some_and(|name| MODEL_COMMANDS.iter().any(|c| name.eq_ignore_ascii_case(c)))
}

/// The ids, lower-cased, of the `model` category options in a session
/// answer's `configOptions`.
pub(super) fn model_option_ids(config_options: &Value) -> Vec<String> {
    config_options
        .as_array()
        .into_iter()
        .flatten()
        .filter(|option| option["category"] == "model")
        .filter_map(|option| option["id"].as_str())
        .map(str::to_ascii_lowercase)
        .collect()
}

/// Whether setting `config_id` would change the model: `model`, or an option
/// the session reported in the `model` category (`model_options`, lower-cased).
pub(super) fn is_model_option(config_id: &str, model_options: &[String]) -> bool {
    let id = config_id.to_ascii_lowercase();
    id == MODEL_OPTION_ID || model_options.contains(&id)
}

/// Fields that hold an HTTP status as a number.
const STATUS_KEYS: [&str; 3] = ["status", "statusCode", "status_code"];

/// Words that say the number after them is an HTTP status.
const STATUS_WORDS: [&str; 3] = ["status", "code", "http"];

/// Why a private session's request was refused, as `PRIVATE_CREDITS:` carries
/// it: `"empty"` when the credits are used up (HTTP 402), `"key"` when NEAR AI
/// refused the key (HTTP 401). `None` for any other error.
///
/// Qwen Code reports the HTTP status inside a JSON-RPC `-32603`, in whichever
/// of `message`, `data` or `data.details` it likes, so every text the error
/// holds is read. A status counts only where an HTTP client puts one (see
/// [`statuses_in_text`]) or as a number in a `status` field, so a `402` in
/// other words (a tool's output, a file count) does not; NEAR AI's own phrases
/// count anywhere. `empty` wins when both appear.
pub(super) fn private_credits_reason(error: &Value) -> Option<&'static str> {
    if !error.is_object() {
        return None;
    }
    let mut texts = Vec::new();
    let mut statuses = Vec::new();
    collect(error, None, &mut texts, &mut statuses);
    let has_phrase = |phrases: &[&str]| {
        texts
            .iter()
            .any(|text| phrases.iter().any(|phrase| text.contains(phrase)))
    };
    if statuses.contains(&402)
        || has_phrase(&[
            "api_key_limit_exceeded",
            "insufficient credit",
            "credit limit",
        ])
    {
        Some("empty")
    } else if statuses.contains(&401)
        || has_phrase(&["invalid or expired api key", "invalid api key"])
    {
        Some("key")
    } else {
        None
    }
}

/// The error a private session's request ends with when `error` is a credit
/// or key refusal: `PRIVATE_CREDITS:{"reason":"empty"}` (or `"key"`).
pub(super) fn private_credits_error(error: &Value) -> Option<String> {
    private_credits_reason(error)
        .map(|reason| format!("{PRIVATE_CREDITS_PREFIX}{{\"reason\":\"{reason}\"}}"))
}

/// Walks `value`: every string goes to `texts` (lower-cased) and the statuses
/// it names to `statuses`; a number under one of [`STATUS_KEYS`] is a status.
/// Each string is read on its own, so no word runs into the next one.
fn collect(value: &Value, key: Option<&str>, texts: &mut Vec<String>, statuses: &mut Vec<u64>) {
    match value {
        Value::String(text) => {
            let text = text.to_lowercase();
            statuses.extend(statuses_in_text(&text));
            texts.push(text);
        }
        Value::Number(number) if key.is_some_and(|key| STATUS_KEYS.contains(&key)) => {
            statuses.extend(number.as_u64());
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect(item, None, texts, statuses)),
        Value::Object(map) => map
            .iter()
            .for_each(|(key, item)| collect(item, Some(key), texts, statuses)),
        Value::Number(_) | Value::Null | Value::Bool(_) => {}
    }
}

/// The 401 and 402 statuses `text` (lower-cased) names where an HTTP client
/// puts one: as its first word (`402 Payment Required`, the OpenAI SDK's
/// form), after `status`, `code` or `http` (`Request failed with status code
/// 402`, `HTTP 401`), or before the status's own reason phrase (`got 402
/// Payment Required`). A status is a whole word: `4021` and `x402y` are not.
fn statuses_in_text(text: &str) -> Vec<u64> {
    let words: Vec<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    words
        .iter()
        .enumerate()
        .filter_map(|(index, word)| {
            let status = match *word {
                "401" => 401,
                "402" => 402,
                _ => return None,
            };
            let reason: &[&str] = if status == 402 {
                &["payment", "required"]
            } else {
                &["unauthorized"]
            };
            let first = index == 0;
            let after_word = index > 0 && STATUS_WORDS.contains(&words[index - 1]);
            let before_reason = words[index + 1..].starts_with(reason);
            (first || after_word || before_reason).then_some(status)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_model_and_auth_commands_are_model_commands_in_any_case_and_spacing() {
        // As Qwen Code 0.26.1 parses a prompt: a leading `/` in the raw text, then the
        // first word after any JavaScript whitespace (U+FEFF included).
        for text in [
            "/model",
            "/model x",
            "/MODEL x",
            "/Model\tx",
            "/auth",
            "/Auth openai",
            "/login",
            "/CONNECT x",
            "/ model gpt-x hi",
            "/\tmodel x",
            "/\nmodel x",
            "/model\u{FEFF}gpt-x hi",
            "/\u{FEFF}model x",
            "/\u{00A0}auth",
            "/\u{3000}login x",
            "/model\u{2028}x",
        ] {
            assert!(is_model_command(text), "{text:?}");
        }
        for text in [
            "",
            "/",
            "/models",
            "/review",
            "model",
            "say /model",
            "/modelx",
            "/modeling",
            "/models/x.rs",
            "/model-x",
            "/authors",
            "  /model x",
            "\n/model x",
            "\u{FEFF}/model x",
            "/\u{85}model x",
        ] {
            assert!(!is_model_command(text), "{text:?}");
        }
    }

    #[test]
    fn model_options_are_the_model_id_and_those_reported_in_the_model_category() {
        let reported = model_option_ids(&json!([
            { "id": "Brain", "category": "model" },
            { "id": "effort", "category": "thought_level" },
            { "category": "model" },
        ]));

        assert_eq!(reported, ["brain"]);
        assert!(is_model_option("model", &[]));
        assert!(is_model_option("MODEL", &[]));
        assert!(is_model_option("brain", &reported));
        assert!(is_model_option("BRAIN", &reported));
        assert!(!is_model_option("effort", &reported));
        assert!(model_option_ids(&Value::Null).is_empty());
    }

    fn internal_error(details: &str) -> Value {
        json!({ "code": -32603, "message": "Internal error", "data": { "details": details } })
    }

    #[test]
    fn credits_used_up_is_empty() {
        let error = internal_error("402 api_key_limit_exceeded");

        assert_eq!(private_credits_reason(&error), Some("empty"));
    }

    #[test]
    fn a_refused_key_is_key() {
        let error = internal_error("401 Invalid or expired API key");

        assert_eq!(private_credits_reason(&error), Some("key"));
    }

    #[test]
    fn the_status_can_sit_in_the_message_or_in_data_text() {
        let in_message = json!({ "code": -32603, "message": "Request failed with status 402" });
        let in_data = json!({ "code": -32603, "message": "Internal error", "data": "HTTP 401" });
        let in_data_message = json!({ "data": { "message": "got 402\nPayment Required" } });

        assert_eq!(private_credits_reason(&in_message), Some("empty"));
        assert_eq!(private_credits_reason(&in_data), Some("key"));
        assert_eq!(private_credits_reason(&in_data_message), Some("empty"));
    }

    #[test]
    fn the_phrases_count_without_a_status() {
        let limit = json!({ "message": "Credit limit reached" });
        let low = json!({ "message": "Insufficient credits" });
        let bad_key = json!({ "message": "Invalid API key provided" });

        assert_eq!(private_credits_reason(&limit), Some("empty"));
        assert_eq!(private_credits_reason(&low), Some("empty"));
        assert_eq!(private_credits_reason(&bad_key), Some("key"));
    }

    #[test]
    fn a_number_inside_a_longer_word_or_number_is_not_a_status() {
        let longer = json!({ "message": "read 4021 tokens" });
        let glued = json!({ "message": "x402y" });
        let prefixed = json!({ "message": "error 1401" });

        assert_eq!(private_credits_reason(&longer), None);
        assert_eq!(private_credits_reason(&glued), None);
        assert_eq!(private_credits_reason(&prefixed), None);
    }

    #[test]
    fn a_status_number_in_prose_is_not_a_status() {
        for error in [
            internal_error("Tool failed: read 402 lines of issue 401"),
            json!({ "code": -32603, "message": "See RFC 402 and section 401 for details" }),
            json!({ "message": "Internal error", "data": "wrote 402 files, 401 left" }),
            json!({ "message": "Internal error", "data": { "tokens": 402, "lines": 401 } }),
        ] {
            assert_eq!(private_credits_reason(&error), None, "{error}");
        }
    }

    #[test]
    fn a_status_counts_where_qwen_and_http_libraries_put_it() {
        let cases = [
            (internal_error("402 Payment Required"), "empty"),
            (internal_error("401 status code (no body)"), "key"),
            (
                json!({ "message": "Request failed with status code 402" }),
                "empty",
            ),
            (
                json!({ "message": "Internal error", "data": "HTTP 401" }),
                "key",
            ),
            (json!({ "message": "Error: 402 Payment Required" }), "empty"),
            (
                json!({ "message": "upstream said 401 Unauthorized" }),
                "key",
            ),
            (
                json!({ "message": "Internal error", "data": { "status": 402 } }),
                "empty",
            ),
            (
                json!({ "message": "Internal error", "data": { "statusCode": 401 } }),
                "key",
            ),
        ];
        for (error, reason) in cases {
            assert_eq!(private_credits_reason(&error), Some(reason), "{error}");
        }
    }

    #[test]
    fn a_plain_internal_error_is_neither() {
        let error = json!({ "code": -32603, "message": "Internal error" });
        let detailed = internal_error("socket hang up");

        assert_eq!(private_credits_reason(&error), None);
        assert_eq!(private_credits_reason(&detailed), None);
    }

    #[test]
    fn empty_wins_when_both_statuses_appear() {
        let error = internal_error("401 after retry, then 402 api_key_limit_exceeded");

        assert_eq!(private_credits_reason(&error), Some("empty"));
    }

    #[test]
    fn a_value_that_is_not_an_error_is_never_read() {
        assert_eq!(private_credits_reason(&Value::Null), None);
        assert_eq!(private_credits_reason(&json!("402")), None);
        assert_eq!(private_credits_reason(&json!(402)), None);
    }

    #[test]
    fn the_error_text_is_the_exact_prefix_and_json() {
        let empty = internal_error("402 api_key_limit_exceeded");
        let key = internal_error("401 Invalid or expired API key");
        let other = internal_error("boom");

        assert_eq!(
            private_credits_error(&empty).as_deref(),
            Some("PRIVATE_CREDITS:{\"reason\":\"empty\"}")
        );
        assert_eq!(
            private_credits_error(&key).as_deref(),
            Some("PRIVATE_CREDITS:{\"reason\":\"key\"}")
        );
        assert_eq!(private_credits_error(&other), None);
    }
}
