//! `zorvo tools`: the command an agent without MCP runs in its shell. Every
//! test runs the real binary against a real `AgentTools` socket.

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use zorvo_lib::agent_tools::{AgentTools, ToolCall};

const WAIT: Duration = Duration::from_secs(5);
const QUIET: Duration = Duration::from_millis(400);
const BINARY: &str = env!("CARGO_BIN_EXE_zorvo");

struct Rig {
    tools: Arc<AgentTools>,
    calls: mpsc::Receiver<ToolCall>,
    ended: mpsc::Receiver<String>,
    socket: String,
}

fn scratch(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("zc-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn env_value(entry: &Value, name: &str) -> String {
    entry[0]["env"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == name)
        .unwrap()["value"]
        .as_str()
        .unwrap()
        .to_string()
}

fn rig(tag: &str) -> Rig {
    let (call_tx, calls) = mpsc::channel();
    let (end_tx, ended) = mpsc::channel();
    let call_tx = std::sync::Mutex::new(call_tx);
    let end_tx = std::sync::Mutex::new(end_tx);
    let tools = AgentTools::start(
        &scratch(tag),
        PathBuf::from(BINARY),
        move |call| call_tx.lock().unwrap().send(call).unwrap(),
        move |id| end_tx.lock().unwrap().send(id).unwrap(),
    )
    .unwrap();
    let socket = env_value(&tools.servers_for("probe", true), "ZORVO_MCP_SOCKET");
    Rig {
        tools,
        calls,
        ended,
        socket,
    }
}

impl Rig {
    fn token(&self, session: &str) -> String {
        env_value(&self.tools.servers_for(session, true), "ZORVO_MCP_TOKEN")
    }

    /// Starts `zorvo tools <args>` as `session`'s shell would.
    fn spawn(&self, session: &str, args: &[&str]) -> (Child, String) {
        let token = self.token(session);
        let child = command(args)
            .env("ZORVO_MCP_SOCKET", &self.socket)
            .env("ZORVO_MCP_TOKEN", &token)
            .spawn()
            .unwrap();
        (child, token)
    }

    /// Runs the command and answers the one call it makes.
    fn run_answered(
        &self,
        session: &str,
        args: &[&str],
        ok: bool,
        text: &str,
    ) -> (ToolCall, Output) {
        let (child, _) = self.spawn(session, args);
        let call = self.calls.recv_timeout(WAIT).expect("the call was emitted");
        self.tools.respond(&call.call_id, ok, text);
        (call, child.wait_with_output().unwrap())
    }
}

fn command(args: &[&str]) -> Command {
    let mut command = Command::new(BINARY);
    command
        .arg("tools")
        .args(args)
        .env_remove("ZORVO_MCP_SOCKET")
        .env_remove("ZORVO_MCP_TOKEN")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn without_a_tool_it_lists_the_five_tools_and_needs_no_socket() {
    let output = command(&[]).output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    let listed = text(&output.stdout);
    for tool in [
        "list_agents",
        "delegate",
        "start_session",
        "read_session",
        "stop_session",
    ] {
        assert!(listed.contains(tool), "{tool} is listed: {listed}");
    }
    assert!(
        listed.contains("\"$ZORVO_TOOLS\" tools delegate"),
        "{listed}"
    );
}

#[test]
fn a_call_reaches_the_service_with_its_session_and_prints_the_answer() {
    let rig = rig("call");
    let (call, output) = rig.run_answered(
        "s1",
        &["delegate", r#"{"agent":"qwen-code","task":"review it"}"#],
        true,
        "started",
    );
    assert_eq!(call.session_id, "s1");
    assert_eq!(call.tool, "delegate");
    assert_eq!(
        call.args,
        json!({"agent": "qwen-code", "task": "review it"})
    );
    assert_eq!(text(&output.stdout), "started\n");
    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn no_arguments_and_an_empty_object_are_the_same_call() {
    let rig = rig("empty");
    let (bare, _) = rig.run_answered("s1", &["list_agents"], true, "[]");
    let (braced, _) = rig.run_answered("s1", &["list_agents", "{}"], true, "[]");
    assert_eq!(bare.tool, "list_agents");
    assert_eq!(bare.args, braced.args);
}

#[test]
fn json_split_across_words_is_joined() {
    let rig = rig("split");
    let (call, output) = rig.run_answered(
        "s1",
        &[
            "delegate",
            "{\"agent\":",
            "\"qwen-code\",",
            "\"task\":",
            "\"review",
            "it\"}",
        ],
        true,
        "started",
    );
    assert_eq!(
        call.args,
        json!({"agent": "qwen-code", "task": "review it"})
    );
    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn a_task_with_quotes_and_newlines_arrives_intact() {
    let rig = rig("quotes");
    let task = "say 'hi' and \"bye\"\nthen stop";
    let arguments = json!({"agent": "qwen-code", "task": task}).to_string();
    let (call, _) = rig.run_answered("s1", &["delegate", &arguments], true, "started");
    assert_eq!(call.args["task"], task);
}

#[test]
fn arguments_that_are_not_an_object_exit_2_with_the_quoting_hint() {
    let rig = rig("notobject");
    for arguments in ["review it", "[1]", "\"text\""] {
        let (child, _) = rig.spawn("s1", &["delegate", arguments]);
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{arguments}");
        assert!(
            text(&output.stderr).contains("one JSON object in single quotes"),
            "{arguments}: {}",
            text(&output.stderr)
        );
    }
    assert!(
        rig.calls.recv_timeout(QUIET).is_err(),
        "nothing was emitted"
    );
}

#[test]
fn a_refused_call_prints_the_reason_on_stderr_and_exits_1() {
    let rig = rig("refused");
    let (_, output) = rig.run_answered(
        "s1",
        &["delegate", r#"{"agent":"qwen-code","task":"review it"}"#],
        false,
        "The user declined.",
    );
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(text(&output.stderr), "The user declined.\n");
    assert_eq!(text(&output.stdout), "");

    // A call the backend's validation refuses never reaches the webview.
    let (child, _) = rig.spawn(
        "s1",
        &["delegate", r#"{"agent":"qwen-code","task":"/review"}"#],
    );
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(!text(&output.stderr).is_empty());
    assert!(rig.calls.recv_timeout(QUIET).is_err());
}

#[test]
fn without_zorvo_it_fails_within_two_seconds() {
    // No socket file at all.
    let started = Instant::now();
    let output = command(&["list_agents"])
        .env("ZORVO_MCP_SOCKET", scratch("nosock").join("s.sock"))
        .env("ZORVO_MCP_TOKEN", "t")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        text(&output.stderr),
        "Zorvo is not reachable from this shell.\n"
    );
    assert!(started.elapsed() < Duration::from_secs(3));

    // The variables are missing.
    let output = command(&["list_agents"]).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        text(&output.stderr),
        "Zorvo is not reachable from this shell.\n"
    );
}

#[test]
fn a_stale_token_fails_without_an_event() {
    let rig = rig("stale");
    let token = rig.token("gone");
    rig.tools.forget("gone");
    let output = command(&["list_agents"])
        .env("ZORVO_MCP_SOCKET", &rig.socket)
        .env("ZORVO_MCP_TOKEN", &token)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(!text(&output.stderr).contains(&token));
    assert!(rig.calls.recv_timeout(QUIET).is_err());
}

#[test]
fn killing_the_command_ends_the_waiting_call() {
    let rig = rig("killed");
    let (mut child, _) = rig.spawn("s1", &["list_agents"]);
    let call = rig.calls.recv_timeout(WAIT).expect("the call was emitted");
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(rig.ended.recv_timeout(WAIT).unwrap(), call.call_id);
    // A late answer finds nothing and does nothing.
    rig.tools.respond(&call.call_id, true, "late");
    assert!(rig.ended.recv_timeout(QUIET).is_err());
}

#[test]
fn neither_stream_ever_holds_the_token() {
    let rig = rig("secret");
    let (child, token) = rig.spawn("s1", &["delegate", "not json"]);
    let output = child.wait_with_output().unwrap();
    assert!(!text(&output.stdout).contains(&token));
    assert!(!text(&output.stderr).contains(&token));

    let (child, token) = rig.spawn("s1", &["list_agents"]);
    let call = rig.calls.recv_timeout(WAIT).unwrap();
    rig.tools.respond(&call.call_id, false, "no");
    let output = child.wait_with_output().unwrap();
    assert!(!text(&output.stdout).contains(&token));
    assert!(!text(&output.stderr).contains(&token));
}

/// Runs the binary with `args` (no `tools` in front) and an agent's
/// environment; kills it if it is still running after 3 seconds, which means
/// it went on to open the app.
fn run_as_agent(args: &[&str], variable: &str) -> Option<Output> {
    let mut child = Command::new(BINARY)
        .args(args)
        .env_remove("ZORVO_MCP_SOCKET")
        .env_remove("ZORVO_MCP_TOKEN")
        .env_remove("ZORVO_TOOLS")
        .env(variable, "/tmp/zorvo-not-there")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        if child.try_wait().unwrap().is_some() {
            return Some(child.wait_with_output().unwrap());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    child.kill().unwrap();
    child.wait().unwrap();
    None
}

#[test]
fn from_an_agents_environment_it_never_opens_the_app() {
    // What Pi really ran after a failed call: the program with `--help`.
    for args in [
        vec!["--help"],
        vec![],
        vec!["help"],
        vec!["tool", "list_agents"],
    ] {
        for variable in ["ZORVO_TOOLS", "ZORVO_MCP_SOCKET", "ZORVO_MCP_TOKEN"] {
            let output = run_as_agent(&args, variable)
                .unwrap_or_else(|| panic!("{args:?} with {variable} opened the app"));
            assert_eq!(output.status.code(), Some(2), "{args:?} {variable}");
            assert!(
                text(&output.stderr).contains("\"$ZORVO_TOOLS\" tools delegate"),
                "{args:?} {variable}: {}",
                text(&output.stderr)
            );
        }
    }
}

#[test]
fn asking_tools_for_help_lists_the_tools() {
    for flag in ["--help", "-h", "help"] {
        let output = command(&[flag]).output().unwrap();
        assert_eq!(output.status.code(), Some(0), "{flag}");
        assert!(text(&output.stdout).contains("list_agents"), "{flag}");
    }
}

#[test]
fn it_runs_from_a_path_with_a_space_the_way_the_context_writes_it() {
    let rig = rig("space");
    let folder = scratch("with space").join("Zorvo Dev.app");
    fs::create_dir_all(&folder).unwrap();
    let program = folder.join("zorvo");
    std::os::unix::fs::symlink(BINARY, &program).unwrap();
    assert!(program.to_str().unwrap().contains(' '));

    // Exactly what the hidden context tells an agent to type, through a shell.
    let child = Command::new("/bin/sh")
        .args(["-c", r#""$ZORVO_TOOLS" tools list_agents '{}'"#])
        .env("ZORVO_TOOLS", &program)
        .env("ZORVO_MCP_SOCKET", &rig.socket)
        .env("ZORVO_MCP_TOKEN", rig.token("s1"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let call = rig.calls.recv_timeout(WAIT).expect("the call was emitted");
    rig.tools.respond(&call.call_id, true, "[]");
    let output = child.wait_with_output().unwrap();
    assert_eq!(call.tool, "list_agents");
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    assert_eq!(text(&output.stdout), "[]\n");
}
