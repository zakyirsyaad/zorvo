//! Turns NEAR AI's credit and key refusals, as Qwen Code reports them, into
//! the error the UI reads for a Zorvo Private session.

use serde_json::Value;

use crate::private_mode::PRIVATE_CREDITS_PREFIX;

/// Why a private session's request was refused, as `PRIVATE_CREDITS:` carries
/// it: `"empty"` when the credits are used up (HTTP 402), `"key"` when NEAR AI
/// refused the key (HTTP 401). `None` for any other error.
///
/// Qwen Code reports the HTTP status inside a JSON-RPC `-32603`, in whichever
/// of `message`, `data` or `data.details` it likes, so every text the error
/// holds is read. A status counts as a whole word (`4021` and `x402y` are
/// not 402), and `empty` wins when both appear.
pub(super) fn private_credits_reason(error: &Value) -> Option<&'static str> {
    if !error.is_object() {
        return None;
    }
    let mut text = String::new();
    collect_text(error, &mut text);
    let text = text.to_lowercase();
    let has_token = |wanted: &str| {
        text.split(|c: char| !c.is_alphanumeric())
            .any(|token| token == wanted)
    };
    if text.contains("api_key_limit_exceeded")
        || has_token("402")
        || text.contains("insufficient credit")
        || text.contains("credit limit")
    {
        Some("empty")
    } else if has_token("401")
        || text.contains("invalid or expired api key")
        || text.contains("invalid api key")
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

/// Appends every string and number in `value` to `out`, each after a space,
/// so no word runs into the next one (reading the JSON text instead would
/// glue an escape such as `\n` to the word after it).
fn collect_text(value: &Value, out: &mut String) {
    match value {
        Value::String(text) => {
            out.push(' ');
            out.push_str(text);
        }
        Value::Number(number) => {
            out.push(' ');
            out.push_str(&number.to_string());
        }
        Value::Array(items) => items.iter().for_each(|item| collect_text(item, out)),
        Value::Object(map) => map.values().for_each(|item| collect_text(item, out)),
        Value::Null | Value::Bool(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

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
