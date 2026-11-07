//! Whether an agent's refusal is a request to sign in.

use serde_json::Value;

/// ACP's "authentication required" error code.
const AUTH_REQUIRED: i64 = -32000;
/// JSON-RPC's "internal error", which GLM Agent answers a prompt with when it has no API key.
const INTERNAL_ERROR: i64 = -32603;

/// Words that make a refusal's message one about signing in, once everything but
/// letters is dropped: "Not logged in", "log-in", "signed in", "API key is
/// missing" (Gemini CLI) and "No credentials" all match.
const SIGN_IN_WORDS: [&str; 7] = [
    "auth",
    "login",
    "loggedin",
    "signin",
    "signedin",
    "apikey",
    "credential",
];

/// Whether an agent's refusal says it needs a sign-in. ACP's code for that is `-32000`
/// ("Authentication required"), but it does not fix the message, and the code is also
/// JSON-RPC's generic server error. So an answer counts when its message is about
/// signing in, or when the agent offers sign-in methods (`offers_sign_in`) and the
/// refusal is of a request ACP says may fail for want of one: a session that cannot
/// open, or a prompt. Gemini CLI, for one, words it "API key is missing".
///
/// GLM Agent opens sessions without a key and fails the first prompt with `-32603`
/// ("Internal error"), naming the key only in `data.details`. That code means nothing
/// by itself, so such a refusal counts only when the agent offers methods for the
/// request (`offers_sign_in`) and its message, a text `data`, `data.details` or
/// `data.message` has a whole sign-in word or phrase (`mentions_sign_in_phrase`).
pub(super) fn is_auth_required(error: &Value, offers_sign_in: bool) -> bool {
    match error["code"].as_i64() {
        Some(AUTH_REQUIRED) => offers_sign_in || mentions_sign_in(&error["message"]),
        Some(INTERNAL_ERROR) => {
            offers_sign_in
                && [
                    &error["message"],
                    &error["data"],
                    &error["data"]["details"],
                    &error["data"]["message"],
                ]
                .into_iter()
                .any(mentions_sign_in_phrase)
        }
        _ => false,
    }
}

/// Whether `text` (a JSON string; anything else never does) has a sign-in word.
fn mentions_sign_in(text: &Value) -> bool {
    // Letters only, so spacing and punctuation do not matter.
    let letters: String = text
        .as_str()
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphabetic)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    SIGN_IN_WORDS.iter().any(|word| letters.contains(word))
}

/// Single words that are about signing in (compared to whole words, in lower case).
const SIGN_IN_WHOLE_WORDS: [&str; 15] = [
    "auth",
    "authenticate",
    "authenticated",
    "authentication",
    "authorization",
    "unauthenticated",
    "unauthorized",
    "login",
    "signin",
    "loggedin",
    "signedin",
    "apikey",
    "apikeys",
    "credential",
    "credentials",
];

/// Two words in a row that are about signing in: "log in", "signed in", "API key".
const SIGN_IN_PHRASES: [(&str, &str); 6] = [
    ("log", "in"),
    ("logged", "in"),
    ("sign", "in"),
    ("signed", "in"),
    ("api", "key"),
    ("api", "keys"),
];

/// Whether `text` (a JSON string; anything else never does) says it is about signing in, by
/// whole words and phrases. A `-32603` is JSON-RPC's generic internal error, so its free text
/// (a stack, a path, a sentence about something else) is read more strictly than a `-32000`
/// message: "designing" holds "signin", and "catalog in" joins to "login", but neither is one.
/// Words are the runs of letters, so "Z_AI_API_KEY", "log-in" and "apiKey" all match.
fn mentions_sign_in_phrase(text: &Value) -> bool {
    let lower = text.as_str().unwrap_or_default().to_ascii_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|word| !word.is_empty())
        .collect();
    words.iter().any(|word| SIGN_IN_WHOLE_WORDS.contains(word))
        || words.windows(2).any(|pair| {
            SIGN_IN_PHRASES
                .iter()
                .any(|(first, second)| pair[0] == *first && pair[1] == *second)
        })
}

