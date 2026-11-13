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

// --- The command path: an agent that ignores `mcpServers` gets the socket in
// its environment and runs `zorvo tools` itself.

use zorvo_lib::agent_tools::commands::{tools_for_session, with_tools_env};
use zorvo_lib::agent_tools::ToolsPath;
use zorvo_lib::store::AppStore;

fn store_with_tools(dir: &std::path::Path, on: bool) -> AppStore {
    let store = AppStore::new(dir.join("store"));
    let mut state = store.load_state().expect("a fresh state");
    state.settings.agent_tools = on;
    store.save_state(&state).expect("the state saves");
    store
}

fn command_agent(
    rig: &Rig,
    extra: &[(&str, &str)],
) -> (
    zorvo_lib::acp::manager::AcpLaunch,
    PathBuf,
    PathBuf,
    PathBuf,
) {
    let env_log = rig.dir.join("env.log");
    let params_log = rig.dir.join("params.log");
    let run_log = rig.dir.join("run.log");
    let call = json!({ "tool": "delegate", "args": { "agent": "qwen", "task": "x" } });
    let mut flags = vec![
        ("FAKE_ACP_ENV_LOG", env_log.to_str().unwrap().to_string()),
        (
            "FAKE_ACP_PARAMS_LOG",
            params_log.to_str().unwrap().to_string(),
        ),
        ("FAKE_ACP_TOOLS_COMMAND", call.to_string()),
        ("FAKE_ACP_MCP_LOG", run_log.to_str().unwrap().to_string()),
    ];
    flags.extend(extra.iter().map(|(k, v)| (*k, v.to_string())));
    let borrowed: Vec<(&str, &str)> = flags.iter().map(|(k, v)| (*k, v.as_str())).collect();
    (fake_agent_with(&borrowed), env_log, params_log, run_log)
}

#[test]
fn tools_for_session_picks_the_path_by_agent_and_setting() {
    let rig = rig("pick");
    let on = store_with_tools(&rig.dir, true);

    let command = tools_for_session(&rig.tools, &on, "s1", "pi-acp", true).unwrap();
    assert_eq!(command.servers, json!([]));
    assert_eq!(command.env.len(), 3);
    assert_eq!(command.path, Some(ToolsPath::Command));

    let mcp = tools_for_session(&rig.tools, &on, "s2", "qwen-code", true).unwrap();
    assert_eq!(mcp.servers[0]["name"], "zorvo");
    assert!(mcp.env.is_empty());
    assert_eq!(mcp.path, Some(ToolsPath::Mcp));

    // The webview did not ask, or the setting is off: nothing, on either path.
    let off = store_with_tools(&rig.dir.join("off"), false);
    for (store, asked) in [(&on, false), (&off, true)] {
        for agent in ["pi-acp", "qwen-code"] {
            let none = tools_for_session(&rig.tools, store, "s3", agent, asked).unwrap();
            assert_eq!(none.servers, json!([]), "{agent} asked={asked}");
            assert!(none.env.is_empty(), "{agent} asked={asked}");
            assert_eq!(none.path, None, "{agent} asked={asked}");
        }
    }
    rig.tools.shutdown();
}

#[test]
fn a_command_path_session_gets_the_variables_and_no_server() {
    let rig = rig("cmdenv");
    let store = store_with_tools(&rig.dir, true);
    let (manager, _rx) = manager();
    let (launch, env_log, params_log, _) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true).unwrap();
    let launch = with_tools_env(launch, &tools.env);
    manager
        .start("s1", &cwd(), &launch, tools.servers)
        .expect("start");

    assert_eq!(
        logged(&env_log)[0],
        json!({ "socket": true, "token": true, "tools": true })
    );
    assert_eq!(logged(&params_log)[0]["mcpServers"], json!([]));
    manager.stop("s1");
    rig.tools.shutdown();
}

#[test]
fn an_mcp_session_gets_the_server_and_no_variables() {
    let rig = rig("mcpenv");
    let store = store_with_tools(&rig.dir, true);
    let (manager, _rx) = manager();
    let (launch, env_log, params_log, _) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "qwen-code", true).unwrap();
    let launch = with_tools_env(launch, &tools.env);
    manager
        .start("s1", &cwd(), &launch, tools.servers)
        .expect("start");

    assert_eq!(
        logged(&env_log)[0],
        json!({ "socket": false, "token": false, "tools": false })
    );
    assert_eq!(logged(&params_log)[0]["mcpServers"][0]["name"], "zorvo");
    manager.stop("s1");
    rig.tools.shutdown();
}

#[test]
fn the_fake_agent_runs_zorvo_tools_and_gets_the_answer() {
    let rig = rig("cmdrun");
    let store = store_with_tools(&rig.dir, true);
    let (manager, rx) = manager();
    let (launch, _, _, run_log) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true).unwrap();
    manager
        .start(
            "s1",
            &cwd(),
            &with_tools_env(launch, &tools.env),
            tools.servers,
        )
        .expect("start");
    manager.prompt("s1", "tools", &[]).unwrap();

    let call = rig.calls.recv_timeout(WAIT).expect("a tool call");
    assert_eq!(call.session_id, "s1");
    assert_eq!(call.tool, "delegate");
    assert_eq!(call.args, json!({ "agent": "qwen", "task": "x" }));
    rig.tools.respond(&call.call_id, true, "started");

    wait_for(&rx, |e| agent_text(e).as_deref() == Some("tools:started"));
    let entry = &logged(&run_log)[0];
    assert_eq!(entry["status"], 0);
    assert_eq!(entry["stdout"], "started\n");
    assert_eq!(entry["stderr"], "");
    manager.stop("s1");
    rig.tools.shutdown();
}

#[test]
fn an_entry_already_in_the_launch_environment_cannot_replace_the_three_variables() {
    let rig = rig("cmdevil");
    let store = store_with_tools(&rig.dir, true);
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true).unwrap();
    let (mut launch, ..) = command_agent(&rig, &[]);
    launch
        .env
        .push(("ZORVO_MCP_TOKEN".to_string(), "someone-elses".to_string()));
    launch
        .env
        .push(("ZORVO_TOOLS".to_string(), "/bin/echo".to_string()));
    let launch = with_tools_env(launch, &tools.env);

    for name in ["ZORVO_MCP_SOCKET", "ZORVO_MCP_TOKEN", "ZORVO_TOOLS"] {
        let values: Vec<&String> = launch
            .env
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, v)| v)
            .collect();
        let expected = &tools.env.iter().find(|(n, _)| n == name).unwrap().1;
        assert_eq!(values, vec![expected], "{name}");
    }
    rig.tools.shutdown();
}

#[test]
fn an_empty_tools_environment_leaves_the_launch_as_it_was() {
    let rig = rig("cmdnone");
    let (launch, ..) = command_agent(&rig, &[]);
    let before = launch.env.clone();
    assert_eq!(with_tools_env(launch, &[]).env, before);
    rig.tools.shutdown();
}
