//! Zorvo Private sessions: NEAR AI's credit and key refusals, which Qwen Code
//! reports as a `-32603` carrying the HTTP status, reach the UI as
//! `PRIVATE_CREDITS:{"reason":...}`. An ordinary session keeps the agent's own
//! error text, and every route that makes a session (start, reopen, fork)
//! keeps the privacy of the launch.

use zorvo_lib::acp::manager::{AcpEvent, AcpLaunch, AcpManager, ReopenPurpose};

use crate::common::{cwd, fake_agent_with, manager, wait_for};

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
        .start("p-1", &cwd(), &private_launch("402"))
        .unwrap();

    let error = turn_error(&manager, &rx, "p-1");

    assert_eq!(error, "PRIVATE_CREDITS:{\"reason\":\"empty\"}");
    manager.stop("p-1");
}

#[test]
fn a_private_session_whose_key_is_refused_ends_its_turn_with_the_key_reason() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("401"))
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
    manager.start("s-1", &cwd(), &launch).unwrap();

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
        .start("p-1", &cwd(), &private_launch("402"))
        .unwrap();
    manager.start("s-1", &cwd(), &fake_agent_with(&[])).unwrap();

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
        )
        .expect("import");

    assert!(manager.is_private_session("p-3"));
    manager.stop("p-3");
}

#[test]
fn a_native_fork_of_a_private_session_is_private() {
    let (manager, rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("401"))
        .unwrap();

    manager.fork("p-1", "p-2", &cwd()).expect("fork");

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
    manager.start("s-1", &cwd(), &fake_agent_with(&[])).unwrap();

    manager.fork("s-1", "s-2", &cwd()).expect("fork");

    assert!(!manager.is_private_session("s-2"));
    manager.stop("s-1");
    manager.stop("s-2");
}

#[test]
fn a_stopped_session_is_no_longer_private() {
    let (manager, _rx) = manager();
    manager
        .start("p-1", &cwd(), &private_launch("402"))
        .unwrap();

    manager.stop("p-1");

    assert!(!manager.is_private_session("p-1"));
}
