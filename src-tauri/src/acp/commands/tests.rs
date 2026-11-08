use std::collections::BTreeSet;
use std::os::unix::fs::PermissionsExt;

use super::*;
use crate::installer::{plan::InstalledTools, runtimes::MIN_USER_NODE_MAJOR};
use crate::private_mode::device::{SecretStore, NEARAI_KEY};
use crate::private_mode::testing::Harness;
use crate::registry::{resolve::SystemTools, Catalog, BUNDLED_HISTORY};

#[test]
fn update_events_carry_the_raw_update() {
    let payload = event_payload(&AcpEvent::Update {
        session_id: "s-1".into(),
        update: json!({ "sessionUpdate": "agent_message_chunk" }),
    });

    assert_eq!(payload["kind"], "update");
    assert_eq!(payload["sessionId"], "s-1");
    assert_eq!(payload["update"]["sessionUpdate"], "agent_message_chunk");
}

#[test]
fn permission_events_carry_the_request_id_tool_call_and_options() {
    let payload = event_payload(&AcpEvent::PermissionRequest {
        session_id: "s-1".into(),
        request_id: json!("perm-1"),
        params: json!({ "toolCall": { "title": "Run ls" }, "options": [{ "optionId": "allow" }] }),
    });

    assert_eq!(payload["kind"], "permission");
    assert_eq!(payload["requestId"], "perm-1");
    assert_eq!(payload["toolCall"]["title"], "Run ls");
    assert_eq!(payload["options"][0]["optionId"], "allow");
}

#[test]
fn turn_end_events_report_the_stop_reason_or_the_error() {
    let ok = event_payload(&AcpEvent::TurnEnded {
        session_id: "s".into(),
        stop_reason: Ok("end_turn".into()),
    });
    assert_eq!(ok["stopReason"], "end_turn");

    let failed = event_payload(&AcpEvent::TurnEnded {
        session_id: "s".into(),
        stop_reason: Err("boom".into()),
    });
    assert_eq!(failed["error"], "boom");
    assert!(failed.get("stopReason").is_none());
}

#[test]
fn elicitation_events_carry_the_key_and_view() {
    let request = event_payload(&AcpEvent::Elicitation {
        session_id: "s-1".into(),
        key: "el-3".into(),
        view: json!({ "mode": "form", "message": "Name?", "fields": [] }),
    });
    assert_eq!(
        request,
        json!({ "sessionId": "s-1", "kind": "elicitation", "key": "el-3",
                "request": { "mode": "form", "message": "Name?", "fields": [] } })
    );

    let complete = event_payload(&AcpEvent::ElicitationComplete {
        session_id: "s-1".into(),
        key: "el-4".into(),
    });
    assert_eq!(
        complete,
        json!({ "sessionId": "s-1", "kind": "elicitation-complete", "key": "el-4" })
    );
}

#[test]
fn agent_path_puts_zorvos_dirs_around_the_users_path() {
    let node = vec!["/zorvo/node/bin".to_string()];
    let extras = vec!["/zorvo/uv".to_string(), "/zorvo/pi/bin".to_string()];

    assert_eq!(agent_path(&[], Some("/usr/bin:/bin"), None, &[]), None);
    assert_eq!(
        agent_path(&node, Some("/usr/bin:/bin"), Some("/ignored"), &extras).as_deref(),
        Some("/zorvo/node/bin:/usr/bin:/bin:/zorvo/uv:/zorvo/pi/bin")
    );
    assert_eq!(
        agent_path(&[], None, None, &extras).as_deref(),
        Some("/zorvo/uv:/zorvo/pi/bin")
    );
}

#[test]
fn without_the_login_shell_env_the_agent_keeps_the_process_path() {
    let node = vec!["/zorvo/node/bin".to_string()];

    assert_eq!(
        agent_path(&node, None, Some("/usr/bin:/bin"), &[]).as_deref(),
        Some("/zorvo/node/bin:/usr/bin:/bin")
    );
}

