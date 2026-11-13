//! The whole path: the fake agent starts the real bridge from its
//! `mcpServers`, calls a tool, and gets the answer the test gives.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use zorvo_lib::agent_tools::{AgentTools, ToolCall};

use crate::common::{agent_text, cwd, fake_agent_with, manager, wait_for, WAIT};

struct Rig {
    tools: Arc<AgentTools>,
    calls: Receiver<ToolCall>,
    ended: Receiver<String>,
    dir: PathBuf,
}

fn scratch(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    // Short: a unix socket path has a small length limit.
    let dir = std::env::temp_dir().join(format!("ze-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn rig(tag: &str) -> Rig {
    let dir = scratch(tag);
    let (call_tx, calls) = mpsc::channel();
    let (end_tx, ended) = mpsc::channel();
    let call_tx = Mutex::new(call_tx);
    let end_tx = Mutex::new(end_tx);
    let tools = AgentTools::start(
        &dir,
        env!("CARGO_BIN_EXE_zorvo").into(),
        move |call| call_tx.lock().unwrap().send(call).unwrap(),
        move |id| end_tx.lock().unwrap().send(id).unwrap(),
    )
    .expect("the tool server starts");
    Rig {
        tools,
        calls,
        ended,
        dir,
    }
}

fn mcp_agent(rig: &Rig) -> (zorvo_lib::acp::manager::AcpLaunch, PathBuf) {
    let log = rig.dir.join("mcp.log");
    let call = json!({ "tool": "delegate", "args": { "agent": "qwen", "task": "x" } });
    let launch = fake_agent_with(&[
        ("FAKE_ACP_MCP_CALL", &call.to_string()),
        ("FAKE_ACP_MCP_LOG", log.to_str().unwrap()),
    ]);
    (launch, log)
}

fn logged(path: &std::path::Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).expect("a JSON line"))
        .collect()
}

#[test]
fn the_fake_agent_calls_a_tool_through_the_bridge_and_gets_the_answer() {
    let rig = rig("ok");
    let (manager, rx) = manager();
    let (launch, log) = mcp_agent(&rig);
    manager
        .start("s1", &cwd(), &launch, rig.tools.servers_for("s1", true))
        .expect("start");
    manager.prompt("s1", "mcp", &[]).unwrap();

    let call = rig.calls.recv_timeout(WAIT).expect("a tool call");
    assert_eq!(call.session_id, "s1");
    assert_eq!(call.tool, "delegate");
    rig.tools.respond(&call.call_id, true, "started");

    wait_for(&rx, |e| agent_text(e).as_deref() == Some("mcp:started"));
    let entries = logged(&log);
    let names: Vec<&str> = entries[1]["result"]["tools"]
        .as_array()
        .expect("tools/list result")
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert_eq!(names.len(), 5, "tool names: {names:?}");
    assert_eq!(entries[2]["result"]["content"][0]["text"], "started");
    manager.stop("s1");
    rig.tools.shutdown();
}

#[test]
fn a_disabled_session_gets_no_server_and_the_fake_agent_says_so() {
    let rig = rig("off");
    let (manager, rx) = manager();
    let (launch, _log) = mcp_agent(&rig);
    let servers = rig.tools.servers_for("s1", false);
    assert_eq!(servers, json!([]));
    manager
        .start("s1", &cwd(), &launch, servers)
        .expect("start");
    manager.prompt("s1", "mcp", &[]).unwrap();

    wait_for(&rx, |e| agent_text(e).as_deref() == Some("mcp:none"));
    assert!(rig.calls.recv_timeout(Duration::from_millis(300)).is_err());
    manager.stop("s1");
    rig.tools.shutdown();
}

#[test]
fn an_instance_that_could_not_start_gives_every_session_no_server() {
    let tools = AgentTools::disabled();
    assert_eq!(tools.servers_for("s1", true), json!([]));
    assert_eq!(tools.servers_for("s1", false), json!([]));
    tools.respond("1", true, "nothing waits");
    tools.forget("s1");
    tools.shutdown();
}

#[test]
fn stopping_the_session_ends_its_waiting_call() {
    let rig = rig("stop");
    let (manager, _rx) = manager();
    let (launch, _log) = mcp_agent(&rig);
    manager
        .start("s1", &cwd(), &launch, rig.tools.servers_for("s1", true))
        .expect("start");
    manager.prompt("s1", "mcp", &[]).unwrap();
    let call = rig.calls.recv_timeout(WAIT).expect("a tool call");

    manager.stop("s1");
    rig.tools.forget("s1");

    assert_eq!(rig.ended.recv_timeout(WAIT).expect("ended"), call.call_id);
    // A late answer goes nowhere and ends nothing twice.
    rig.tools.respond(&call.call_id, true, "late");
    assert!(rig.ended.recv_timeout(Duration::from_millis(300)).is_err());
    rig.tools.shutdown();
}
