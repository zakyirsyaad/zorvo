use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use zorvo_lib::agent_tools::{AgentTools, ToolCall};

const WAIT: Duration = Duration::from_secs(5);
const QUIET: Duration = Duration::from_millis(400);

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
    let dir = std::env::temp_dir().join(format!("zs-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn rig_with(tag: &str, timeout: Duration) -> Rig {
    let (call_tx, calls) = mpsc::channel();
    let (end_tx, ended) = mpsc::channel();
    let call_tx = std::sync::Mutex::new(call_tx);
    let end_tx = std::sync::Mutex::new(end_tx);
    let tools = AgentTools::start_with_timeout(
        &scratch(tag),
        PathBuf::from("/bin/zorvo-test"),
        timeout,
        move |call| call_tx.lock().unwrap().send(call).unwrap(),
        move |id| end_tx.lock().unwrap().send(id).unwrap(),
    )
    .unwrap();
    let entry = tools.servers_for("probe", true);
    let socket = env_value(&entry, "ZORVO_MCP_SOCKET");
    Rig {
        tools,
        calls,
        ended,
        socket,
    }
}

fn rig(tag: &str) -> Rig {
    rig_with(tag, AgentTools::CALL_TIMEOUT)
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

struct Client {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
}

impl Client {
    fn connect(rig: &Rig, session: &str) -> Client {
        let entry = rig.tools.servers_for(session, true);
        let token = env_value(&entry, "ZORVO_MCP_TOKEN");
        let mut stream = UnixStream::connect(&rig.socket).unwrap();
        stream
            .write_all(format!("{{\"token\":\"{token}\"}}\n").as_bytes())
            .unwrap();
        stream.set_read_timeout(Some(WAIT)).unwrap();
        let reader = BufReader::new(stream.try_clone().unwrap());
        Client { stream, reader }
    }

    fn send(&mut self, value: Value) {
        self.send_raw(&format!("{value}\n"));
    }

    fn send_raw(&mut self, text: &str) {
        self.stream.write_all(text.as_bytes()).unwrap();
    }

    fn read(&mut self) -> Value {
        let mut line = String::new();
        self.reader.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("not json: {line:?}"))
    }

    /// True when the server closed the connection.
    fn is_closed(&mut self) -> bool {
        let mut line = String::new();
        matches!(self.reader.read_line(&mut line), Ok(0))
    }
}

fn call(id: i64, tool: &str, args: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":tool,"arguments":args}})
}

fn delegate(id: i64) -> Value {
    call(
        id,
        "delegate",
        json!({"agent": "qwen-code", "task": "review it"}),
    )
}

#[test]
fn servers_for_is_empty_when_disabled_and_one_stdio_entry_when_enabled() {
    let rig = rig("servers");
    assert_eq!(rig.tools.servers_for("s1", false), json!([]));
    let entry = rig.tools.servers_for("s1", true);
    assert_eq!(entry.as_array().unwrap().len(), 1);
    assert_eq!(entry[0]["name"], "zorvo");
    assert_eq!(entry[0]["command"], "/bin/zorvo-test");
    assert_eq!(entry[0]["args"], json!(["mcp-bridge"]));
    assert_eq!(env_value(&entry, "ZORVO_MCP_TOKEN").len(), 64);
    assert!(env_value(&entry, "ZORVO_MCP_SOCKET").ends_with("s.sock"));
}

#[test]
fn a_tool_call_is_emitted_with_its_session_and_answered_by_respond() {
    let rig = rig("call");
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(7));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    assert_eq!(emitted.session_id, "s1");
    assert_eq!(emitted.tool, "delegate");
    assert_eq!(
        emitted.args,
        json!({"agent": "qwen-code", "task": "review it"})
    );
    rig.tools.respond(&emitted.call_id, true, "done");
    let answer = client.read();
    assert_eq!(answer["id"], 7);
    assert_eq!(answer["result"]["content"][0]["text"], "done");
    assert_eq!(answer["result"]["isError"], false);
    // A normal respond is not an end.
    assert!(rig.ended.recv_timeout(QUIET).is_err());
    // Answering twice does nothing.
    rig.tools.respond(&emitted.call_id, true, "again");
    assert!(rig.ended.recv_timeout(QUIET).is_err());
}

