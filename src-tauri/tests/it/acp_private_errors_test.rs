//! Zorvo Private sessions: NEAR AI's credit and key refusals, which Qwen Code
//! reports as a `-32603` carrying the HTTP status, reach the UI as
//! `PRIVATE_CREDITS:{"reason":...}`. An ordinary session keeps the agent's own
//! error text, and every route that makes a session (start, reopen, fork)
//! keeps the privacy of the launch.

use zorvo_lib::acp::manager::{AcpEvent, AcpLaunch, AcpManager, ReopenPurpose};

use crate::common::{agent_text, called_methods, cwd, fake_agent_with, manager, wait_for};

/// The fake agent as a private launch, refusing every prompt with the given
/// NEAR AI status (`"402"` or `"401"`).
fn private_launch(status: &str) -> AcpLaunch {
    AcpLaunch {
        private: true,
        ..fake_agent_with(&[("FAKE_ACP_PRIVATE_ERROR", status)])
    }
}

/// The error the next turn of `session_id` ends with.
fn turn_error(
    manager: &AcpManager,
    rx: &std::sync::mpsc::Receiver<AcpEvent>,
    session_id: &str,
) -> String {
    manager.prompt(session_id, "hello", &[]).unwrap();
    let ended = wait_for(rx, |e| matches!(e, AcpEvent::TurnEnded { .. }));
    let AcpEvent::TurnEnded {
        stop_reason: Err(error),
        ..
    } = ended
    else {
        panic!("expected a failed turn, got {ended:?}");
    };
    error
}

#[test]
fn a_private_session_out_of_credits_ends_its_turn_with_the_empty_reason() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("402"), serde_json::json!([]))
        .unwrap();

    let error = turn_error(&manager, &rx, "p-1");

    assert_eq!(error, "PRIVATE_CREDITS:{\"reason\":\"empty\"}");
    manager.stop("p-1");
}

#[test]
fn a_private_session_whose_key_is_refused_ends_its_turn_with_the_key_reason() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("401"), serde_json::json!([]))
        .unwrap();

    let error = turn_error(&manager, &rx, "p-1");

    assert_eq!(error, "PRIVATE_CREDITS:{\"reason\":\"key\"}");
    manager.stop("p-1");
}

/// The agent offers no sign-in method here: since main's `-32603` rule, "api_key" in the
/// details reads as a sign-in for an agent that offers one, whatever the launch.
#[test]
fn the_same_agent_launched_without_privacy_keeps_its_own_error_text() {
    let (manager, rx) = manager();
    let launch = fake_agent_with(&[
        ("FAKE_ACP_PRIVATE_ERROR", "402"),
        ("FAKE_ACP_NO_AUTH_METHODS", "1"),
    ]);
    assert!(!launch.private);
    manager
        .start("s-1", &cwd(), &launch, serde_json::json!([]))
        .unwrap();

    let error = turn_error(&manager, &rx, "s-1");

    assert!(!error.starts_with("PRIVATE_CREDITS:"), "{error}");
    assert!(error.starts_with("Internal error"), "{error}");
    assert!(error.contains("402 api_key_limit_exceeded"), "{error}");
    manager.stop("s-1");
}

#[test]
fn only_sessions_started_from_a_private_launch_are_private() {
    let (manager, _rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("402"), serde_json::json!([]))
        .unwrap();
    manager
        .start("s-1", &cwd(), &fake_agent_with(&[]), serde_json::json!([]))
        .unwrap();

    assert!(manager.is_private_session("p-1"));
    assert!(!manager.is_private_session("s-1"));
    assert!(!manager.is_private_session("unknown"));
    manager.stop("p-1");
    manager.stop("s-1");
}