/// A fresh store and an empty folder it does not know yet, both removed on drop.
struct Scratch {
    root: std::path::PathBuf,
}

impl Scratch {
    fn new(tag: &str) -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "zorvo-acp-commands-{tag}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("data")).expect("data dir");
        std::fs::create_dir_all(root.join("folder")).expect("folder");
        Self { root }
    }

    fn store(&self) -> AppStore {
        AppStore::new(self.root.join("data"))
    }

    fn folder(&self) -> String {
        self.root.join("folder").to_string_lossy().to_string()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn an_agent_is_not_launched_in_a_folder_that_is_not_a_workspace() {
    let scratch = Scratch::new("unknown");
    let store = scratch.store();

    let err = launch_in_workspace(&store, &scratch.folder(), "claude-acp").unwrap_err();

    assert!(
        err.contains("is not one of your workspaces"),
        "unexpected: {err}"
    );
}

#[test]
fn a_remembered_workspace_passes_the_folder_check() {
    let scratch = Scratch::new("remembered");
    let store = scratch.store();
    store
        .remember_workspace(&scratch.folder())
        .expect("remember the folder");

    let err = launch_in_workspace(&store, &scratch.folder(), "no-such-agent").unwrap_err();

    assert!(
        err.contains("Unknown agent profile 'no-such-agent'"),
        "unexpected: {err}"
    );
}

#[test]
fn a_sign_in_with_a_bad_terminal_id_is_refused() {
    let scratch = Scratch::new("signin-bad-id");

    let err = start_terminal_sign_in(
        &quiet_manager(),
        &PtySessionManager::default_manager(),
        &scratch.store(),
        "claude-acp",
        &scratch.folder(),
        "terminal-login",
        "session-1",
    )
    .unwrap_err();

    assert_eq!(err, "Not a sign-in terminal id");
}

#[test]
fn a_sign_in_is_not_started_in_a_folder_that_is_not_a_workspace() {
    let scratch = Scratch::new("signin-unknown");

    let err = start_terminal_sign_in(
        &quiet_manager(),
        &PtySessionManager::default_manager(),
        &scratch.store(),
        "claude-acp",
        &scratch.folder(),
        "terminal-login",
        "signin-1",
    )
    .unwrap_err();

    assert!(
        err.contains("is not one of your workspaces"),
        "unexpected: {err}"
    );
}

#[test]
fn a_setup_is_not_started_in_a_folder_that_is_not_a_workspace() {
    let scratch = Scratch::new("setup-unknown");

    let err = start_agent_setup(
        &quiet_manager(),
        &PtySessionManager::default_manager(),
        &scratch.store(),
        "qwen-code",
        &scratch.folder(),
        "signin-1",
    )
    .unwrap_err();

    assert!(
        err.contains("is not one of your workspaces"),
        "unexpected: {err}"
    );
}

#[test]
fn a_setup_needs_a_sign_in_terminal_id() {
    let scratch = Scratch::new("setup-id");

    let err = start_agent_setup(
        &quiet_manager(),
        &PtySessionManager::default_manager(),
        &scratch.store(),
        "qwen-code",
        &scratch.folder(),
        "shell-1",
    )
    .unwrap_err();

    assert_eq!(err, "Not a sign-in terminal id");
}

#[test]
fn scratch_roots_are_unique_within_a_process() {
    let first = Scratch::new("same");
    let second = Scratch::new("same");

    assert_ne!(first.root, second.root);
}

fn quiet_manager() -> AcpManager {
    AcpManager::new(Box::new(|_| {}))
}

#[test]
fn a_session_is_not_forked_into_a_folder_that_is_not_a_workspace() {
    let scratch = Scratch::new("fork-unknown");
    let store = scratch.store();

    let Err(err) = fork_in_workspace(
        &quiet_manager(),
        &store,
        "source",
        "fork",
        &scratch.folder(),
    ) else {
        panic!("the fork is refused");
    };

    assert!(
        err.contains("is not one of your workspaces"),
        "unexpected: {err}"
    );
}

#[test]
fn a_session_is_forked_in_a_remembered_workspace() {
    let scratch = Scratch::new("fork-known");
    let store = scratch.store();
    store
        .remember_workspace(&scratch.folder())
        .expect("remember");

    // Past the folder check, the manager refuses an unknown source session.
    let Err(err) = fork_in_workspace(
        &quiet_manager(),
        &store,
        "source",
        "fork",
        &scratch.folder(),
    ) else {
        panic!("the fork is refused");
    };

    assert!(
        err.contains("Session 'source' not found"),
        "unexpected: {err}"
    );
}

/// A ready registry agent run through Zorvo's Node, whose `bin` goes first on `PATH`.
fn agent_on_zorvos_node() -> AgentProfile {
    let mut profile = AgentProfile::new(
        "gemini".to_string(),
        "Gemini CLI".to_string(),
        "npx".to_string(),
    );
    profile.detected = true;
    profile.acp_program_path = Some("/zorvo/node/bin/npx".to_string());
    profile.acp_path_prepend = vec!["/zorvo/node/bin".to_string()];
    profile
}

fn path_of(launch: &AcpLaunch) -> Option<&str> {
    launch
        .env
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.as_str())
}