/// Whether `auth_methods` (from `initialize`) lists at least one way to sign in.
pub(super) fn offers_sign_in(auth_methods: &Value) -> bool {
    auth_methods
        .as_array()
        .is_some_and(|methods| !methods.is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// What `glm-acp-agent@1.15.0` answers the first prompt with when `Z_AI_API_KEY` is unset.
    fn glm_refusal() -> Value {
        json!({
            "code": -32603,
            "message": "Internal error",
            "data": {
                "details": "No API key found. Set the Z_AI_API_KEY environment variable, or run `glm-acp-agent --setup` to store one."
            }
        })
    }

    #[test]
    fn counts_glms_missing_key_refusal_when_the_agent_offers_methods() {
        assert!(is_auth_required(&glm_refusal(), true));
    }

    #[test]
    fn counts_a_32603_whose_data_message_names_the_sign_in() {
        let error = json!({
            "code": -32603,
            "message": "Internal error",
            "data": { "message": "Not logged in" }
        });

        assert!(is_auth_required(&error, true));
    }

    #[test]
    fn counts_a_32603_whose_own_message_names_the_sign_in() {
        let error = json!({ "code": -32603, "message": "Invalid API key" });

        assert!(is_auth_required(&error, true));
    }

    #[test]
    fn counts_a_32603_whose_data_is_the_text_naming_the_sign_in() {
        let error =
            json!({ "code": -32603, "message": "Internal error", "data": "No API key found" });

        assert!(is_auth_required(&error, true));
    }

    /// `agent_error` only lets the agent's offered methods count for a request that opens a
    /// session, so a `-32603` from `session/list` stays a plain failure.
    #[test]
    fn reads_a_32603_refusal_to_open_a_session_as_a_sign_in_but_not_a_listing() {
        let init = json!({ "authMethods": [{ "id": "z-ai-api-key", "name": "Z.AI API key" }] });

        for method in ["session/new", "session/load", "session/resume"] {
            let error = super::super::agent_error(method, &init, &glm_refusal());
            assert!(
                error.starts_with(super::super::AUTH_REQUIRED_PREFIX),
                "{method}: {error}"
            );
        }
        let listing = super::super::agent_error("session/list", &init, &glm_refusal());
        assert!(
            !listing.starts_with(super::super::AUTH_REQUIRED_PREFIX),
            "{listing}"
        );
    }

    #[test]
    fn ignores_a_32603_without_a_sign_in_word() {
        let error = json!({
            "code": -32603,
            "message": "Internal error",
            "data": { "details": "Cannot read properties of undefined" }
        });

        assert!(!is_auth_required(&error, true));
    }

    /// A sign-in word inside another word, or split across two words that merely meet, is
    /// not about signing in: "designing" holds "signin", "catalog in" joins to "login".
    #[test]
    fn ignores_a_32603_whose_sign_in_word_is_part_of_another_word_or_phrase() {
        for details in [
            "Error designing the plan",
            "Cannot find catalog in registry",
            "Failed to assign index to the list",
            "author.txt not found",
            "The authority of this file is unclear",
            "Designed in Figma",
            "Unexpected token while processing the dialog in the UI",
        ] {
            let error = json!({
                "code": -32603,
                "message": "Internal error",
                "data": { "details": details }
            });

            assert!(
                !is_auth_required(&error, true),
                "{details:?} was read as a sign-in"
            );
        }
    }

    /// Whole words and phrases still count, however the agent spaces or cases them.
    #[test]
    fn counts_a_32603_with_a_sign_in_word_or_phrase_however_it_is_written() {
        for details in [
            "No API key found. Set the Z_AI_API_KEY environment variable.",
            "Missing apiKey",
            "API-KEY is invalid",
            "Not logged in",
            "You must be signed in",
            "Please log-in first",
            "Login required",
            "No credentials found",
            "Authentication failed",
            "401 Unauthorized",
            "auth token expired",
        ] {
            let error = json!({
                "code": -32603,
                "message": "Internal error",
                "data": { "details": details }
            });

            assert!(
                is_auth_required(&error, true),
                "{details:?} was not read as a sign-in"
            );
        }
    }

    #[test]
    fn ignores_a_32603_with_no_details_at_all() {
        let error = json!({ "code": -32603, "message": "Internal error" });

        assert!(!is_auth_required(&error, true));
    }

    #[test]
    fn ignores_a_32603_from_an_agent_that_offers_no_methods() {
        assert!(!is_auth_required(&glm_refusal(), false));
    }

    #[test]
    fn ignores_details_that_are_not_text() {
        let error = json!({
            "code": -32603,
            "message": "Internal error",
            "data": { "details": { "hint": "No API key found" } }
        });

        assert!(!is_auth_required(&error, true));
    }

    #[test]
    fn ignores_other_codes_even_with_a_sign_in_word() {
        let error = json!({
            "code": -32602,
            "message": "Internal error",
            "data": { "details": "No API key found" }
        });

        assert!(!is_auth_required(&error, true));
    }

    #[test]
    fn keeps_the_32000_rules() {
        let plain = json!({ "code": -32000, "message": "Internal error: disk full" });
        let worded = json!({ "code": -32000, "message": "Not logged in" });
        // A 32000 reads its message only: the sign-in word in `data.details` is not enough.
        let hidden = json!({
            "code": -32000,
            "message": "Internal error",
            "data": { "details": "No API key found" }
        });

        assert!(is_auth_required(&plain, true));
        assert!(!is_auth_required(&plain, false));
        assert!(is_auth_required(&worded, false));
        assert!(!is_auth_required(&hidden, false));
    }

    #[test]
    fn offers_sign_in_only_for_a_non_empty_method_list() {
        assert!(offers_sign_in(&json!([{ "id": "z-ai-api-key" }])));
        assert!(!offers_sign_in(&json!([])));
        assert!(!offers_sign_in(&Value::Null));
    }
}