#[test]
fn a_reopened_private_session_is_private_and_reports_credits_too() {
    let (manager, rx) = manager();

    manager
        .reopen(
            "p-2",
            &cwd(),
            &private_launch("402"),
            "fake-earlier",
            ReopenPurpose::Continue,
            serde_json::json!([]),
        )
        .expect("reopen");

    assert!(manager.is_private_session("p-2"));
    assert_eq!(
        turn_error(&manager, &rx, "p-2"),
        "PRIVATE_CREDITS:{\"reason\":\"empty\"}"
    );
    manager.stop("p-2");
}

#[test]
fn an_imported_private_session_is_private() {
    let (manager, _rx) = manager();

    manager
        .reopen(
            "p-3",
            &cwd(),
            &private_launch("402"),
            "fake-earlier",
            ReopenPurpose::Import,
            serde_json::json!([]),
        )
        .expect("import");

    assert!(manager.is_private_session("p-3"));
    manager.stop("p-3");
}

#[test]
fn a_native_fork_of_a_private_session_is_private() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("401"), serde_json::json!([]))
        .unwrap();

    manager
        .fork("p-1", "p-2", &cwd(), serde_json::json!([]))
        .expect("fork");

    assert!(manager.is_private_session("p-2"));
    assert_eq!(
        turn_error(&manager, &rx, "p-2"),
        "PRIVATE_CREDITS:{\"reason\":\"key\"}"
    );
    manager.stop("p-1");
    manager.stop("p-2");
}

#[test]
fn a_native_fork_of_an_ordinary_session_is_not_private() {
    let (manager, _rx) = manager();
    manager
        .start("s-1", &cwd(), &fake_agent_with(&[]), serde_json::json!([]))
        .unwrap();

    manager
        .fork("s-1", "s-2", &cwd(), serde_json::json!([]))
        .expect("fork");

    assert!(!manager.is_private_session("s-2"));
    manager.stop("s-1");
    manager.stop("s-2");
}

#[test]
fn a_stopped_session_is_no_longer_private() {
    let (manager, _rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("402"), serde_json::json!([]))
        .unwrap();

    manager.stop("p-1");

    assert!(!manager.is_private_session("p-1"));
}

