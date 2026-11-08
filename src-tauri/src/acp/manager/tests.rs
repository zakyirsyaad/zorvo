use serde_json::json;

use super::*;

fn credits_error() -> Value {
    json!({ "code": -32603, "message": "Internal error",
            "data": { "details": "402 api_key_limit_exceeded" } })
}

fn init_with_methods() -> Value {
    json!({ "authMethods": [{ "id": "browser", "name": "Browser" }] })
}

#[test]
fn a_private_launch_reports_a_credit_refusal_of_a_session_request_as_private_credits() {
    for method in ["session/new", "session/load", "session/resume"] {
        let message = agent_error(method, &init_with_methods(), &credits_error(), true);

        assert_eq!(
            message, "PRIVATE_CREDITS:{\"reason\":\"empty\"}",
            "{method}"
        );
    }
}

#[test]
fn a_private_launch_reports_a_refused_key_as_the_key_reason() {
    let error = json!({ "code": -32603, "message": "Internal error",
                        "data": { "details": "401 Invalid or expired API key" } });

    let message = agent_error("session/new", &init_with_methods(), &error, true);

    assert_eq!(message, "PRIVATE_CREDITS:{\"reason\":\"key\"}");
}

/// An agent with no sign-in methods: since main's `-32603` rule, "api_key" in the
/// details reads as a sign-in for an agent that offers methods, whatever the launch.
#[test]
fn an_ordinary_launch_keeps_the_agents_error_text() {
    let message = agent_error("session/new", &json!({}), &credits_error(), false);

    assert_eq!(
        message,
        "session/new failed: Internal error (402 api_key_limit_exceeded)"
    );
}

#[test]
fn a_private_launch_keeps_the_old_rules_for_other_errors() {
    let sign_in = json!({ "code": -32000, "message": "Authentication required" });
    let plain = json!({ "code": -32603, "message": "Internal error" });

    let needs_sign_in = agent_error("session/new", &init_with_methods(), &sign_in, true);
    let failed = agent_error("session/new", &init_with_methods(), &plain, true);

    assert!(
        needs_sign_in.starts_with(AUTH_REQUIRED_PREFIX),
        "{needs_sign_in}"
    );
    assert_eq!(failed, "session/new failed: Internal error");
}

#[test]
fn debug_of_a_launch_shows_env_names_only_never_values() {
    let launch = AcpLaunch {
        program: "npx".to_string(),
        args: vec!["--acp".to_string()],
        env: vec![
            ("OPENAI_API_KEY".to_string(), "sk-secret".to_string()),
            ("PATH".to_string(), "/usr/bin".to_string()),
        ],
        private: true,
        mcp_servers: Vec::new(),
    };

    let text = format!("{launch:?} {launch:#?}");

    assert!(!text.contains("sk-secret"), "{text}");
    assert!(!text.contains("/usr/bin"), "{text}");
    assert!(text.contains("OPENAI_API_KEY"), "{text}");
    assert!(text.contains("npx") && text.contains("--acp"), "{text}");
    assert!(text.contains("private: true"), "{text}");
}

#[test]
fn a_credit_refusal_that_arrives_as_32000_is_not_a_sign_in_for_a_private_launch() {
    let error = json!({ "code": -32000, "message": "402 api_key_limit_exceeded" });

    let message = agent_error("session/new", &init_with_methods(), &error, true);

    assert_eq!(message, "PRIVATE_CREDITS:{\"reason\":\"empty\"}");
}