#[test]
fn a_launch_puts_the_prepend_dir_first_on_the_users_path() {
    let user_env = || BTreeMap::from([("PATH".to_string(), "/usr/bin:/bin".to_string())]);

    let launch = launch_from(
        agent_on_zorvos_node(),
        user_env,
        Some("/ignored"),
        |_, _| BTreeMap::new(),
    )
    .expect("it launches");

    assert_eq!(path_of(&launch), Some("/zorvo/node/bin:/usr/bin:/bin"));
}

#[test]
fn a_launch_without_the_login_path_falls_back_to_the_process_path() {
    let launch = launch_from(
        agent_on_zorvos_node(),
        BTreeMap::new,
        Some("/usr/bin:/bin"),
        |_, _| BTreeMap::new(),
    )
    .expect("it launches");

    assert_eq!(path_of(&launch), Some("/zorvo/node/bin:/usr/bin:/bin"));
}

/// Later than every version in the bundle, so each one is old enough.
const FIXED_NOW: u64 = 4_000_000_000;

#[test]
fn a_legacy_id_launches_its_registry_agent() {
    let scratch = Scratch::new("legacy");
    let bin = scratch.root.join("bin");
    std::fs::create_dir_all(&bin).expect("bin dir");
    let npx = bin.join("npx");
    std::fs::write(&npx, "#!/bin/sh\n").expect("write fake npx");
    std::fs::set_permissions(&npx, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let catalog = Catalog::bundled(BUNDLED_HISTORY);
    let npm = BTreeSet::new();
    let path = bin.to_string_lossy().to_string();
    // The user's own Node is new enough, so their `npx` runs the agent.
    let installed = InstalledTools {
        user_node_major: Some(MIN_USER_NODE_MAJOR),
        ..InstalledTools::none()
    };
    let tools = SystemTools {
        path_var: Some(&path),
        npm_globals: &npm,
        installed: &installed,
    };

    let profile = profile_to_launch(&catalog, &tools, "claude-code", &BTreeMap::new(), FIXED_NOW)
        .expect("claude-code is known");
    assert_eq!(profile.id, "claude-acp");
    let launch = launch_from(profile, BTreeMap::new, None, |id, version| {
        catalog.launch_env(id, version)
    })
    .expect("it launches");

    assert_eq!(launch.program, npx.to_string_lossy());
    assert_eq!(launch.args.first().map(String::as_str), Some("-y"));
    assert!(
        launch
            .args
            .get(1)
            .is_some_and(|a| a.starts_with("@agentclientprotocol/claude-agent-acp@")),
        "{:?}",
        launch.args
    );
}

#[test]
fn an_unknown_profile_id_is_named_in_the_error() {
    let catalog = Catalog::bundled(BUNDLED_HISTORY);
    let npm = BTreeSet::new();
    let installed = InstalledTools::none();
    let tools = SystemTools {
        path_var: Some(""),
        npm_globals: &npm,
        installed: &installed,
    };

    let err = profile_to_launch(
        &catalog,
        &tools,
        "no-such-agent",
        &BTreeMap::new(),
        FIXED_NOW,
    )
    .unwrap_err();

    assert!(
        err.contains("Unknown agent profile 'no-such-agent'"),
        "unexpected: {err}"
    );
}

#[test]
fn an_agent_not_built_for_this_mac_is_refused_by_name() {
    use crate::registry::schema::{BinaryTarget, Distribution, RegistryEntry};

    let entry = RegistryEntry {
        id: "linuxy".into(),
        name: "Linuxy".into(),
        version: "1.0.0".into(),
        description: None,
        icon: None,
        distribution: Distribution::Binary {
            platforms: BTreeMap::from([(
                "linux-x86_64".to_string(),
                BinaryTarget {
                    archive: "https://example.com/linuxy.tar.gz".into(),
                    cmd: "./linuxy".into(),
                    args: Vec::new(),
                    sha256: "a".repeat(64),
                    env: BTreeMap::new(),
                },
            )]),
        },
    };
    let mut history = crate::registry::history::VersionHistory::default();
    history.observe(std::slice::from_ref(&entry), 1);
    let catalog = Catalog::bundled(&history.to_json());
    let npm = BTreeSet::new();
    let installed = InstalledTools::none();
    let tools = SystemTools {
        path_var: Some(""),
        npm_globals: &npm,
        installed: &installed,
    };

    let err =
        profile_to_launch(&catalog, &tools, "linuxy", &BTreeMap::new(), FIXED_NOW).unwrap_err();

    assert_eq!(err, "Linuxy is not available for this Mac");
}

fn plain_launch(env: &[(&str, &str)]) -> AcpLaunch {
    AcpLaunch {
        program: "npx".to_string(),
        args: vec!["-y".to_string(), "@qwen-code/qwen-code@0.26.1".to_string()],
        env: env
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect(),
        private: false,
        mcp_servers: Vec::new(),
    }
}

fn harness_with_key() -> Harness {
    let harness = Harness::new();
    harness
        .store
        .set(NEARAI_KEY, "sk-zorvo")
        .expect("seed the key");
    harness
}

#[test]
fn a_plain_session_launch_is_the_plain_launch_and_never_touches_private_mode() {
    let harness = Harness::new();
    let base = plain_launch(&[("PATH", "/usr/bin")]);

    let launch = session_launch("s1", || Ok(base.clone()), &harness.mode, "qwen-code", None)
        .expect("launches");

    assert_eq!(launch, base);
    assert!(!launch.private);
    assert!(launch.env.iter().all(|(key, _)| key != "OPENAI_API_KEY"));
    assert!(harness.api.calls().is_empty());
}

#[test]
fn a_plain_session_of_any_agent_is_untouched_by_a_stored_key() {
    let harness = harness_with_key();
    for id in ["qwen-code", "claude-acp", "codex-acp"] {
        let base = plain_launch(&[("OPENAI_API_KEY", "user")]);

        let launch =
            session_launch("s1", || Ok(base.clone()), &harness.mode, id, None).expect("launches");

        assert_eq!(launch, base, "{id}");
    }
}

#[test]
fn a_plain_session_launch_error_is_passed_on() {
    let harness = Harness::new();

    let err = session_launch(
        "s1",
        || Err("Qwen Code is not installed".to_string()),
        &harness.mode,
        "qwen-code",
        None,
    )
    .unwrap_err();

    assert_eq!(err, "Qwen Code is not installed");
}

#[test]
fn a_private_session_runs_on_a_proxy_token_and_the_loopback_endpoint() {
    let harness = harness_with_key();
    let base = plain_launch(&[("OPENAI_API_KEY", "user"), ("OPENAI_BASE_URL", "http://x")]);

    let launch = session_launch(
        "s1",
        || Ok(base.clone()),
        &harness.mode,
        "qwen-code",
        Some("Qwen/Qwen3.8-27B"),
    )
    .expect("launches");

    assert!(launch.private);
    let env = |name: &str| {
        launch
            .env
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    let token = env("OPENAI_API_KEY").expect("proxy token");
    let base_url = env("OPENAI_BASE_URL").expect("proxy base URL");
    assert_eq!(token.len(), 64, "{token}");
    assert!(
        token.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "{token}"
    );
    assert_ne!(token, "sk-zorvo");
    assert!(base_url.starts_with("http://127.0.0.1:"), "{base_url}");
    assert!(base_url.ends_with("/v1"), "{base_url}");
    assert_eq!(env("OPENAI_MODEL"), Some("Qwen/Qwen3.8-27B"));
    assert!(launch.args.iter().all(|arg| !arg.contains("sk-zorvo")));
    assert_eq!(
        &launch.args[2..],
        [
            "--telemetry-log-prompts=false",
            "--auth-type",
            "openai",
            "--openai-base-url",
            base_url,
            "--model",
            "Qwen/Qwen3.8-27B",
        ]
    );
}

#[test]
fn a_private_session_without_a_key_asks_for_credits() {
    let harness = Harness::new();

    let err = session_launch(
        "s1",
        || Ok(plain_launch(&[])),
        &harness.mode,
        "qwen-code",
        Some("Qwen/Qwen3.8-27B"),
    )
    .unwrap_err();

    assert_eq!(err, "PRIVATE_CREDITS:{\"reason\":\"empty\"}");
    assert!(err.starts_with(PRIVATE_CREDITS_PREFIX));
}

#[test]
fn a_private_session_never_falls_back_to_a_plain_launch() {
    let harness = harness_with_key();
    harness.api.models.always(Err(PrivateError::Unreachable));

    let err = session_launch(
        "s1",
        || Ok(plain_launch(&[])),
        &harness.mode,
        "qwen-code",
        Some("Qwen/Qwen3.8-27B"),
    )
    .unwrap_err();

    assert_eq!(err, "unreachable");
}

#[test]
fn a_private_model_the_list_does_not_offer_is_refused() {
    let harness = harness_with_key();

    let err = session_launch(
        "s1",
        || Ok(plain_launch(&[])),
        &harness.mode,
        "qwen-code",
        Some("Other/Model-1"),
    )
    .unwrap_err();

    assert_eq!(err, "unknown_model");
}

#[test]
fn a_private_session_of_another_agent_is_refused_before_the_key_is_read() {
    let harness = harness_with_key();
    for id in ["claude-acp", "codex-acp"] {
        let err = session_launch(
            "s1",
            || Ok(plain_launch(&[])),
            &harness.mode,
            id,
            Some("Qwen/Qwen3.8-27B"),
        )
        .unwrap_err();

        assert_eq!(err, "not_qwen", "{id}");
    }
    assert!(harness.api.calls().is_empty());
}

#[test]
fn a_private_session_in_an_agent_that_cannot_start_reports_that_first() {
    let harness = harness_with_key();

    let err = session_launch(
        "s1",
        || Err("Qwen Code is not installed".to_string()),
        &harness.mode,
        "qwen-code",
        Some("Qwen/Qwen3.8-27B"),
    )
    .unwrap_err();

    assert_eq!(err, "Qwen Code is not installed");
    assert!(harness.api.calls().is_empty());
}

#[test]
fn a_private_session_is_checked_against_the_workspaces_like_any_other() {
    let scratch = Scratch::new("private-workspace");
    let harness = harness_with_key();

    for model in [None, Some("Qwen/Qwen3.8-27B")] {
        let err = launch_for_session(
            &scratch.store(),
            &harness.mode,
            "s1",
            &scratch.folder(),
            "qwen-code",
            model,
        )
        .unwrap_err();

        assert!(
            err.contains("is not one of your workspaces"),
            "{model:?}: {err}"
        );
    }
    assert!(harness.api.calls().is_empty());
}
