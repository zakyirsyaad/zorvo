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
    let call = json!({ "tool": "start_worker", "args": { "agent": "qwen", "task": "x" } });
    mcp_agent_calling(rig, &call)
}

fn mcp_agent_calling(rig: &Rig, call: &Value) -> (zorvo_lib::acp::manager::AcpLaunch, PathBuf) {
    let log = rig.dir.join("mcp.log");
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
    bind_processes(&manager, &rig.tools);
    let (launch, log) = mcp_agent(&rig);
    manager
        .start("s1", &cwd(), &launch, rig.tools.servers_for("s1", true))
        .expect("start");
    manager.prompt("s1", "mcp", &[]).unwrap();

    let call = rig.calls.recv_timeout(WAIT).expect("a tool call");
    assert_eq!(call.session_id, "s1");
    assert_eq!(call.tool, "start_worker");
    rig.tools.respond(&call.call_id, true, "started");

    wait_for(&rx, |e| agent_text(e).as_deref() == Some("mcp:started"));
    let entries = logged(&log);
    let names: Vec<&str> = entries[1]["result"]["tools"]
        .as_array()
        .expect("tools/list result")
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert_eq!(
        names.len(),
        zorvo_lib::agent_tools::tools::TOOL_NAMES.len(),
        "tool names: {names:?}"
    );
    assert_eq!(entries[2]["result"]["content"][0]["text"], "started");
    manager.stop("s1");
    rig.tools.shutdown();
}