#[test]
fn a_failed_answer_carries_the_error_flag() {
    let rig = rig("fail");
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(1));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    rig.tools.respond(&emitted.call_id, false, "no such agent");
    let answer = client.read();
    assert_eq!(answer["result"]["isError"], true);
}

#[test]
fn list_and_initialize_are_answered_without_an_event() {
    let rig = rig("list");
    let mut client = Client::connect(&rig, "s1");
    client.send(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}));
    assert_eq!(client.read()["result"]["protocolVersion"], "2025-06-18");
    client.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
    client.send(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert_eq!(
        client.read()["result"]["tools"].as_array().unwrap().len(),
        5
    );
    client.send(json!({"jsonrpc":"2.0","id":3,"method":"prompts/list"}));
    assert_eq!(client.read()["error"]["code"], -32601);
    assert!(rig.calls.recv_timeout(QUIET).is_err());
}

#[test]
fn an_invalid_call_is_answered_at_once_and_emits_nothing() {
    let rig = rig("invalid");
    let mut client = Client::connect(&rig, "s1");
    client.send(call(
        4,
        "delegate",
        json!({"agent": "qwen-code", "task": ""}),
    ));
    let answer = client.read();
    assert_eq!(answer["id"], 4);
    assert_eq!(answer["result"]["isError"], true);
    assert!(rig.calls.recv_timeout(QUIET).is_err());
    assert!(rig.ended.try_recv().is_err());
}

#[test]
fn an_unanswered_call_times_out_with_an_error_and_is_reported_ended() {
    let rig = rig_with("timeout", Duration::from_millis(200));
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(9));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    let answer = client.read();
    assert_eq!(answer["id"], 9);
    assert_eq!(answer["result"]["isError"], true);
    assert_eq!(
        answer["result"]["content"][0]["text"],
        "Zorvo did not answer in time."
    );
    assert_eq!(rig.ended.recv_timeout(WAIT).unwrap(), emitted.call_id);
    // A late respond finds nothing and fires nothing more.
    rig.tools.respond(&emitted.call_id, true, "late");
    assert!(rig.ended.recv_timeout(QUIET).is_err());
}

#[test]
fn an_answered_call_does_not_time_out_later() {
    let rig = rig_with("answered", Duration::from_millis(300));
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(1));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    rig.tools.respond(&emitted.call_id, true, "fast");
    assert_eq!(client.read()["result"]["content"][0]["text"], "fast");
    assert!(rig.ended.recv_timeout(Duration::from_millis(700)).is_err());
}

#[test]
fn forget_closes_the_connection_reports_ended_and_a_late_respond_is_ignored() {
    let rig = rig("forget");
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(1));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    rig.tools.forget("s1");
    assert_eq!(rig.ended.recv_timeout(WAIT).unwrap(), emitted.call_id);
    assert!(client.is_closed());
    rig.tools.respond(&emitted.call_id, true, "late");
    assert!(rig.ended.recv_timeout(QUIET).is_err());
    // The token is gone, so the same session cannot reconnect with it.
    let entry = rig.tools.servers_for("other", true);
    assert_eq!(entry[0]["name"], "zorvo");
}

#[test]
fn respond_to_an_unknown_call_does_nothing() {
    let rig = rig("unknown");
    rig.tools.respond("999999", true, "x");
    assert!(rig.ended.recv_timeout(QUIET).is_err());
}

#[test]
fn a_cancelled_notification_ends_the_waiting_call_and_a_late_respond_is_ignored() {
    let rig = rig("cancel");
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(42));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    client.send(
        json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":42}}),
    );
    assert_eq!(rig.ended.recv_timeout(WAIT).unwrap(), emitted.call_id);
    rig.tools.respond(&emitted.call_id, true, "late");
    // Nothing was written for the cancelled call: the next line is the next answer.
    client.send(json!({"jsonrpc":"2.0","id":43,"method":"ping"}));
    assert_eq!(client.read()["id"], 43);
    assert!(rig.ended.recv_timeout(QUIET).is_err());
}

