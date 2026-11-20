//! The worker client against the fake driver.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use zorvo_lib::computer_use::{DriverClient, DriverError, StartOptions};

fn fixture() -> String {
    format!(
        "{}/tests/fixtures/fake_cua_driver.mjs",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zorvo-cua-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fake(env: &[(&str, &str)]) -> Command {
    let mut command = Command::new("node");
    command.arg(fixture());
    for (name, value) in env {
        command.env(name, value);
    }
    command
}

fn options(version: Option<&'static str>) -> StartOptions<'static> {
    StartOptions {
        generation: zorvo_lib::computer_use::driver::new_generation(),
        host_bundle_id: "xyz.zorvo.desktop",
        driver_version: version,
    }
}

fn start(env: &[(&str, &str)]) -> Arc<DriverClient> {
    DriverClient::start(fake(env), options(Some("0.52.13"))).expect("the fake driver starts")
}

fn requests(log: &PathBuf) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn is_running(pid: u32) -> bool {
    // SAFETY: signal 0 only asks whether the process exists.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn wait_until(what: &str, check: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting until {what}");
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn answers_a_call() {
    let client = start(&[]);
    let session = client.bind_session("Qwen Code").unwrap();
    let call = client.begin_call(&session, "click", json!({ "x": 1 }));
    let result = client.wait(call).unwrap();
    assert_eq!(result["isError"], json!(false));
    assert_eq!(
        result["content"][0]["text"],
        json!("click done for Qwen Code")
    );
    assert_eq!(result["structuredContent"]["echoed"]["x"], json!(1));
}

#[test]
fn lists_the_drivers_tools() {
    let client = start(&[]);
    let listed = client.list().unwrap();
    let names: Vec<&str> = listed["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"get_window_state"));
}

#[test]
fn refuses_another_protocol_version() {
    let started = DriverClient::start(fake(&[("FAKE_CUA_PROTOCOL", "2")]), options(None));
    assert!(matches!(started, Err(DriverError::Protocol(_))));
}

#[test]
fn refuses_a_driver_version_that_is_not_the_pin() {
    let started = DriverClient::start(
        fake(&[("FAKE_CUA_VERSION", "0.45.4")]),
        options(Some("0.52.13")),
    );
    assert!(matches!(started, Err(DriverError::Protocol(_))));
}

#[test]
fn a_program_that_is_not_the_worker_does_not_start() {
    let started = DriverClient::start(Command::new("/usr/bin/true"), options(None));
    assert_eq!(started.err(), Some(DriverError::Exited));
}

#[test]
fn writes_one_request_at_a_time() {
    let log = scratch("order").join("calls.jsonl");
    let _ = std::fs::remove_file(&log);
    let client = start(&[
        ("FAKE_CUA_CALL_LOG", log.to_str().unwrap()),
        ("FAKE_CUA_SLOW_MS", "300"),
    ]);
    let session = client.bind_session("Qwen Code").unwrap();
    let first = client.begin_call(&session, "click", json!({ "n": 1 }));
    let second = client.begin_call(&session, "click", json!({ "n": 2 }));
    // While the worker answers the first call, the second has not been written.
    wait_until("the first call is written", || {
        requests(&log)
            .iter()
            .any(|r| r["arguments"]["n"] == json!(1))
    });
    assert!(!requests(&log)
        .iter()
        .any(|r| r["arguments"]["n"] == json!(2)));
    assert_eq!(
        client.wait(first).unwrap()["structuredContent"]["echoed"]["n"],
        json!(1)
    );
    assert_eq!(
        client.wait(second).unwrap()["structuredContent"]["echoed"]["n"],
        json!(2)
    );
}

#[test]
fn a_queued_call_is_dropped_without_killing_the_worker() {
    let log = scratch("queued").join("calls.jsonl");
    let _ = std::fs::remove_file(&log);
    let client = start(&[
        ("FAKE_CUA_CALL_LOG", log.to_str().unwrap()),
        ("FAKE_CUA_SLOW_MS", "300"),
    ]);
    let session = client.bind_session("Qwen Code").unwrap();
    let running = client.begin_call(&session, "click", json!({ "n": 1 }));
    let queued = client.begin_call(&session, "click", json!({ "n": 2 }));
    client.abandon(queued);
    assert_eq!(client.wait(queued), Err(DriverError::Abandoned));
    assert!(client.wait(running).is_ok());
    assert!(client.is_alive());
    assert!(!requests(&log)
        .iter()
        .any(|r| r["arguments"]["n"] == json!(2)));
}

#[test]
fn abandoning_the_running_call_kills_the_worker_and_fails_the_rest() {
    let client = start(&[("FAKE_CUA_HANG", "get_window_state")]);
    let pid = client.pid();
    let session = client.bind_session("Qwen Code").unwrap();
    let hung = client.begin_call(&session, "get_window_state", json!({}));
    let behind = client.begin_call(&session, "click", json!({}));
    thread::sleep(Duration::from_millis(200));
    client.abandon(hung);
    assert_eq!(client.wait(hung), Err(DriverError::Abandoned));
    assert_eq!(client.wait(behind), Err(DriverError::Exited));
    assert!(!client.is_alive());
    wait_until("the worker is gone", || !is_running(pid));
    // A later request fails at once, without a worker to write to.
    assert_eq!(client.bind_session("Codex"), Err(DriverError::Exited));
}

#[test]
fn fails_waiting_calls_when_the_driver_exits() {
    let client = start(&[("FAKE_CUA_HANG", "click")]);
    let pid = client.pid();
    let session = client.bind_session("Qwen Code").unwrap();
    let call = client.begin_call(&session, "click", json!({}));
    thread::sleep(Duration::from_millis(200));
    // SAFETY: the pid is the fake driver this test started.
    unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    assert_eq!(client.wait(call), Err(DriverError::Exited));
}

#[test]
fn line_over_32_mib_fails_the_call_and_kills_the_driver() {
    let client = start(&[("FAKE_CUA_HUGE", "1")]);
    let pid = client.pid();
    let session = client.bind_session("Qwen Code").unwrap();
    let call = client.begin_call(&session, "get_window_state", json!({}));
    assert_eq!(client.wait(call), Err(DriverError::LineTooLong));
    wait_until("the worker is gone", || !is_running(pid));
}

#[test]
fn kill_leaves_no_zombie() {
    let client = start(&[]);
    let pid = client.pid();
    assert!(is_running(pid));
    client.kill();
    // A zombie still answers signal 0; a reaped child does not.
    assert!(!is_running(pid));
}

#[test]
fn dropping_the_client_ends_the_worker() {
    let client = start(&[]);
    let pid = client.pid();
    drop(client);
    assert!(!is_running(pid));
}

#[test]
fn unknown_handle_is_refused() {
    let client = start(&[]);
    let session = client.bind_session("Qwen Code").unwrap();
    client.close_session(&session);
    let call = client.begin_call(&session, "click", json!({}));
    assert!(matches!(client.wait(call), Err(DriverError::Refused(_))));
    // The worker is still there for other sessions.
    assert!(client.bind_session("Codex").is_ok());
}

#[test]
fn a_label_in_use_is_refused_and_free_again_after_close() {
    let client = start(&[]);
    let first = client.bind_session("Qwen Code").unwrap();
    assert!(matches!(
        client.bind_session("Qwen Code"),
        Err(DriverError::Refused(_))
    ));
    client.close_session(&first);
    assert!(client.bind_session("Qwen Code").is_ok());
}

/// The same client against the real pinned driver. Run by hand after
/// `pnpm cua-driver:fetch`: `cargo test --test it real_driver -- --ignored`.
#[test]
#[ignore = "needs the pinned cua-driver in src-tauri/binaries"]
fn real_driver_starts_lists_and_binds() {
    use zorvo_lib::computer_use::driver;
    let path = driver::locate().expect("run pnpm cua-driver:fetch first");
    let pin = driver::pinned();
    assert_eq!(driver::check(&path, pin), Ok(()));
    let client = DriverClient::start(
        driver::command(&path, &scratch("real")),
        StartOptions {
            generation: driver::new_generation(),
            host_bundle_id: driver::HOST_BUNDLE_ID,
            driver_version: Some(&pin.version),
        },
    )
    .expect("the pinned driver starts as a worker");
    let listed = client.list().unwrap();
    let tools = listed["tools"].as_array().or(listed.as_array()).unwrap();
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(names.contains(&"get_window_state"));
    assert!(!names.contains(&"run_script"));
    let session = client.bind_session("Qwen Code").unwrap();
    assert!(matches!(
        client.bind_session("Qwen Code"),
        Err(DriverError::Refused(_))
    ));
    let call = client.begin_call(&session, "list_apps", json!({}));
    // The real driver leaves `isError` out of a result that is not an error.
    assert_ne!(client.wait(call).unwrap()["isError"], json!(true));
    let pid = client.pid();
    client.kill();
    assert!(!is_running(pid));
}

// ── The shared driver behind the switch ───────────────────────────────────

use zorvo_lib::computer_use::{ComputerUse, NoDriver};

fn computer_use(enabled: bool) -> ComputerUse {
    ComputerUse::with_starter(
        scratch("state"),
        enabled,
        Box::new(|| {
            DriverClient::start(fake(&[]), options(Some("0.52.13"))).map_err(NoDriver::Failed)
        }),
    )
}

#[test]
fn switch_off_gives_no_driver() {
    assert_eq!(computer_use(false).driver().err(), Some(NoDriver::Off));
}

#[test]
fn one_driver_is_shared_until_it_ends() {
    let state = computer_use(true);
    let first = state.driver().unwrap();
    let again = state.driver().unwrap();
    assert_eq!(first.pid(), again.pid());
    first.kill();
    // A driver that ended is replaced on the next ask.
    let next = state.driver().unwrap();
    assert_ne!(next.pid(), first.pid());
    assert!(is_running(next.pid()));
}

#[test]
fn switch_off_kills_the_driver() {
    let state = computer_use(true);
    let client = state.driver().unwrap();
    let pid = client.pid();
    let session = client.bind_session("Qwen Code").unwrap();
    state.set_enabled(false);
    assert!(!is_running(pid));
    let call = client.begin_call(&session, "click", json!({}));
    assert_eq!(client.wait(call), Err(DriverError::Exited));
    assert_eq!(state.driver().err(), Some(NoDriver::Off));
    // On again: a new driver starts on the next ask.
    state.set_enabled(true);
    assert!(is_running(state.driver().unwrap().pid()));
}

#[test]
fn switch_off_does_not_wait_for_a_driver_that_is_starting() {
    // The starter takes a while, as a driver stuck in `initialize` would.
    let state = Arc::new(ComputerUse::with_starter(
        scratch("slow-start"),
        true,
        Box::new(|| {
            thread::sleep(Duration::from_millis(600));
            DriverClient::start(fake(&[]), options(Some("0.52.13"))).map_err(NoDriver::Failed)
        }),
    ));
    let starting = Arc::clone(&state);
    let started = thread::spawn(move || starting.driver().map(|client| client.pid()));
    thread::sleep(Duration::from_millis(150));
    let before = Instant::now();
    state.set_enabled(false);
    assert!(
        before.elapsed() < Duration::from_millis(300),
        "the switch waited for the start"
    );
    // The start ends with the switch off: no driver is handed out or left running.
    assert_eq!(started.join().unwrap().err(), Some(NoDriver::Off));
    assert_eq!(state.driver().err(), Some(NoDriver::Off));
}

#[test]
fn switch_off_during_a_lookup_still_ends_the_driver() {
    // Many lookups race the switch: whichever side wins the lock, no driver
    // may be left running once the switch is off and the lookups are done.
    for _ in 0..20 {
        let state = Arc::new(computer_use(true));
        let pid = state.driver().unwrap().pid();
        let looking = Arc::clone(&state);
        let lookups = thread::spawn(move || {
            for _ in 0..200 {
                let _ = looking.driver();
            }
        });
        state.set_enabled(false);
        lookups.join().unwrap();
        wait_until("the driver is gone", || !is_running(pid));
        assert_eq!(state.driver().err(), Some(NoDriver::Off));
    }
}
