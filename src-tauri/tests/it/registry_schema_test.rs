use zorvo_lib::registry::history::VersionHistory;
use zorvo_lib::registry::schema::{
    current_platform, parse_registry, parse_registry_report, Distribution, RegistryEntry,
    UnavailableAgent, UnavailableReason,
};

const SHA: &str = "c2d0fecd27acf6e08be02c1f5d384614d07495587766bcc4a6bff3971749bb64";

fn npx(id: &str, package: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"N","version":"1.0.0","distribution":{{"npx":{{"package":"{package}","args":["--acp"]}}}}}}"#
    )
}

fn target(archive: &str, cmd: &str, sha: &str) -> String {
    format!(r#"{{"archive":"{archive}","cmd":"{cmd}","args":["acp"],"sha256":"{sha}"}}"#)
}

fn binary_on(id: &str, targets: &[(&str, String)]) -> String {
    let body: Vec<String> = targets
        .iter()
        .map(|(platform, t)| format!(r#""{platform}":{t}"#))
        .collect();
    format!(
        r#"{{"id":"{id}","name":"B","version":"1.0.0","distribution":{{"binary":{{{}}}}}}}"#,
        body.join(",")
    )
}

fn binary(id: &str, archive: &str, cmd: &str, sha: &str) -> String {
    binary_on(id, &[(current_platform(), target(archive, cmd, sha))])
}

fn doc(entries: &[String]) -> String {
    format!(
        r#"{{"version":"1.0.0","agents":[{}],"extensions":[]}}"#,
        entries.join(",")
    )
}

fn ids(entries: &[RegistryEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.id.as_str()).collect()
}

#[test]
fn parses_valid_npx_uvx_and_binary_entries() {
    let uvx = r#"{"id":"py","name":"Py","version":"2.0.0","description":"d","icon":"https://x/i.svg","distribution":{"uvx":{"package":"py-agent@2.0.0","args":["acp"]}},"license":"MIT","authors":["a"]}"#;
    let json = doc(&[
        npx("gemini", "@google/gemini-cli@0.64.0"),
        uvx.to_string(),
        binary(
            "opencode",
            "https://github.com/o/r/releases/download/v1/o.zip",
            "./opencode",
            SHA,
        ),
    ]);
    let entries = parse_registry(&json).unwrap();
    assert_eq!(ids(&entries), vec!["gemini", "py", "opencode"]);
    assert_eq!(
        entries[0].distribution,
        Distribution::Npx {
            package: "@google/gemini-cli@0.64.0".into(),
            args: vec!["--acp".into()],
            env: Default::default(),
        }
    );
    assert_eq!(entries[1].icon.as_deref(), Some("https://x/i.svg"));
    match &entries[1].distribution {
        Distribution::Uvx { package, args, .. } => {
            assert_eq!(package, "py-agent@2.0.0");
            assert_eq!(args, &vec!["acp".to_string()]);
        }
        other => panic!("expected uvx, got {other:?}"),
    }
    match &entries[2].distribution {
        Distribution::Binary { platforms } => {
            let t = &platforms[current_platform()];
            assert_eq!(t.cmd, "./opencode");
            assert_eq!(t.sha256, SHA);
            assert!(t.archive.starts_with("https://"));
        }
        other => panic!("expected binary, got {other:?}"),
    }
}

#[test]
fn entries_round_trip_through_the_registry_json_shape() {
    let json = doc(&[
        npx("gemini", "@google/gemini-cli@0.64.0"),
        binary("opencode", "https://h/o.zip", "./opencode", SHA),
    ]);
    let entries = parse_registry(&json).unwrap();
    let value = serde_json::to_value(&entries[0]).unwrap();
    assert_eq!(
        value["distribution"]["npx"]["package"],
        "@google/gemini-cli@0.64.0"
    );
    assert!(value["distribution"]["binary"].is_null());
    let back: Vec<RegistryEntry> =
        serde_json::from_value(serde_json::to_value(&entries).unwrap()).unwrap();
    assert_eq!(back, entries);
}

#[test]
fn skips_an_entry_whose_id_breaks_the_pattern() {
    let json = doc(&[npx("Bad_Id", "a@1.0.0"), npx("good-1", "b@1.0.0")]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["good-1"]);
}

#[test]
fn skips_a_binary_entry_whose_version_is_not_exact() {
    // A binary's version becomes a dir under `tools/agents/<id>/`.
    let with_version = |id: &str, version: &str| {
        binary(id, "https://x/a.tar.gz", "./a", SHA)
            .replace(r#""version":"1.0.0""#, &format!(r#""version":"{version}""#))
    };
    let json = doc(&[
        with_version("climbs", "../x"),
        with_version("short", "1.0"),
        with_version("pre", "1.0.0-beta.1"),
        binary("good", "https://x/a.tar.gz", "./a", SHA),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["pre", "good"]);
}

#[test]
fn keeps_a_package_entry_whose_version_is_not_exact() {
    // An npx or uvx version never becomes a path, and the package is pinned.
    let json = doc(&[
        npx("two-part", "a@1.0.0").replace(r#""version":"1.0.0""#, r#""version":"1.0""#),
        npx("good", "b@1.0.0"),
    ]);
    assert_eq!(
        ids(&parse_registry(&json).unwrap()),
        vec!["two-part", "good"]
    );
}

#[test]
fn skips_an_unpinned_package() {
    let json = doc(&[
        npx("a", "@x/y"),
        npx("b", "y@latest"),
        npx("c", "@x/y@1.2.3"),
        npx("d", "y@0.0.34"),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["c", "d"]);
}

#[test]
fn skips_a_binary_without_https_or_a_64_hex_sha256() {
    let json = doc(&[
        binary("a", "http://h/o.zip", "./o", SHA),
        binary("b", "https://h/o.zip", "./o", "abc"),
        binary("c", "https://h/o.zip", "./o", SHA),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["c"]);
}

#[test]
fn skips_a_cmd_that_is_absolute_or_climbs() {
    let json = doc(&[
        binary("a", "https://h/o.zip", "/bin/sh", SHA),
        binary("b", "https://h/o.zip", "../x", SHA),
        binary("c", "https://h/o.zip", "bin/../../x", SHA),
        binary("d", "https://h/o.zip", "./bin/o", SHA),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["d"]);
}

#[test]
fn skips_an_entry_with_no_distribution() {
    let none = r#"{"id":"none","name":"N","version":"1.0.0","distribution":{}}"#;
    let json = doc(&[none.into(), npx("ok", "a@1.0.0")]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["ok"]);
}

#[test]
fn rejects_a_document_without_agents() {
    assert!(parse_registry("{}").is_err());
    assert!(parse_registry("not json").is_err());
}

#[test]
fn current_platform_names_os_and_arch() {
    let p = current_platform();
    assert!(p.contains('-'), "got {p}");
}

#[test]
fn keeps_an_id_that_starts_with_a_digit() {
    let json = doc(&[npx("7zip-agent", "a@1.0.0")]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["7zip-agent"]);
}

#[test]
fn ignores_an_invalid_target_for_another_platform() {
    let good = target("https://h/o.zip", "./o", SHA);
    let bad = target("https://h/o.zip", ".\\\\agent.exe", SHA);
    let json = doc(&[binary_on(
        "mixed",
        &[(current_platform(), good), ("windows-x86_64-other", bad)],
    )]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["mixed"]);
}

#[test]
fn binary_entry_without_this_macs_target_is_kept() {
    let good = target("https://h/o.zip", "./o", SHA);
    let json = doc(&[
        binary_on("elsewhere", &[("linux-x86_64", good)]),
        npx("ok", "a@1.0.0"),
    ]);
    assert_eq!(
        ids(&parse_registry(&json).unwrap()),
        vec!["elsewhere", "ok"]
    );
}

#[test]
fn binary_entry_with_a_broken_target_for_this_mac_is_dropped() {
    let bad = target("http://h/o.zip", "./o", SHA);
    let good = target("https://h/o.zip", "./o", SHA);
    let json = doc(&[
        binary_on(
            "broken",
            &[(current_platform(), bad), ("linux-x86_64", good)],
        ),
        npx("ok", "a@1.0.0"),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["ok"]);
}

fn uvx(id: &str, package: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"U","version":"1.0.0","distribution":{{"uvx":{{"package":"{package}"}}}}}}"#
    )
}

fn npx_env(id: &str, env: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"N","version":"1.0.0","distribution":{{"npx":{{"package":"p@1.0.0","env":{env}}}}}}}"#
    )
}

#[test]
fn uvx_accepts_pypi_pins_but_npx_does_not() {
    let json = doc(&[
        uvx("pypi", "fast-agent-acp==0.10.1"),
        uvx("at", "agent@1.0.0"),
        uvx("loose", "agent"),
        uvx("range", "agent==1.0"),
        npx("npm-eq", "agent==1.0.0"),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["pypi", "at"]);
}

#[test]
fn env_is_parsed_and_round_trips() {
    let json = doc(&[
        npx_env("withenv", r#"{"AUGMENT_DISABLE_AUTO_UPDATE":"1"}"#),
        binary_on(
            "bin",
            &[(
                current_platform(),
                format!(
                    r#"{{"archive":"https://h/o.zip","cmd":"./o","sha256":"{SHA}","env":{{"VT_ACP_ENABLED":"1"}}}}"#
                ),
            )],
        ),
    ]);
    let entries = parse_registry(&json).unwrap();
    assert_eq!(ids(&entries), vec!["withenv", "bin"]);
    match &entries[0].distribution {
        Distribution::Npx { env, .. } => assert_eq!(env["AUGMENT_DISABLE_AUTO_UPDATE"], "1"),
        other => panic!("expected npx, got {other:?}"),
    }
    let value = serde_json::to_value(&entries).unwrap();
    assert_eq!(
        value[0]["distribution"]["npx"]["env"]["AUGMENT_DISABLE_AUTO_UPDATE"],
        "1"
    );
    let back: Vec<RegistryEntry> = serde_json::from_value(value).unwrap();
    assert_eq!(back, entries);
    // No env key is written when there is none.
    let plain = parse_registry(&doc(&[npx("plain", "p@1.0.0")])).unwrap();
    let plain = serde_json::to_value(&plain[0]).unwrap();
    assert!(plain["distribution"]["npx"]["env"].is_null());
}

#[test]
fn unsafe_env_names_skip_the_entry() {
    let json = doc(&[
        npx_env("ok", r#"{"GOOD_NAME":"1"}"#),
        npx_env("lower", r#"{"lower":"1"}"#),
        npx_env("dyld", r#"{"DYLD_INSERT_LIBRARIES":"x"}"#),
        npx_env("ld", r#"{"LD_PRELOAD":"x"}"#),
        npx_env("path", r#"{"PATH":"x"}"#),
        npx_env("home", r#"{"HOME":"x"}"#),
        npx_env("node", r#"{"NODE_OPTIONS":"x"}"#),
        binary_on(
            "binbad",
            &[(
                current_platform(),
                format!(
                    r#"{{"archive":"https://h/o.zip","cmd":"./o","sha256":"{SHA}","env":{{"PATH":"x"}}}}"#
                ),
            )],
        ),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["ok"]);
}

#[test]
fn skips_a_package_name_that_is_an_option_or_a_url() {
    let json = doc(&[
        npx("opt", "--registry=https://evil.example/@1.0.0"),
        npx("url", "https://evil.example/a.tgz#@1.0.0"),
        uvx("git", "git+https://x/y@1.0.0"),
        uvx("index", "--index-url=https://x==1.0.0"),
        npx("dash", "-x@1.0.0"),
        npx("dot", ".x@1.0.0"),
        npx("deep", "a/b@1.0.0"),
        npx("scoped", "@scope-1/pkg.name_x@1.0.0"),
        npx("plain", "pkg-name.js@1.0.0"),
        uvx("pypi", "Fast_Agent-acp.x==0.10.1"),
    ]);
    assert_eq!(
        ids(&parse_registry(&json).unwrap()),
        vec!["scoped", "plain", "pypi"]
    );
}

#[test]
fn env_that_steers_package_managers_or_the_network_skips_the_entry() {
    let denied = [
        "NPM_CONFIG_REGISTRY",
        "UV_INDEX_URL",
        "PIP_INDEX_URL",
        "PYTHONPATH",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "BASH_ENV",
        "ENV",
        "SHELL",
    ];
    let mut entries: Vec<String> = denied
        .iter()
        .map(|key| {
            npx_env(
                &key.to_lowercase().replace('_', "-"),
                &format!(r#"{{"{key}":"x"}}"#),
            )
        })
        .collect();
    entries.push(npx_env("ok", r#"{"GOOD_NAME":"1"}"#));
    assert_eq!(ids(&parse_registry(&doc(&entries)).unwrap()), vec!["ok"]);
}

#[test]
fn keeps_the_env_keys_real_registry_agents_use() {
    let json = doc(&[
        npx_env("auggie", r#"{"AUGMENT_DISABLE_AUTO_UPDATE":"1"}"#),
        npx_env(
            "factory-droid",
            r#"{"DROID_DISABLE_AUTO_UPDATE":"1","FACTORY_DROID_AUTO_UPDATE_ENABLED":"false"}"#,
        ),
        npx_env("fast-agent", r#"{"FAST_AGENT_MODEL":"m"}"#),
        npx_env(
            "vtcode",
            r#"{"VT_ACP_ENABLED":"1","VT_ACP_ZED_ENABLED":"1"}"#,
        ),
    ]);
    assert_eq!(
        ids(&parse_registry(&json).unwrap()),
        vec!["auggie", "factory-droid", "fast-agent", "vtcode"]
    );
}

#[test]
fn skips_an_id_that_collides_with_a_legacy_or_terminal_agent() {
    let json = doc(&[
        npx("claude-code", "a@1.0.0"),
        npx("codex", "a@1.0.0"),
        npx("qwen", "a@1.0.0"),
        npx("omp", "a@1.0.0"),
        npx("aider", "a@1.0.0"),
        npx("claude-acp", "a@1.0.0"),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["claude-acp"]);
}

#[test]
fn skips_a_binary_whose_cmd_is_an_interpreter_shell_or_package_runner() {
    let json = doc(&[
        binary("runs-node", "https://h/o.zip", "./node", SHA),
        binary("runs-bash", "https://h/o.zip", "./bash", SHA),
        binary("runs-npx", "https://h/o.zip", "bin/NPX", SHA),
        binary("runs-python", "https://h/o.zip", "python3", SHA),
        binary("opencode", "https://h/o.zip", "./opencode", SHA),
    ]);
    assert_eq!(ids(&parse_registry(&json).unwrap()), vec!["opencode"]);
}

#[test]
fn skips_a_binary_named_like_a_general_purpose_program() {
    let json = doc(&[
        binary("runs-git", "https://h/o.zip", "./git", SHA),
        binary("runs-python312", "https://h/o.zip", "./python3.12", SHA),
        binary("runs-awk", "https://h/o.zip", "./awk", SHA),
        binary("runs-node22", "https://h/o.zip", "./Node22", SHA),
        binary("runs-lua", "https://h/o.zip", "bin/lua5.4", SHA),
        binary("runs-swift", "https://h/o.zip", "./swift", SHA),
        binary("runs-ssh", "https://h/o.zip", "./ssh", SHA),
        binary("runs-curl", "https://h/o.zip", "./curl", SHA),
        binary("runs-pwsh", "https://h/o.zip", "./pwsh-preview", SHA),
        binary("opencode", "https://h/o.zip", "./opencode", SHA),
        binary("goose", "https://h/o.zip", "./goose", SHA),
        binary("cursor-agent", "https://h/o.zip", "./cursor-agent", SHA),
    ]);
    assert_eq!(
        ids(&parse_registry(&json).unwrap()),
        vec!["opencode", "goose", "cursor-agent"]
    );
}

/// The bundle with its binary entry's `cmd` for this machine replaced by `cmd`.
fn with_cmd(entry: &serde_json::Value, cmd: &str) -> String {
    let mut entry = entry.clone();
    entry["distribution"]["binary"][current_platform()]["cmd"] = cmd.into();
    format!(r#"{{"agents":[{entry}]}}"#)
}

/// No binary-only agent the bundle has for this machine is dropped for its
/// `cmd`: each one parses the same as with a neutral `cmd`, and is chosen as a
/// binary. (Some are skipped for other reasons, such as a missing sha256.)
/// An entry that also offers a package runs as that package instead.
#[test]
fn keeps_every_binary_agent_in_the_bundled_history() {
    let bundle: serde_json::Value =
        serde_json::from_str(include_str!("../../resources/registry-history.json")).unwrap();
    let agents = bundle["agents"].as_object().expect("agents object");
    let mut kept = 0;
    for (id, versions) in agents {
        for (version, record) in versions.as_object().expect("versions object") {
            let entry = &record["entry"];
            let Some(target) = entry["distribution"]["binary"].get(current_platform()) else {
                continue;
            };
            let cmd = target["cmd"].as_str().expect("cmd");
            let as_is = parse_registry(&with_cmd(entry, cmd)).unwrap();
            let neutral = parse_registry(&with_cmd(entry, "./zorvo-agent")).unwrap();
            assert_eq!(
                as_is.len(),
                neutral.len(),
                "{id} {version} ({cmd}) must not be skipped"
            );
            let offers_package =
                !entry["distribution"]["npx"].is_null() || !entry["distribution"]["uvx"].is_null();
            for chosen in &as_is {
                assert_eq!(
                    is_binary(chosen),
                    !offers_package,
                    "{id} {version} runs as a package when it offers one, else as its binary"
                );
            }
            kept += as_is.len();
        }
    }
    assert!(kept > 0, "the bundle has binary agents this machine keeps");
}

// Entries that offer several distribution kinds, and agents Zorvo lists but cannot offer.

const LIVE_SAMPLE: &str = include_str!("../fixtures/registry-live-sample.json");

fn live_entry(id: &str) -> RegistryEntry {
    let entries = parse_registry(LIVE_SAMPLE).unwrap();
    entries
        .into_iter()
        .find(|e| e.id == id)
        .unwrap_or_else(|| panic!("{id} is offered"))
}

fn unavailable(json: &str) -> Vec<UnavailableAgent> {
    parse_registry_report(json).unwrap().unavailable
}

/// An entry offering a binary for this Mac (`sha`) and an npx package.
fn binary_and_npx(id: &str, sha: &str, package: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"Both","version":"1.0.0","distribution":{{"npx":{{"package":"{package}","args":["acp"]}},"binary":{{"{platform}":{target}}}}}}}"#,
        platform = current_platform(),
        target = target("https://h/o.zip", "./o", sha),
    )
}

fn is_binary(entry: &RegistryEntry) -> bool {
    matches!(entry.distribution, Distribution::Binary { .. })
}

#[test]
fn live_kilo_and_sigit_entries_offer_both_kinds_and_run_as_their_pinned_package() {
    // The registry publishes `binary` and `npx` for both; they used to vanish.
    // The package wins on every platform, so the choice stored in the history
    // does not depend on the Mac that made it.
    for (id, package) in [
        ("kilo", "@kilocode/cli@7.8.18"),
        ("sigit", "@smbcloud/sigit@1.7.5"),
    ] {
        match live_entry(id).distribution {
            Distribution::Npx {
                package: chosen, ..
            } => assert_eq!(chosen, package),
            other => panic!("{id}: expected the npx package, got {other:?}"),
        }
    }
}

#[test]
fn the_chosen_distribution_is_stored_as_one_kind_and_reads_back_the_same() {
    // The real path: the catalog observes the entry, saves the history as JSON
    // and reads it back.
    let entry = live_entry("kilo");
    let mut history = VersionHistory::default();
    history.observe(std::slice::from_ref(&entry), 7);

    let json = history.to_json();
    let saved: serde_json::Value = serde_json::from_str(&json).unwrap();
    let kinds = saved["agents"]["kilo"][&entry.version]["entry"]["distribution"]
        .as_object()
        .unwrap();
    assert_eq!(kinds.len(), 1, "only the chosen kind is stored");

    let back = VersionHistory::from_json(&json).unwrap();
    assert_eq!(back.version("kilo", &entry.version), Some(&entry));
}

#[test]
fn a_pinned_package_beats_a_verified_binary_for_this_mac() {
    let json = doc(&[binary_and_npx("both", SHA, "a@1.0.0")]);
    let entries = parse_registry(&json).unwrap();
    assert!(matches!(
        entries[0].distribution,
        Distribution::Npx { ref package, .. } if package == "a@1.0.0"
    ));
}

#[test]
fn a_pinned_uvx_package_beats_a_verified_binary_for_this_mac() {
    let json = format!(
        r#"{{"id":"py","name":"P","version":"1.0.0","distribution":{{"uvx":{{"package":"py-agent==1.0.0"}},"binary":{{"{}":{}}}}}}}"#,
        current_platform(),
        target("https://h/o.zip", "./o", SHA)
    );
    let entries = parse_registry(&doc(&[json])).unwrap();
    assert!(matches!(entries[0].distribution, Distribution::Uvx { .. }));
}

#[test]
fn falls_back_to_the_pinned_package_when_the_binary_has_no_valid_checksum() {
    for sha in ["", "abc"] {
        let json = doc(&[binary_and_npx("both", sha, "a@1.0.0")]);
        let report = parse_registry_report(&json).unwrap();
        assert!(report.unavailable.is_empty());
        assert!(matches!(
            report.entries[0].distribution,
            Distribution::Npx { ref package, .. } if package == "a@1.0.0"
        ));
    }
}

/// An entry with a pinned npx package (args `acp`, env `GOOD`) and a binary for
/// this Mac whose `cmd` and env are given.
fn package_and_binary(cmd: &str, binary_env: &str) -> String {
    format!(
        r#"{{"id":"both","name":"B","version":"1.0.0","distribution":{{"npx":{{"package":"a@1.0.0","args":["acp"],"env":{{"GOOD":"1"}}}},"binary":{{"{}":{{"archive":"https://h/o.zip","cmd":"{cmd}","args":["--evil"],"sha256":"{SHA}","env":{binary_env}}}}}}}}}"#,
        current_platform()
    )
}

#[test]
fn a_candidate_that_fails_validation_is_never_chosen_and_adds_nothing() {
    for (cmd, env) in [
        ("./sh", "{}"),
        ("./curl", "{}"),
        ("./o", r#"{"DYLD_INSERT_LIBRARIES":"/tmp/x.dylib"}"#),
    ] {
        let entries = parse_registry(&doc(&[package_and_binary(cmd, env)])).unwrap();
        match &entries[0].distribution {
            Distribution::Npx { package, args, env } => {
                assert_eq!(package, "a@1.0.0");
                assert_eq!(args, &vec!["acp".to_string()], "{cmd}: no binary args");
                assert_eq!(env.keys().collect::<Vec<_>>(), vec!["GOOD"], "{cmd}");
            }
            other => panic!("{cmd}: expected the package, got {other:?}"),
        }
    }
}

#[test]
fn an_unsafe_package_is_never_chosen_beside_a_valid_binary() {
    let json = format!(
        r#"{{"id":"both","name":"B","version":"1.0.0","distribution":{{"npx":{{"package":"a@1.0.0","env":{{"NODE_OPTIONS":"--require /tmp/x.js"}}}},"binary":{{"{}":{}}}}}}}"#,
        current_platform(),
        target("https://h/o.zip", "./o", SHA)
    );
    let entries = parse_registry(&doc(&[json])).unwrap();
    assert!(is_binary(&entries[0]));
}

#[test]
fn a_binary_without_a_build_for_this_mac_yields_to_a_pinned_package() {
    let json = format!(
        r#"{{"id":"other","name":"O","version":"1.0.0","distribution":{{"binary":{{"linux-riscv":{t}}},"npx":{{"package":"a@1.0.0"}}}}}}"#,
        t = target("https://h/o.zip", "./o", SHA),
    );
    let entries = parse_registry(&doc(&[json])).unwrap();
    assert!(matches!(entries[0].distribution, Distribution::Npx { .. }));
}

#[test]
fn a_binary_without_a_build_for_this_mac_is_the_last_resort() {
    let json = format!(
        r#"{{"id":"other","name":"O","version":"1.0.0","distribution":{{"binary":{{"linux-riscv":{t}}},"npx":{{"package":"a@latest"}}}}}}"#,
        t = target("https://h/o.zip", "./o", SHA),
    );
    let entries = parse_registry(&doc(&[json])).unwrap();
    assert!(is_binary(&entries[0]));
}

#[test]
fn a_binary_only_entry_without_a_build_for_this_mac_stays_as_before() {
    // Offered (shown as unsupported by the catalog), never reported as unavailable.
    let json = doc(&[binary_on(
        "elsewhere",
        &[("linux-riscv", target("https://h/o.zip", "./o", SHA))],
    )]);
    let report = parse_registry_report(&json).unwrap();
    assert_eq!(ids(&report.entries), vec!["elsewhere"]);
    assert!(report.unavailable.is_empty());
}

#[test]
fn prefers_npx_over_uvx_when_both_are_pinned() {
    let json = r#"{"id":"two","name":"N","version":"1.0.0","distribution":{"npx":{"package":"a@1.0.0"},"uvx":{"package":"a==1.0.0"}}}"#;
    let entries = parse_registry(&doc(&[json.into()])).unwrap();
    assert!(matches!(entries[0].distribution, Distribution::Npx { .. }));
}

#[test]
fn single_kind_entries_parse_exactly_as_before() {
    let json = doc(&[
        npx("gemini", "@google/gemini-cli@0.64.0"),
        binary("opencode", "https://h/o.zip", "./opencode", SHA),
        npx("loose", "y@latest"),
        binary("bad-sha", "https://h/o.zip", "./o", "abc"),
    ]);
    let report = parse_registry_report(&json).unwrap();
    let chosen: Vec<(&str, &str)> = report
        .entries
        .iter()
        .map(|e| {
            let kind = match e.distribution {
                Distribution::Npx { .. } => "npx",
                Distribution::Uvx { .. } => "uvx",
                Distribution::Binary { .. } => "binary",
            };
            (e.id.as_str(), kind)
        })
        .collect();
    assert_eq!(chosen, vec![("gemini", "npx"), ("opencode", "binary")]);
    let reasons: Vec<(&str, UnavailableReason)> = report
        .unavailable
        .iter()
        .map(|a| (a.id.as_str(), a.reason))
        .collect();
    assert_eq!(
        reasons,
        vec![
            ("bad-sha", UnavailableReason::NoChecksum),
            ("loose", UnavailableReason::InvalidEntry),
        ]
    );
}

#[test]
fn live_binaries_without_a_checksum_are_reported_not_offered() {
    let report = parse_registry_report(LIVE_SAMPLE).unwrap();
    assert!(report
        .entries
        .iter()
        .all(|e| e.id != "cursor" && e.id != "stakpak"));
    if !current_platform().starts_with("darwin") {
        return;
    }
    let cursor = report
        .unavailable
        .iter()
        .find(|a| a.id == "cursor")
        .expect("cursor is reported");
    assert_eq!(cursor.reason, UnavailableReason::NoChecksum);
    assert_eq!(cursor.name, "Cursor");
    assert!(cursor.description.is_some());
    assert!(report.unavailable.iter().any(|a| a.id == "stakpak"));
}

#[test]
fn a_binary_with_no_checksum_is_reported_with_that_reason() {
    let missing = format!(
        r#"{{"id":"unsigned","name":"Unsigned","version":"1.0.0","description":"d","distribution":{{"binary":{{"{}":{{"archive":"https://h/o.zip","cmd":"./o"}}}}}}}}"#,
        current_platform()
    );
    let found = unavailable(&doc(&[missing, npx("ok", "a@1.0.0")]));
    assert_eq!(
        found,
        vec![UnavailableAgent {
            id: "unsigned".into(),
            name: "Unsigned".into(),
            description: Some("d".into()),
            reason: UnavailableReason::NoChecksum,
        }]
    );
}

#[test]
fn other_failures_are_reported_as_invalid_entries() {
    let broken = r#"{"id":"broken","name":"Broken","version":"1.0.0","distribution":{"npx":{}}}"#;
    let no_name = r#"{"id":"nameless","version":"1.0.0","distribution":{}}"#;
    let json = doc(&[
        npx("loose", "y@latest"),
        broken.into(),
        no_name.into(),
        binary("bad-cmd", "https://h/o.zip", "/bin/sh", SHA),
        binary("http-only", "http://h/o.zip", "./o", SHA),
    ]);
    let found = unavailable(&json);
    let reasons: Vec<(&str, UnavailableReason)> =
        found.iter().map(|a| (a.id.as_str(), a.reason)).collect();
    assert_eq!(
        reasons,
        vec![
            ("bad-cmd", UnavailableReason::InvalidEntry),
            ("broken", UnavailableReason::InvalidEntry),
            ("http-only", UnavailableReason::InvalidEntry),
            ("loose", UnavailableReason::InvalidEntry),
            ("nameless", UnavailableReason::InvalidEntry),
        ]
    );
    assert_eq!(
        found[4].name, "nameless",
        "the id stands in for a missing name"
    );
}

#[test]
fn an_entry_with_no_usable_id_is_left_out_of_both_lists() {
    let reserved = npx("aider", "a@1.0.0");
    let report = parse_registry_report(&doc(&[
        npx("Bad_Id", "a@1.0.0"),
        reserved,
        r#"{"name":"No id"}"#.into(),
        "42".into(),
    ]))
    .unwrap();
    assert!(report.entries.is_empty());
    assert!(report.unavailable.is_empty());
}

#[test]
fn the_unavailable_list_is_sorted_by_id_with_one_row_per_id() {
    let json = doc(&[
        npx("z-bad", "y@latest"),
        npx("a-ok", "a@1.0.0"),
        npx("m-bad", "y@latest"),
        npx("z-bad", "w@latest"),
    ]);
    let report = parse_registry_report(&json).unwrap();
    assert_eq!(ids(&report.entries), vec!["a-ok"]);
    let reported: Vec<&str> = report.unavailable.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(reported, vec!["m-bad", "z-bad"]);
}

#[test]
fn a_malformed_kind_does_not_hide_a_valid_one_beside_it() {
    // The binary map has a target that cannot be read at all (no `cmd`).
    let json = r#"{"id":"mixed","name":"M","version":"1.0.0","distribution":{"binary":{"windows-x86_64":{"archive":"https://h/o.zip"}},"npx":{"package":"a@1.0.0"}}}"#;
    let entries = parse_registry(&doc(&[json.into()])).unwrap();
    assert!(matches!(entries[0].distribution, Distribution::Npx { .. }));
}

#[test]
fn a_null_checksum_counts_as_missing() {
    let json = format!(
        r#"{{"id":"nulled","name":"N","version":"1.0.0","distribution":{{"binary":{{"{}":{{"archive":"https://h/o.zip","cmd":"./o","sha256":null}}}}}}}}"#,
        current_platform()
    );
    let found = unavailable(&doc(&[json]));
    assert_eq!(found[0].reason, UnavailableReason::NoChecksum);
}

#[test]
fn another_platform_without_a_checksum_does_not_hide_a_valid_target_for_this_mac() {
    // Only this Mac's target is ever read, so another platform's missing or
    // null `sha256` no longer drops the entry (it used to fail to parse).
    let json = format!(
        r#"{{"id":"mixed","name":"M","version":"1.0.0","distribution":{{"binary":{{"{}":{},"windows-x86_64":{{"archive":"https://h/o.zip","cmd":"./o.exe"}},"linux-riscv":{{"archive":"https://h/o.zip","cmd":"./o","sha256":null}}}}}}}}"#,
        current_platform(),
        target("https://h/o.zip", "./o", SHA)
    );
    let report = parse_registry_report(&doc(&[json])).unwrap();
    assert_eq!(ids(&report.entries), vec!["mixed"]);
    assert!(report.unavailable.is_empty());
}

#[test]
fn this_macs_target_without_a_valid_checksum_is_reported_as_no_checksum() {
    let not_hex = "zz".repeat(32);
    for sha in ["", "abc", not_hex.as_str()] {
        let json = doc(&[binary("unchecked", "https://h/o.zip", "./o", sha)]);
        let report = parse_registry_report(&json).unwrap();
        assert!(report.entries.is_empty(), "sha {sha:?}");
        assert_eq!(report.unavailable[0].reason, UnavailableReason::NoChecksum);
    }
}
