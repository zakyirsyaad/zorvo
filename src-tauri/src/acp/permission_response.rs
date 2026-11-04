//! The answer to a `session/request_permission`, with the typed answers of
//! Qwen Code's `ask_user_question` tool.
//!
//! Standard ACP answers a permission request with an `outcome` only. Qwen Code's
//! `ask_user_question` is a permission request whose response may also carry a
//! top-level `answers` object: the keys are the question numbers as decimal
//! strings ("0", "1", ...) and the values are the answers as text (a multi-select
//! question's picks joined with ", "). The UI sends the typed answers; this is
//! where they are checked and the response is built, so the webview never builds
//! JSON-RPC. Error messages never repeat a typed value.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// `ask_user_question` takes one to four questions.
pub const MAX_ANSWERS: usize = 4;
/// The longest answer, in characters. Qwen Code keeps at most 8000 characters of
/// answers per call, so four answers of this size still fit.
pub const MAX_ANSWER_CHARS: usize = 2000;

/// Checks the answers and returns them as the `answers` object of a response.
fn answers_object(answers: &BTreeMap<String, String>) -> Result<Value, String> {
    if answers.len() > MAX_ANSWERS {
        return Err(format!("At most {MAX_ANSWERS} answers can be sent."));
    }
    let mut object = Map::new();
    for (key, value) in answers {
        let is_question_number = (0..MAX_ANSWERS).any(|n| n.to_string() == *key);
        if !is_question_number {
            return Err("An answer is not for a question number from 0 to 3.".to_string());
        }
        if value.trim().is_empty() {
            return Err(format!("The answer to question {key} is empty."));
        }
        if value.chars().count() > MAX_ANSWER_CHARS {
            return Err(format!(
                "The answer to question {key} is longer than {MAX_ANSWER_CHARS} characters."
            ));
        }
        object.insert(key.clone(), Value::String(value.clone()));
    }
    Ok(Value::Object(object))
}

/// The result of `session/request_permission`: `option_id` picks one of the
/// agent's options (`None` cancels the request). `answers`, when given, go next
/// to the outcome; they only make sense with a picked option.
pub fn permission_response(
    option_id: Option<&str>,
    answers: Option<&BTreeMap<String, String>>,
) -> Result<Value, String> {
    let outcome = match option_id {
        Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
        None => json!({ "outcome": "cancelled" }),
    };
    let mut response = json!({ "outcome": outcome });
    let Some(answers) = answers.filter(|answers| !answers.is_empty()) else {
        return Ok(response);
    };
    if option_id.is_none() {
        return Err("A cancelled request takes no answers.".to_string());
    }
    response["answers"] = answers_object(answers)?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answers(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn a_plain_answer_carries_only_the_outcome() {
        let response = permission_response(Some("allow"), None).unwrap();
        assert_eq!(
            response,
            json!({ "outcome": { "outcome": "selected", "optionId": "allow" } })
        );
    }

    #[test]
    fn a_cancelled_answer_carries_only_the_outcome() {
        let response = permission_response(None, None).unwrap();
        assert_eq!(response, json!({ "outcome": { "outcome": "cancelled" } }));
    }

    #[test]
    fn answers_go_next_to_the_outcome() {
        let sent = answers(&[("0", "Blue, Green"), ("1", "Something else")]);
        let response = permission_response(Some("proceed_once"), Some(&sent)).unwrap();
        assert_eq!(
            response,
            json!({
                "outcome": { "outcome": "selected", "optionId": "proceed_once" },
                "answers": { "0": "Blue, Green", "1": "Something else" },
            })
        );
    }

    #[test]
    fn no_answers_at_all_leaves_the_response_plain() {
        let none = BTreeMap::new();
        let response = permission_response(Some("allow"), Some(&none)).unwrap();
        assert!(response.get("answers").is_none());
    }

    #[test]
    fn four_answers_are_accepted() {
        let sent = answers(&[("0", "a"), ("1", "b"), ("2", "c"), ("3", "d")]);
        assert!(permission_response(Some("allow"), Some(&sent)).is_ok());
    }

    #[test]
    fn a_fifth_answer_is_refused() {
        let sent = answers(&[("0", "a"), ("1", "b"), ("2", "c"), ("3", "d"), ("4", "e")]);
        assert!(permission_response(Some("allow"), Some(&sent)).is_err());
    }

    #[test]
    fn keys_that_are_not_question_numbers_are_refused() {
        for key in ["4", "-1", "01", "1.0", " 1", "one", ""] {
            let sent = answers(&[(key, "a")]);
            assert!(
                permission_response(Some("allow"), Some(&sent)).is_err(),
                "key {key:?} should be refused"
            );
        }
    }

    #[test]
    fn an_empty_or_blank_answer_is_refused() {
        for value in ["", "   ", "\n"] {
            let sent = answers(&[("0", value)]);
            assert!(permission_response(Some("allow"), Some(&sent)).is_err());
        }
    }

    #[test]
    fn an_answer_over_the_cap_is_refused_and_one_at_the_cap_is_not() {
        let at_cap = "é".repeat(MAX_ANSWER_CHARS);
        let over_cap = "é".repeat(MAX_ANSWER_CHARS + 1);
        assert!(permission_response(Some("allow"), Some(&answers(&[("0", &at_cap)]))).is_ok());
        assert!(permission_response(Some("allow"), Some(&answers(&[("0", &over_cap)]))).is_err());
    }

    #[test]
    fn answers_cannot_ride_on_a_cancelled_request() {
        let sent = answers(&[("0", "a")]);
        assert!(permission_response(None, Some(&sent)).is_err());
    }

    #[test]
    fn an_error_never_repeats_the_typed_answer() {
        let secret = "hunter2".repeat(400);
        let sent = answers(&[("0", &secret), ("9", "x")]);
        let error = permission_response(Some("allow"), Some(&sent)).unwrap_err();
        assert!(!error.contains("hunter2"));
        let sent = answers(&[("0", &secret)]);
        let error = permission_response(Some("allow"), Some(&sent)).unwrap_err();
        assert!(!error.contains("hunter2"));
    }
}