#[test]
fn a_cancel_for_another_id_or_another_connection_leaves_the_call_waiting() {
    let rig = rig("cancel-other");
    let mut one = Client::connect(&rig, "s1");
    let mut two = Client::connect(&rig, "s2");
    one.send(delegate(5));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    one.send(json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":6}}));
    two.send(json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":5}}));
    assert!(rig.ended.recv_timeout(QUIET).is_err());
    rig.tools.respond(&emitted.call_id, true, "ok");
    assert_eq!(one.read()["id"], 5);
}

#[test]
fn a_closed_connection_ends_its_waiting_calls() {
    let rig = rig("hangup");
    let mut client = Client::connect(&rig, "s1");
    client.send(delegate(1));
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    drop(client);
    assert_eq!(rig.ended.recv_timeout(WAIT).unwrap(), emitted.call_id);
}

#[test]
fn two_sessions_calls_do_not_cross() {
    let rig = rig("cross");
    let mut one = Client::connect(&rig, "s1");
    let mut two = Client::connect(&rig, "s2");
    one.send(delegate(1));
    let first = rig.calls.recv_timeout(WAIT).unwrap();
    two.send(delegate(1));
    let second = rig.calls.recv_timeout(WAIT).unwrap();
    assert_eq!(
        (first.session_id.as_str(), second.session_id.as_str()),
        ("s1", "s2")
    );
    assert_ne!(first.call_id, second.call_id);
    rig.tools.respond(&second.call_id, true, "for two");
    rig.tools.respond(&first.call_id, true, "for one");
    assert_eq!(two.read()["result"]["content"][0]["text"], "for two");
    assert_eq!(one.read()["result"]["content"][0]["text"], "for one");
}

#[test]
fn a_line_over_one_mebibyte_is_refused_and_the_connection_survives() {
    let rig = rig("oversize");
    let mut client = Client::connect(&rig, "s1");
    let long = "x".repeat(3 * 1024 * 1024);
    client.send_raw(&format!("{long}\n"));
    let refused = client.read();
    assert_eq!(refused["error"]["code"], -32600);
    assert_eq!(refused["id"], Value::Null);
    client.send(json!({"jsonrpc":"2.0","id":2,"method":"ping"}));
    assert_eq!(client.read()["id"], 2);
    // A line of exactly the limit is still read as a line.
    let limit = format!("{}\n", "y".repeat(1024 * 1024));
    client.send_raw(&limit);
    assert_eq!(client.read()["error"]["code"], -32700);
}

#[test]
fn shutdown_removes_the_socket_file_and_closes_connections() {
    let rig = rig("shutdown");
    let mut client = Client::connect(&rig, "s1");
    client.send(json!({"jsonrpc":"2.0","id":1,"method":"ping"}));
    client.read();
    assert!(PathBuf::from(&rig.socket).exists());
    rig.tools.shutdown();
    assert!(!PathBuf::from(&rig.socket).exists());
    assert!(client.is_closed());
}

#[test]
fn nothing_logs_the_token_or_the_task() {
    let rig = rig("quiet");
    let entry = rig.tools.servers_for("s1", true);
    let token = env_value(&entry, "ZORVO_MCP_TOKEN");
    let task = "SECRET-TASK-TEXT-12345";
    let mut bridge = Command::new(env!("CARGO_BIN_EXE_zorvo"))
        .arg("mcp-bridge")
        .env("ZORVO_MCP_SOCKET", &rig.socket)
        .env("ZORVO_MCP_TOKEN", &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = bridge.stdin.take().unwrap();
    let request = call(1, "delegate", json!({"agent": "qwen-code", "task": task}));
    writeln!(stdin, "{request}").unwrap();
    let emitted = rig.calls.recv_timeout(WAIT).unwrap();
    rig.tools.respond(&emitted.call_id, true, "done");
    let mut stdout = BufReader::new(bridge.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    assert!(line.contains("done"));
    drop(stdin);
    let mut stderr = String::new();
    bridge
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .ok();
    let _ = bridge.wait();
    assert!(!stderr.contains(&token));
    assert!(!stderr.contains(task));
}

#[test]
fn the_ninth_open_call_on_a_connection_is_refused_at_once_and_emits_nothing() {
    let rig = rig("cap");
    let mut client = Client::connect(&rig, "s1");
    for id in 1..=8 {
        client.send(delegate(id));
        rig.calls.recv_timeout(WAIT).unwrap();
    }
    client.send(delegate(9));
    let answer = client.read();
    assert_eq!(answer["id"], 9);
    assert_eq!(answer["result"]["isError"], true);
    assert_eq!(
        answer["result"]["content"][0]["text"],
        "Too many tool calls are waiting; wait for one to finish."
    );
    assert!(rig.calls.recv_timeout(QUIET).is_err());
    // Another connection has its own allowance.
    let mut other = Client::connect(&rig, "s2");
    other.send(delegate(1));
    rig.calls.recv_timeout(WAIT).unwrap();
}

#[test]
fn an_end_during_emit_is_reported_after_the_call_event_exactly_once() {
    let log = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let (in_emit_tx, in_emit) = mpsc::channel::<()>();
    let (release_tx, release) = mpsc::channel::<()>();
    let (done_tx, done) = mpsc::channel::<()>();
    let in_emit_tx = std::sync::Mutex::new(in_emit_tx);
    let release = std::sync::Mutex::new(release);
    let done_tx = std::sync::Mutex::new(done_tx);
    let (emit_log, end_log) = (Arc::clone(&log), Arc::clone(&log));
    let tools = AgentTools::start_with_timeout(
        &scratch("order"),
        PathBuf::from("/bin/zorvo-test"),
        AgentTools::CALL_TIMEOUT,
        move |_call| {
            in_emit_tx.lock().unwrap().send(()).unwrap();
            release.lock().unwrap().recv_timeout(WAIT).unwrap();
            emit_log.lock().unwrap().push("call".into());
        },
        move |_id| {
            end_log.lock().unwrap().push("ended".into());
            done_tx.lock().unwrap().send(()).unwrap();
        },
    )
    .unwrap();
    let entry = tools.servers_for("s1", true);
    let mut stream = UnixStream::connect(env_value(&entry, "ZORVO_MCP_SOCKET")).unwrap();
    let token = env_value(&entry, "ZORVO_MCP_TOKEN");
    stream
        .write_all(format!("{{\"token\":\"{token}\"}}\n{}\n", delegate(1)).as_bytes())
        .unwrap();
    in_emit.recv_timeout(WAIT).unwrap();
    // The call is waiting but its event has not gone out yet.
    tools.forget("s1");
    assert!(done.recv_timeout(QUIET).is_err());
    release_tx.send(()).unwrap();
    done.recv_timeout(WAIT).unwrap();
    assert!(done.recv_timeout(QUIET).is_err());
    assert_eq!(*log.lock().unwrap(), vec!["call", "ended"]);
}

fn launch_value(env: &[(String, String)], name: &str) -> Option<String> {
    env.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone())
}

#[test]
fn launch_env_is_empty_when_disabled() {
    let rig = rig("envoff");
    assert!(rig.tools.launch_env_for("s1", false).is_empty());
    assert!(AgentTools::disabled().launch_env_for("s1", true).is_empty());
}

#[test]
fn launch_env_names_the_socket_a_token_and_the_program() {
    let rig = rig("envon");
    let env = rig.tools.launch_env_for("s1", true);
    assert_eq!(env.len(), 3);
    assert_eq!(launch_value(&env, "ZORVO_MCP_SOCKET").unwrap(), rig.socket);
    assert_eq!(launch_value(&env, "ZORVO_MCP_TOKEN").unwrap().len(), 64);
    assert_eq!(
        launch_value(&env, "ZORVO_TOOLS").unwrap(),
        "/bin/zorvo-test"
    );
}

#[test]
fn the_token_from_launch_env_authenticates_as_its_session() {
    let rig = rig("envauth");
    let env = rig.tools.launch_env_for("s9", true);
    let token = launch_value(&env, "ZORVO_MCP_TOKEN").unwrap();
    let mut stream = UnixStream::connect(&rig.socket).unwrap();
    writeln!(stream, "{}", json!({ "token": token })).unwrap();
    writeln!(
        stream,
        "{}",
        json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "list_agents", "arguments": {}}})
    )
    .unwrap();
    let call = rig.calls.recv_timeout(WAIT).unwrap();
    assert_eq!(call.session_id, "s9");
}

#[test]
fn forget_drops_a_launch_env_token() {
    let rig = rig("envforget");
    let env = rig.tools.launch_env_for("s1", true);
    let token = launch_value(&env, "ZORVO_MCP_TOKEN").unwrap();
    rig.tools.forget("s1");
    let mut stream = UnixStream::connect(&rig.socket).unwrap();
    writeln!(stream, "{}", json!({ "token": token })).unwrap();
    let _ = writeln!(
        stream,
        "{}",
        json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "list_agents", "arguments": {}}})
    );
    assert!(rig.calls.recv_timeout(QUIET).is_err());
}
