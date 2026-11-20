//! The spawn path that disclaims macOS responsibility (computer use spec §1).
//! Its own test binary: `spawn::set_trampoline` sets process-wide state for
//! good, which would change how every other integration test spawns.
//!
//! Every test sets the trampoline to the real `zorvo` binary, which cargo
//! builds for integration tests, so the `disclaim-exec` mode is exercised as
//! the app runs it.

#![cfg(target_os = "macos")]
#![allow(clippy::disallowed_methods)] // the test reads `ps` directly

use std::time::Duration;
use zorvo_lib::spawn;

#[path = "it/common/mod.rs"]
#[allow(dead_code)] // shared with the main test binary; this one uses two helpers
mod common;

/// Waits until `pid` runs `program` (the trampoline has exec'd), at most 5 s.
fn wait_for_exec(pid: u32, program: &str) {
    for _ in 0..50 {
        let output = std::process::Command::new("/bin/ps")
            .args(["-o", "comm=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        if String::from_utf8_lossy(&output.stdout).trim() == program {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("{pid} never became {program}");
}

fn use_trampoline() {
    spawn::set_trampoline(env!("CARGO_BIN_EXE_zorvo").into());
}

#[test]
fn trampoline_runs_the_program_with_its_arguments() {
    use_trampoline();
    let output = spawn::command("/bin/echo").arg("a b").output().unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "a b\n");
}

#[test]
fn exit_status_passes_through() {
    use_trampoline();
    let status = spawn::command("/bin/sh")
        .args(["-c", "exit 7"])
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(7));
}

#[test]
fn program_through_the_trampoline_is_its_own_responsible_process() {
    use_trampoline();
    let mut child = spawn::command("/bin/sleep").arg("5").spawn().unwrap();
    wait_for_exec(child.id(), "/bin/sleep");
    let pid = child.id() as i32;
    let responsible = spawn::responsible_pid(pid);
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(responsible, Some(pid));
}

#[test]
fn driver_command_is_not_disclaimed() {
    use_trampoline();
    let mut child = spawn::driver_command("/bin/sleep")
        .arg("5")
        .spawn()
        .unwrap();
    wait_for_exec(child.id(), "/bin/sleep");
    let pid = child.id() as i32;
    let responsible = spawn::responsible_pid(pid);
    let _ = child.kill();
    let _ = child.wait();
    assert_ne!(responsible, Some(pid));
}

#[test]
fn pty_command_goes_through_the_trampoline() {
    use_trampoline();
    let command = spawn::pty_command("/bin/echo");
    let argv: Vec<String> = command
        .get_argv()
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert_eq!(argv[0], env!("CARGO_BIN_EXE_zorvo"));
    assert_eq!(&argv[1..], ["disclaim-exec", "--", "/bin/echo"]);
}

#[test]
fn acp_agent_is_disclaimed() {
    use std::sync::Arc;
    use zorvo_lib::acp::connection::{AcpConnection, EventSink};

    use_trampoline();
    let launch = common::fake_agent();
    let connection = AcpConnection::spawn(
        &launch.program,
        &launch.args,
        &common::cwd(),
        &[],
        |_| -> EventSink { Arc::new(|_| {}) },
    )
    .unwrap();
    let pid = connection.pid().unwrap();
    wait_for_exec(pid, "node");
    let responsible = spawn::responsible_pid(pid as i32);
    connection.kill();
    assert_eq!(responsible, Some(pid as i32));
}

fn spawn_agent(program: &str) -> Result<(), String> {
    use std::sync::Arc;
    use zorvo_lib::acp::connection::{AcpConnection, EventSink};
    AcpConnection::spawn(program, &[], &common::cwd(), &[], |_| -> EventSink {
        Arc::new(|_| {})
    })
    .map(|connection| connection.kill())
}

#[test]
fn missing_agent_path_fails_at_spawn() {
    use_trampoline();
    let error = spawn_agent("/nonexistent/agent/for/sure").unwrap_err();
    assert!(error.contains("No such file or directory"), "{error}");
}

#[test]
fn agent_name_not_on_path_fails_at_spawn() {
    use_trampoline();
    let error = spawn_agent("zorvo-no-such-program-for-sure").unwrap_err();
    assert!(error.contains("No such file or directory"), "{error}");
}

#[test]
fn missing_pty_command_fails_at_spawn() {
    use zorvo_lib::pty_session::PtySessionManager;
    use_trampoline();
    let manager = PtySessionManager::new(Box::new(|_| {}));
    let result = manager.start_session(
        "missing",
        &common::cwd(),
        "/nonexistent/binary/for/sure",
        &[],
        &[],
    );
    assert!(result.is_err(), "a missing command must fail at spawn");
}

#[test]
fn sigpipe_is_back_to_its_default() {
    use_trampoline();
    // With SIGPIPE ignored, `yes` gets EPIPE and complains on stderr instead of
    // dying quietly when `head` stops reading.
    let output = spawn::command("/bin/sh")
        // Disclaimed children have no Documents grant. This signal test uses
        // no workspace files, so keep unrelated TCC cwd errors out of stderr.
        .current_dir(std::env::temp_dir())
        .args(["-c", "/usr/bin/yes | /usr/bin/head -n 1"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}