fn tool_names_in(entry: &Value) -> Vec<String> {
    entry["result"]["tools"]
        .as_array()
        .expect("tools/list result")
        .iter()
        .filter_map(|t| t["name"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn a_worker_reaches_done_through_the_bridge() {
    let rig = rig("worker-done");
    let store = store_with_tools(&rig.dir, true);
    let (manager, rx) = manager();
    bind_processes(&manager, &rig.tools);
    let call = json!({ "tool": "done", "args": { "outcome": "succeeded", "summary": "ok" } });
    let (launch, log) = mcp_agent_calling(&rig, &call);
    let tools = tools_for_session(&rig.tools, &store, "w1", "qwen-code", true, true).unwrap();
    manager
        .start("w1", &cwd(), &launch, tools.servers)
        .expect("start");
    manager.prompt("w1", "mcp", &[]).unwrap();

    let emitted = rig.calls.recv_timeout(WAIT).expect("a tool call");
    assert_eq!(emitted.session_id, "w1");
    assert_eq!(emitted.tool, "done");
    assert_eq!(
        emitted.args,
        json!({ "outcome": "succeeded", "summary": "ok" })
    );
    rig.tools.respond(&emitted.call_id, true, "recorded");

    wait_for(&rx, |e| agent_text(e).as_deref() == Some("mcp:recorded"));
    let entries = logged(&log);
    assert_eq!(tool_names_in(&entries[1]), vec!["done"]);
    assert!(entries[0]["result"].get("instructions").is_none());
    manager.stop("w1");
    rig.tools.shutdown();
}

#[test]
fn a_worker_cannot_call_any_other_tool_through_the_bridge() {
    let rig = rig("worker-other");
    let store = store_with_tools(&rig.dir, true);
    for (n, tool) in ["start_worker", "show_artifact", "start_session"]
        .into_iter()
        .enumerate()
    {
        let (manager, rx) = manager();
        bind_processes(&manager, &rig.tools);
        let call = json!({ "tool": tool, "args": { "agent": "qwen", "task": "x", "path": "a.html", "brief": "x" } });
        let (launch, log) = mcp_agent_calling(&rig, &call);
        let id = format!("w{n}");
        let tools = tools_for_session(&rig.tools, &store, &id, "qwen-code", true, true).unwrap();
        manager
            .start(&id, &cwd(), &launch, tools.servers)
            .expect("start");
        manager.prompt(&id, "mcp", &[]).unwrap();

        wait_for(&rx, |e| {
            agent_text(e).is_some_and(|t| t.contains("Unknown tool."))
        });
        assert!(
            rig.calls.recv_timeout(Duration::from_millis(300)).is_err(),
            "{tool} emitted a call"
        );
        assert_eq!(tool_names_in(&logged(&log)[1]), vec!["done"]);
        let _ = fs::remove_file(&log);
        manager.stop(&id);
    }
    rig.tools.shutdown();
}

#[test]
fn a_worker_gets_no_tools_when_the_setting_is_off_or_it_was_not_asked_for() {
    let rig = rig("worker-gate");
    let off = store_with_tools(&rig.dir.join("off"), false);
    let on = store_with_tools(&rig.dir.join("on"), true);
    // The setting is off: nothing, not even computer use.
    let cu = store_with(&rig.dir.join("cu"), false, true);
    for store in [&off, &cu] {
        let none = tools_for_session(&rig.tools, store, "w", "qwen-code", true, true).unwrap();
        assert_eq!(none.servers, json!([]));
        assert_eq!(none.path, None);
    }
    // Not asked for tools at all: a worker flag changes nothing.
    let none = tools_for_session(&rig.tools, &on, "w", "qwen-code", false, true).unwrap();
    assert_eq!(none.servers, json!([]));
    assert_eq!(none.path, None);
    // A worker has the agent tools but, even with the setting on, no computer use (its
    // capabilities are asserted in the unit tests of agent_tools::commands).
    let both = store_with(&rig.dir.join("both"), true, true);
    let worker = tools_for_session(&rig.tools, &both, "w2", "qwen-code", true, true).unwrap();
    assert_eq!(worker.path, Some(ToolsPath::Mcp));
    assert!(worker.agent_tools);
    rig.tools.shutdown();
}

#[test]
fn a_disabled_session_gets_no_server_and_the_fake_agent_says_so() {
    let rig = rig("off");
    let (manager, rx) = manager();
    bind_processes(&manager, &rig.tools);
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
    bind_processes(&manager, &rig.tools);
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

use zorvo_lib::agent_tools::commands::{servers_for_session, tools_for_session, with_tools_env};
use zorvo_lib::agent_tools::ToolsPath;
use zorvo_lib::store::AppStore;

fn store_with(dir: &std::path::Path, agent_tools: bool, computer_use: bool) -> AppStore {
    let store = AppStore::new(dir.join("store"));
    let mut state = store.load_state().expect("a fresh state");
    state.settings.agent_tools = agent_tools;
    state.settings.computer_use = computer_use;
    store.save_state(&state).expect("the state saves");
    store
}

#[test]
fn computer_use_alone_still_passes_zorvos_server() {
    let rig = rig("cu-alone");
    let store = store_with(&rig.dir, false, true);
    let mcp = tools_for_session(&rig.tools, &store, "s1", "qwen-code", true, false).unwrap();
    assert_eq!(mcp.servers[0]["name"], "zorvo");
    assert_eq!(mcp.path, Some(ToolsPath::Mcp));
    // The server is there, but not the agent tools: nothing may tell this agent to show a page.
    assert!(!mcp.agent_tools);
    let command = tools_for_session(&rig.tools, &store, "s2", "pi-acp", true, false).unwrap();
    assert_eq!(command.path, Some(ToolsPath::Command));
    assert!(!command.agent_tools);
    let none = tools_for_session(
        &rig.tools,
        &store_with(&rig.dir.join("off"), false, false),
        "s3",
        "qwen-code",
        true,
        false,
    )
    .unwrap();
    assert_eq!(none.path, None);
}

#[test]
fn a_fork_has_the_agent_tools_only_when_the_setting_gives_them() {
    // A fork reaches Zorvo through servers_for_session, not tools_for_session: the page note
    // follows its flag the same way.
    let rig = rig("fork-flag");
    let computer_use = store_with(&rig.dir.join("cu"), false, true);
    let alone = servers_for_session(&rig.tools, &computer_use, "f1", true).unwrap();
    assert_eq!(alone.path, Some(ToolsPath::Mcp));
    assert!(!alone.agent_tools);

    let both = store_with(&rig.dir.join("both"), true, true);
    let with_tools = servers_for_session(&rig.tools, &both, "f2", true).unwrap();
    assert_eq!(with_tools.path, Some(ToolsPath::Mcp));
    assert!(with_tools.agent_tools);

    let not_asked = servers_for_session(&rig.tools, &both, "f3", false).unwrap();
    assert_eq!(not_asked.path, None);
    assert!(!not_asked.agent_tools);
}

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
    let call = json!({ "tool": "start_worker", "args": { "agent": "qwen", "task": "x" } });
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

    let command = tools_for_session(&rig.tools, &on, "s1", "pi-acp", true, false).unwrap();
    assert_eq!(command.servers, json!([]));
    assert_eq!(command.env.len(), 3);
    assert_eq!(command.path, Some(ToolsPath::Command));

    let mcp = tools_for_session(&rig.tools, &on, "s2", "qwen-code", true, false).unwrap();
    assert_eq!(mcp.servers[0]["name"], "zorvo");
    assert!(mcp.env.is_empty());
    assert_eq!(mcp.path, Some(ToolsPath::Mcp));
    assert!(mcp.agent_tools);

    // The webview did not ask, or the setting is off: nothing, on either path.
    let off = store_with_tools(&rig.dir.join("off"), false);
    for (store, asked) in [(&on, false), (&off, true)] {
        for agent in ["pi-acp", "qwen-code"] {
            let none = tools_for_session(&rig.tools, store, "s3", agent, asked, false).unwrap();
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
    bind_processes(&manager, &rig.tools);
    let (launch, env_log, params_log, _) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true, false).unwrap();
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
    bind_processes(&manager, &rig.tools);
    let (launch, env_log, params_log, _) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "qwen-code", true, false).unwrap();
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
    bind_processes(&manager, &rig.tools);
    let (launch, _, _, run_log) = command_agent(&rig, &[]);
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true, false).unwrap();
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
    assert_eq!(call.tool, "start_worker");
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
    let tools = tools_for_session(&rig.tools, &store, "s1", "pi-acp", true, false).unwrap();
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

/// Binds every session the manager starts to its agent process, as the app does.
fn bind_processes(
    manager: &std::sync::Arc<zorvo_lib::acp::manager::AcpManager>,
    tools: &std::sync::Arc<AgentTools>,
) {
    let tools = std::sync::Arc::clone(tools);
    manager.set_process_listener(std::sync::Arc::new(move |session, pid| {
        if let Some(process) = zorvo_lib::agent_tools::peer::ProcessId::of(pid as i32) {
            tools.bind_process(session, process);
        }
    }));
}

#[test]
fn the_fake_agent_shows_a_visual_through_the_bridge() {
    let rig = rig("visual");
    let (manager, rx) = manager();
    bind_processes(&manager, &rig.tools);
    let call =
        json!({ "tool": "show_visual", "args": { "title": "Flow", "code": "<svg><rect/></svg>" } });
    let (launch, log) = mcp_agent_calling(&rig, &call);
    manager
        .start("v1", &cwd(), &launch, rig.tools.servers_for("v1", true))
        .expect("start");
    manager.prompt("v1", "mcp", &[]).unwrap();

    let emitted = rig.calls.recv_timeout(WAIT).expect("a tool call");
    assert_eq!(emitted.tool, "show_visual");
    assert_eq!(emitted.args["title"], "Flow");
    assert_eq!(emitted.args["code"], "<svg><rect/></svg>");
    rig.tools
        .respond(&emitted.call_id, true, "{\"shown\":true}");

    wait_for(&rx, |e| {
        agent_text(e).as_deref() == Some("mcp:{\"shown\":true}")
    });
    let entries = logged(&log);
    assert!(tool_names_in(&entries[1]).contains(&"show_visual".to_string()));
    manager.stop("v1");
    rig.tools.shutdown();
}