/// A file the fake agent appends every method it receives to, fresh for `name`.
fn call_log(name: &str) -> std::path::PathBuf {
    let path =
        std::env::temp_dir().join(format!("zorvo-private-{name}-{}.log", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

fn logged_private_launch(log: &std::path::Path) -> AcpLaunch {
    AcpLaunch {
        private: true,
        ..fake_agent_with(&[("FAKE_ACP_CALL_LOG", log.to_str().unwrap())])
    }
}

#[test]
fn a_private_session_refuses_the_model_and_auth_commands_before_the_agent_sees_them() {
    let (manager, _rx) = manager();
    let log = call_log("model-command");
    manager
        .start(
            "p-1",
            &cwd(),
            &logged_private_launch(&log),
            serde_json::json!([]),
        )
        .unwrap();

    for text in [
        "/model openai:gpt-4o",
        "/model",
        "/MODEL x",
        "/Model\tx",
        "/auth",
        "/AUTH openai",
        "/login",
        "/connect x",
        "/ model gpt-x hi",
        "/\tmodel x",
        "/\nmodel x",
        "/model\u{FEFF}gpt-x hi",
        "/\u{FEFF}model x",
        "/\u{00A0}auth",
        "/\u{3000}login x",
        "/model\u{2028}x",
    ] {
        let result = manager.prompt("p-1", text, &[]);

        assert_eq!(result, Err("model_locked".to_string()), "{text:?}");
    }
    assert!(
        !called_methods(&log).contains(&"session/prompt".to_string()),
        "{:?}",
        called_methods(&log)
    );
    manager.stop("p-1");
}

#[test]
fn a_private_session_still_sends_other_commands_and_text_that_mentions_model() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("402"), serde_json::json!([]))
        .unwrap();

    for text in [
        "/review",
        "/models",
        "explain /model to me",
        "/modeling",
        "/models/x.rs",
        "/model-x",
        // Qwen Code reads a slash command only at the very start of the raw text.
        "  /model x",
        "\n/model x",
    ] {
        assert_eq!(manager.prompt("p-1", text, &[]), Ok(()), "{text:?}");
        wait_for(&rx, |e| matches!(e, AcpEvent::TurnEnded { .. }));
    }
    manager.stop("p-1");
}

#[test]
fn an_ordinary_session_sends_the_model_command_to_its_agent() {
    let (manager, rx) = manager();
    manager
        .start("s-1", &cwd(), &fake_agent_with(&[]), serde_json::json!([]))
        .unwrap();

    assert_eq!(manager.prompt("s-1", "/model smart", &[]), Ok(()));
    wait_for(&rx, |e| matches!(e, AcpEvent::TurnEnded { .. }));
    manager.stop("s-1");
}

#[test]
fn a_private_session_refuses_a_model_change_by_set_model_or_the_model_option() {
    let (manager, _rx) = manager();
    let log = call_log("set-model");
    manager
        .start(
            "p-1",
            &cwd(),
            &logged_private_launch(&log),
            serde_json::json!([]),
        )
        .unwrap();

    let by_set_model = manager.set_model("p-1", "smart");
    let by_option = manager.set_config_option("p-1", "model", "smart");
    let by_option_case = manager.set_config_option("p-1", "MODEL", "smart");

    assert_eq!(by_set_model, Err("model_locked".to_string()));
    assert_eq!(by_option, Err("model_locked".to_string()));
    assert_eq!(by_option_case, Err("model_locked".to_string()));
    let methods = called_methods(&log);
    assert!(
        !methods.contains(&"session/set_model".to_string()),
        "{methods:?}"
    );
    assert!(
        !methods.contains(&"session/set_config_option".to_string()),
        "{methods:?}"
    );
    manager.stop("p-1");
}

#[test]
fn a_private_session_still_sends_other_config_options() {
    let (manager, _rx) = manager();
    let log = call_log("set-effort");
    manager
        .start(
            "p-1",
            &cwd(),
            &logged_private_launch(&log),
            serde_json::json!([]),
        )
        .unwrap();

    // The fake agent does not know the method: what matters is that it was asked.
    let result = manager.set_config_option("p-1", "effort", "high");

    assert_ne!(result, Err("model_locked".to_string()));
    assert!(called_methods(&log).contains(&"session/set_config_option".to_string()));
    manager.stop("p-1");
}

#[test]
fn an_ordinary_session_sends_model_changes_to_its_agent() {
    let (manager, _rx) = manager();
    let log = call_log("plain-set-model");
    let launch = fake_agent_with(&[
        ("FAKE_ACP_MODELS", "1"),
        ("FAKE_ACP_CALL_LOG", log.to_str().unwrap()),
    ]);
    manager
        .start("s-1", &cwd(), &launch, serde_json::json!([]))
        .unwrap();

    let by_option = manager.set_config_option("s-1", "model", "smart");

    assert_ne!(by_option, Err("model_locked".to_string()));
    assert!(called_methods(&log).contains(&"session/set_config_option".to_string()));
    manager.stop("s-1");
}

const EMPTY: &str = "PRIVATE_CREDITS:{\"reason\":\"empty\"}";
const KEY: &str = "PRIVATE_CREDITS:{\"reason\":\"key\"}";

/// A private launch of the fake agent that refuses `methods` (comma-separated)
/// with the given NEAR AI status, as Qwen Code reports it. It offers
/// `session/resume` too, so a Continue resumes.
fn refusing_private_launch(status: &str, methods: &str) -> AcpLaunch {
    AcpLaunch {
        private: true,
        ..fake_agent_with(&[
            ("FAKE_ACP_PRIVATE_ERROR", status),
            ("FAKE_ACP_PRIVATE_REFUSE", methods),
            ("FAKE_ACP_RESUME", "1"),
        ])
    }
}

#[test]
fn a_private_session_refused_by_session_new_reads_as_credits() {
    let (manager, _rx) = manager();

    let empty = manager.start(
        "p-1",
        &cwd(),
        &refusing_private_launch("402", "session/new"),
        serde_json::json!([]),
    );
    let key = manager.start(
        "p-2",
        &cwd(),
        &refusing_private_launch("401", "session/new"),
        serde_json::json!([]),
    );

    assert_eq!(empty.err().as_deref(), Some(EMPTY));
    assert_eq!(key.err().as_deref(), Some(KEY));
}

#[test]
fn a_private_session_refused_by_session_load_or_resume_reads_as_credits() {
    let (manager, _rx) = manager();

    let loaded = manager.reopen(
        "p-1",
        &cwd(),
        &refusing_private_launch("402", "session/load"),
        "fake-earlier",
        ReopenPurpose::Import,
        serde_json::json!([]),
    );
    let resumed = manager.reopen(
        "p-2",
        &cwd(),
        &refusing_private_launch("401", "session/resume"),
        "fake-earlier",
        ReopenPurpose::Continue,
        serde_json::json!([]),
    );

    assert_eq!(loaded.err().as_deref(), Some(EMPTY));
    assert_eq!(resumed.err().as_deref(), Some(KEY));
}

#[test]
fn the_same_open_refusal_of_an_ordinary_session_keeps_its_own_text() {
    let (manager, _rx) = manager();
    let launch = fake_agent_with(&[
        ("FAKE_ACP_PRIVATE_ERROR", "402"),
        ("FAKE_ACP_PRIVATE_REFUSE", "session/new"),
        ("FAKE_ACP_NO_AUTH_METHODS", "1"),
    ]);

    let error = manager
        .start("s-1", &cwd(), &launch, serde_json::json!([]))
        .expect_err("refused");

    assert!(!error.starts_with("PRIVATE_CREDITS:"), "{error}");
    assert!(error.contains("402 api_key_limit_exceeded"), "{error}");
}

#[test]
fn a_fork_of_a_private_session_refused_for_credits_reads_as_credits() {
    let (manager, _rx) = manager();
    manager
        .start(
            "p-1",
            &cwd(),
            &refusing_private_launch("402", "session/fork"),
            serde_json::json!([]),
        )
        .unwrap();

    let forked = manager.fork("p-1", "p-2", &cwd(), serde_json::json!([]));

    assert_eq!(forked.err().as_deref(), Some(EMPTY));
    assert!(!manager.is_private_session("p-2"));
    manager.stop("p-1");
}

#[test]
fn a_refused_fork_of_an_ordinary_session_keeps_its_own_text() {
    let (manager, _rx) = manager();
    let launch = fake_agent_with(&[
        ("FAKE_ACP_PRIVATE_ERROR", "402"),
        ("FAKE_ACP_PRIVATE_REFUSE", "session/fork"),
    ]);
    manager
        .start("s-1", &cwd(), &launch, serde_json::json!([]))
        .unwrap();

    let error = manager
        .fork("s-1", "s-2", &cwd(), serde_json::json!([]))
        .expect_err("refused");

    assert!(error.starts_with("session/fork failed: "), "{error}");
    manager.stop("s-1");
}

#[test]
fn a_private_session_sends_a_model_command_after_leading_spaces_as_a_prompt() {
    let (manager, rx) = manager();
    let log = call_log("spaced-model");
    manager
        .start(
            "p-1",
            &cwd(),
            &logged_private_launch(&log),
            serde_json::json!([]),
        )
        .unwrap();

    assert_eq!(manager.prompt("p-1", "  /model x", &[]), Ok(()));

    let echoed = wait_for(&rx, |e| agent_text(e).is_some());
    assert_eq!(agent_text(&echoed).as_deref(), Some("echo:   /model x"));
    wait_for(&rx, |e| matches!(e, AcpEvent::TurnEnded { .. }));
    assert!(called_methods(&log).contains(&"session/prompt".to_string()));
    manager.stop("p-1");
}
