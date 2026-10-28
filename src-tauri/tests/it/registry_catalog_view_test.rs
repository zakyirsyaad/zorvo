use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::json;

use zorvo_lib::installer::plan::InstalledTools;
use zorvo_lib::installer::runtimes::InstalledRuntime;
use zorvo_lib::registry::catalog_view::{AgentCatalog, CatalogAgent};
use zorvo_lib::registry::history::{VersionHistory, MIN_AGE_SECS};
use zorvo_lib::registry::resolve::SystemTools;
use zorvo_lib::registry::schema::{BinaryTarget, Distribution, RegistryEntry, UnavailableReason};
use zorvo_lib::registry::Catalog;

const DAY: u64 = 24 * 60 * 60;
const T0: u64 = 1_790_000_000;
const NOW: u64 = T0 + 30 * DAY;

struct BinDir(PathBuf);

impl BinDir {
    fn new(names: &[&str]) -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "zorvo-catalog-view-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        for name in names {
            let path = dir.join(name);
            std::fs::write(&path, "#!/bin/sh\n").expect("write binary");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn path_var(&self) -> String {
        self.0.to_string_lossy().to_string()
    }
}

impl Drop for BinDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn npx_entry(id: &str, version: &str) -> RegistryEntry {
    RegistryEntry {
        id: id.to_string(),
        name: format!("Agent {id}"),
        version: version.to_string(),
        description: Some(format!("About {id}")),
        icon: None,
        distribution: Distribution::Npx {
            package: format!("{id}-pkg@{version}"),
            args: vec!["--acp".to_string()],
            env: BTreeMap::new(),
        },
    }
}

fn uvx_entry(id: &str, version: &str) -> RegistryEntry {
    RegistryEntry {
        distribution: Distribution::Uvx {
            package: format!("{id}-pkg=={version}"),
            args: vec!["acp".to_string()],
            env: BTreeMap::new(),
        },
        ..npx_entry(id, version)
    }
}

fn binary_entry(id: &str, version: &str, platform: &str, cmd: &str) -> RegistryEntry {
    let target = BinaryTarget {
        archive: format!("https://example.com/{id}.tar.gz"),
        cmd: cmd.to_string(),
        args: vec!["acp".to_string()],
        sha256: "a".repeat(64),
        env: BTreeMap::new(),
    };
    RegistryEntry {
        distribution: Distribution::Binary {
            platforms: BTreeMap::from([(platform.to_string(), target)]),
        },
        ..npx_entry(id, version)
    }
}

fn current_binary(id: &str, version: &str, cmd: &str) -> RegistryEntry {
    binary_entry(
        id,
        version,
        zorvo_lib::registry::schema::current_platform(),
        cmd,
    )
}

fn bundle_of(records: &[(RegistryEntry, u64)]) -> String {
    let mut history = VersionHistory::default();
    for (entry, first_seen) in records {
        history.observe(std::slice::from_ref(entry), *first_seen);
    }
    history.to_json()
}

fn registry_of(entries: &[RegistryEntry]) -> String {
    json!({ "version": "1.0.0", "agents": entries }).to_string()
}

fn view(
    catalog: &Catalog,
    path_var: &str,
    globals: &BTreeSet<String>,
    installed: &InstalledTools,
    versions: &BTreeMap<String, String>,
) -> AgentCatalog {
    let tools = SystemTools {
        path_var: Some(path_var),
        npm_globals: globals,
        installed,
    };
    catalog.catalog_view(&tools, versions, NOW)
}

fn agent<'a>(catalog: &'a AgentCatalog, id: &str) -> &'a CatalogAgent {
    catalog
        .agents
        .iter()
        .find(|a| a.id == id)
        .unwrap_or_else(|| panic!("agent '{id}' must be in {catalog:?}"))
}

fn user_node(major: u32) -> InstalledTools {
    InstalledTools {
        user_node_major: Some(major),
        ..InstalledTools::none()
    }
}

#[test]
fn each_status_is_reported() {
    let dir = BinDir::new(&["npx", "uvx", "onpath"]);
    let zorvo_dir = PathBuf::from("/tools/agents/by-zorvo-bin");
    let first_seen_recent = NOW - 2 * DAY;
    let bundle = bundle_of(&[
        (npx_entry("ready-npx", "1.0.0"), T0),
        (uvx_entry("ready-uvx", "1.0.0"), T0),
        (npx_entry("zorvo-npx", "1.0.0"), T0),
        (npx_entry("global-npx", "1.0.0"), T0),
        (current_binary("on-path", "1.0.0", "./onpath"), T0),
        (current_binary("zorvo-bin", "1.0.0", "./bin/zagent"), T0),
        (current_binary("missing", "1.0.0", "./missing-agent"), T0),
        (
            binary_entry("linux-only", "1.0.0", "linux-x86_64", "./x"),
            T0,
        ),
        (npx_entry("fresh", "1.0.0"), first_seen_recent),
    ]);
    let catalog = Catalog::bundled(&bundle);
    let globals = BTreeSet::from(["global-npx-pkg".to_string()]);

    // The user's Node serves ready-npx and global-npx.
    let mut installed = user_node(22);
    installed.agents.insert(
        ("zorvo-bin".to_string(), "1.0.0".to_string()),
        zorvo_dir.clone(),
    );
    let result = view(
        &catalog,
        &dir.path_var(),
        &globals,
        &installed,
        &BTreeMap::new(),
    );

    assert_eq!(agent(&result, "ready-npx").status, "ready");
    assert_eq!(agent(&result, "ready-uvx").status, "ready");
    assert_eq!(agent(&result, "global-npx").status, "on_your_mac");
    assert_eq!(agent(&result, "global-npx").location, None);
    let on_path = agent(&result, "on-path");
    assert_eq!(on_path.status, "on_your_mac");
    assert_eq!(
        on_path.location.as_deref(),
        Some(dir.path().join("onpath").to_string_lossy().as_ref())
    );
    assert_eq!(agent(&result, "zorvo-bin").status, "by_zorvo");
    assert_eq!(agent(&result, "missing").status, "not_installed");
    assert_eq!(agent(&result, "linux-only").status, "unsupported");
    assert_eq!(agent(&result, "linux-only").distribution, "binary");
    let fresh = agent(&result, "fresh");
    assert_eq!(fresh.status, "waiting");
    assert_eq!(fresh.version, None);
    assert_eq!(fresh.available_from, Some(first_seen_recent + MIN_AGE_SECS));
    assert_eq!(fresh.name, "Agent fresh");

    // Only Zorvo's Node: npx runs on it.
    let zorvo_node = InstalledTools {
        user_node_major: Some(18),
        node: Some(InstalledRuntime {
            version: "22.0.0".to_string(),
            bin_dir: PathBuf::from("/tools/node/bin"),
        }),
        ..InstalledTools::none()
    };
    let result = view(
        &catalog,
        &dir.path_var(),
        &BTreeSet::new(),
        &zorvo_node,
        &BTreeMap::new(),
    );
    assert_eq!(agent(&result, "zorvo-npx").status, "by_zorvo");
    assert_eq!(
        result
            .agents
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        {
            let mut ids: Vec<&str> = result.agents.iter().map(|a| a.id.as_str()).collect();
            ids.sort_unstable();
            ids
        },
        "agents are sorted by id"
    );
}

fn upgradable(newer_seen: u64) -> Catalog {
    Catalog::bundled(&bundle_of(&[
        (npx_entry("gemini", "1.0.0"), T0),
        (npx_entry("gemini", "1.1.0"), newer_seen),
    ]))
}

fn recorded_1_0_0() -> BTreeMap<String, String> {
    BTreeMap::from([("gemini".to_string(), "1.0.0".to_string())])
}

#[test]
fn update_version_is_the_newer_offered_version() {
    let dir = BinDir::new(&["npx"]);
    let installed = user_node(22);
    let globals = BTreeSet::new();

    let old_enough = upgradable(NOW - 8 * DAY);
    let result = view(
        &old_enough,
        &dir.path_var(),
        &globals,
        &installed,
        &recorded_1_0_0(),
    );
    let gemini = agent(&result, "gemini");
    assert_eq!(gemini.version.as_deref(), Some("1.0.0"));
    assert_eq!(gemini.update_version.as_deref(), Some("1.1.0"));

    let too_new = upgradable(NOW - 3 * DAY);
    let result = view(
        &too_new,
        &dir.path_var(),
        &globals,
        &installed,
        &recorded_1_0_0(),
    );
    assert_eq!(agent(&result, "gemini").update_version, None);
}

#[test]
fn update_version_is_none_when_the_recorded_version_was_withdrawn() {
    let dir = BinDir::new(&["npx"]);
    let catalog = upgradable(NOW - 20 * DAY);
    catalog
        .refresh(
            || Ok(registry_of(&[npx_entry("gemini", "1.0.0")])),
            NOW - DAY,
        )
        .expect("refresh succeeds");
    let versions = BTreeMap::from([("gemini".to_string(), "1.1.0".to_string())]);

    let result = view(
        &catalog,
        &dir.path_var(),
        &BTreeSet::new(),
        &user_node(22),
        &versions,
    );

    let gemini = agent(&result, "gemini");
    assert_eq!(gemini.version.as_deref(), Some("1.0.0"));
    assert_eq!(gemini.update_version, None);
    assert_eq!(result.last_checked, Some(NOW - DAY));
}

fn binary_upgradable() -> Catalog {
    Catalog::bundled(&bundle_of(&[
        (current_binary("tool", "1.0.0", "./onpath"), T0),
        (current_binary("tool", "1.1.0", "./onpath"), NOW - 8 * DAY),
    ]))
}

#[test]
fn update_version_is_none_for_a_binary_on_path() {
    let dir = BinDir::new(&["onpath"]);
    let versions = BTreeMap::from([("tool".to_string(), "1.0.0".to_string())]);

    let result = view(
        &binary_upgradable(),
        &dir.path_var(),
        &BTreeSet::new(),
        &InstalledTools::none(),
        &versions,
    );

    let tool = agent(&result, "tool");
    assert_eq!(tool.status, "on_your_mac");
    assert_eq!(tool.update_version, None);
}

#[test]
fn update_target_refuses_with_the_spec_copy() {
    let dir = BinDir::new(&["npx", "onpath"]);
    let installed = user_node(22);
    let globals = BTreeSet::new();
    let path_var = dir.path_var();
    let tools = SystemTools {
        path_var: Some(&path_var),
        npm_globals: &globals,
        installed: &installed,
    };

    let none_newer = upgradable(NOW - 3 * DAY);
    assert_eq!(
        none_newer
            .update_target("gemini", &tools, &recorded_1_0_0(), NOW)
            .unwrap_err(),
        "No newer version of Agent gemini is offered"
    );
    assert_eq!(
        none_newer
            .update_target("nope", &tools, &BTreeMap::new(), NOW)
            .unwrap_err(),
        "Unknown agent 'nope'"
    );

    let on_path = BTreeMap::from([("tool".to_string(), "1.0.0".to_string())]);
    assert_eq!(
        binary_upgradable()
            .update_target("tool", &tools, &on_path, NOW)
            .unwrap_err(),
        "Agent tool is managed outside Zorvo"
    );

    let newer = upgradable(NOW - 8 * DAY);
    let target = newer
        .update_target("gemini", &tools, &recorded_1_0_0(), NOW)
        .expect("a newer version is offered");
    assert_eq!(target.version, "1.1.0");
}

#[test]
fn update_target_refuses_unsupported_and_waiting_agents() {
    let dir = BinDir::new(&["npx"]);
    let installed = user_node(22);
    let globals = BTreeSet::new();
    let path_var = dir.path_var();
    let tools = SystemTools {
        path_var: Some(&path_var),
        npm_globals: &globals,
        installed: &installed,
    };
    let catalog = Catalog::bundled(&bundle_of(&[
        // Recorded 1.0.0 has no build for this Mac, and a newer 1.1.0 that does is offered:
        // only the unsupported guard keeps Update from moving to it.
        (
            binary_entry("linux-only", "1.0.0", "linux-x86_64", "./x"),
            T0,
        ),
        (current_binary("linux-only", "1.1.0", "./x"), NOW - 8 * DAY),
        (npx_entry("fresh", "1.0.0"), NOW - 2 * DAY),
    ]));
    let versions = BTreeMap::from([("linux-only".to_string(), "1.0.0".to_string())]);

    assert_eq!(
        catalog
            .update_target("linux-only", &tools, &versions, NOW)
            .unwrap_err(),
        "No newer version of Agent linux-only is offered"
    );
    assert_eq!(
        catalog
            .update_target("fresh", &tools, &BTreeMap::new(), NOW)
            .unwrap_err(),
        "No newer version of Agent fresh is offered"
    );
}

#[test]
fn catalog_serialises_in_camel_case() {
    let dir = BinDir::new(&["npx"]);
    let catalog = upgradable(NOW - 8 * DAY);
    let result = view(
        &catalog,
        &dir.path_var(),
        &BTreeSet::new(),
        &user_node(22),
        &recorded_1_0_0(),
    );

    let value = serde_json::to_value(&result).expect("serialises");

    assert!(value.get("lastChecked").is_some());
    let gemini = &value["agents"][0];
    assert_eq!(gemini["updateVersion"], "1.1.0");
    assert!(gemini.get("availableFrom").is_some());
}

#[test]
fn a_new_binary_without_this_macs_target_is_unsupported_not_waiting() {
    let bundle = bundle_of(&[
        (
            binary_entry("fresh-linux", "1.0.0", "linux-x86_64", "./x"),
            NOW - 2 * DAY,
        ),
        (current_binary("fresh-mac", "1.0.0", "./x"), NOW - 2 * DAY),
    ]);
    let catalog = Catalog::bundled(&bundle);
    let dir = BinDir::new(&[]);

    let result = view(
        &catalog,
        &dir.path_var(),
        &BTreeSet::new(),
        &InstalledTools::none(),
        &BTreeMap::new(),
    );

    let fresh_linux = agent(&result, "fresh-linux");
    assert_eq!(fresh_linux.status, "unsupported");
    assert_eq!(fresh_linux.available_from, None);
    assert_eq!(fresh_linux.distribution, "binary");
    assert_eq!(agent(&result, "fresh-mac").status, "waiting");
}

// Agents the registry lists but Zorvo cannot offer.

const BUNDLED: &str = include_str!("../../resources/registry-history.json");

fn raw_registry(entries: &[serde_json::Value]) -> String {
    json!({ "version": "1.0.0", "agents": entries }).to_string()
}

fn unsigned_binary(id: &str, name: &str) -> serde_json::Value {
    json!({
        "id": id,
        "name": name,
        "version": "1.0.0",
        "description": "A binary with no checksum",
        "distribution": { "binary": { zorvo_lib::registry::schema::current_platform(): {
            "archive": "https://example.com/agent.tar.gz",
            "cmd": "./agent",
            "args": ["acp"],
        } } },
    })
}

fn no_tools_view_at(catalog: &Catalog, now: u64) -> AgentCatalog {
    let dir = BinDir::new(&[]);
    let path_var = dir.path_var();
    let globals = BTreeSet::new();
    let installed = InstalledTools::none();
    let tools = SystemTools {
        path_var: Some(&path_var),
        npm_globals: &globals,
        installed: &installed,
    };
    catalog.catalog_view(&tools, &BTreeMap::new(), now)
}

fn no_tools_view(catalog: &Catalog) -> AgentCatalog {
    no_tools_view_at(catalog, NOW)
}

#[test]
fn unavailable_agents_are_reported_after_a_fetch_and_are_not_catalog_rows() {
    let catalog = Catalog::bundled(&bundle_of(&[(npx_entry("gemini", "1.0.0"), T0)]));
    assert!(
        no_tools_view(&catalog).unavailable.is_empty(),
        "nothing before a fetch"
    );

    let registry = raw_registry(&[
        serde_json::to_value(npx_entry("gemini", "1.0.0")).unwrap(),
        unsigned_binary("zeta", "Zeta"),
        json!({ "id": "alpha", "name": "Alpha", "version": "1.0.0",
                "distribution": { "npx": { "package": "alpha@latest" } } }),
    ]);
    catalog
        .refresh(|| Ok(registry.clone()), NOW)
        .expect("refresh succeeds");

    let result = no_tools_view(&catalog);
    let reported: Vec<(&str, &str)> = result
        .unavailable
        .iter()
        .map(|a| (a.id.as_str(), a.name.as_str()))
        .collect();
    assert_eq!(
        reported,
        vec![("alpha", "Alpha"), ("zeta", "Zeta")],
        "sorted by id"
    );
    assert_eq!(
        serde_json::to_value(&result.unavailable[1]).unwrap(),
        json!({
            "id": "zeta",
            "name": "Zeta",
            "description": "A binary with no checksum",
            "reason": "no_checksum",
        })
    );
    assert_eq!(
        result.unavailable[0].reason,
        UnavailableReason::InvalidEntry
    );
    assert!(
        result.agents.iter().all(|a| a.id == "gemini"),
        "no row to add or install"
    );
}

#[test]
fn an_agent_the_history_has_stays_a_row_when_its_newest_entry_is_invalid() {
    let catalog = Catalog::bundled(&bundle_of(&[(npx_entry("tool", "1.0.0"), T0)]));
    let registry = raw_registry(&[unsigned_binary("tool", "Tool")]);

    catalog
        .refresh(|| Ok(registry.clone()), NOW)
        .expect("refresh succeeds");

    let result = no_tools_view(&catalog);
    assert!(result.unavailable.is_empty());
    assert!(
        !agent(&result, "tool").listed,
        "the registry no longer offers it"
    );
}

#[test]
fn the_unavailable_agents_survive_a_restart_and_an_old_cache_is_refetched() {
    let dir = std::env::temp_dir().join(format!("zorvo-unavailable-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let bundle = bundle_of(&[(npx_entry("gemini", "1.0.0"), T0)]);
    let registry = raw_registry(&[
        serde_json::to_value(npx_entry("gemini", "1.0.0")).unwrap(),
        unsigned_binary("zeta", "Zeta"),
    ]);

    let first = Catalog::open(dir.clone(), &bundle);
    assert!(first.refresh(|| Ok(registry.clone()), NOW).unwrap());
    assert!(
        !first.refresh(|| Ok(registry.clone()), NOW + 1).unwrap(),
        "nothing changed"
    );
    drop(first);

    let reopened = Catalog::open(dir.clone(), &bundle);
    assert!(!reopened.needs_refresh(NOW + 60));
    assert_eq!(no_tools_view(&reopened).unavailable.len(), 1);

    // A cache written before the list was recorded counts as stale.
    std::fs::write(
        dir.join("registry-cache.json"),
        format!(r#"{{"last_fetch":{NOW},"listed":["gemini"]}}"#),
    )
    .expect("write old cache");
    let old = Catalog::open(dir.clone(), &bundle);
    assert!(old.needs_refresh(NOW + 60));
    assert!(no_tools_view(&old).unavailable.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_bundled_history_offers_kilo_and_sigit_from_the_start() {
    // Both publish a binary and an npx package; they were dropped as "two distributions".
    // They run as the pinned package, so the choice does not depend on this Mac.
    let catalog = Catalog::bundled(BUNDLED);
    let generated_at = VersionHistory::from_json(BUNDLED)
        .unwrap()
        .agents
        .values()
        .flat_map(|versions| versions.values())
        .map(|record| record.first_seen)
        .max()
        .unwrap();
    let result = no_tools_view_at(&catalog, generated_at + MIN_AGE_SECS);

    for id in ["kilo", "sigit"] {
        let row = agent(&result, id);
        assert!(row.version.is_some(), "{id} has a version to run");
        assert_eq!(row.distribution, "npx", "{id} runs as its package");
        assert_ne!(
            row.status, "waiting",
            "{id} is older than the seven-day wait"
        );
        assert_ne!(row.status, "unsupported", "{id} runs on this Mac");
    }
}

#[test]
fn an_unavailable_agent_cannot_be_launched_planned_installed_or_updated() {
    let catalog = Catalog::bundled(&bundle_of(&[(npx_entry("gemini", "1.0.0"), T0)]));
    let registry = raw_registry(&[
        serde_json::to_value(npx_entry("gemini", "1.0.0")).unwrap(),
        unsigned_binary("zeta", "Zeta"),
    ]);
    catalog
        .refresh(|| Ok(registry.clone()), NOW)
        .expect("refresh succeeds");
    assert_eq!(no_tools_view(&catalog).unavailable[0].id, "zeta");

    let dir = BinDir::new(&[]);
    let path_var = dir.path_var();
    let globals = BTreeSet::new();
    let installed = InstalledTools::none();
    let tools = SystemTools {
        path_var: Some(&path_var),
        npm_globals: &globals,
        installed: &installed,
    };
    let versions = BTreeMap::new();

    assert!(catalog.profile("zeta", &tools, &versions, NOW).is_none());
    assert!(catalog
        .profiles(&tools, &versions, NOW)
        .iter()
        .all(|profile| profile.id != "zeta"));
    assert!(catalog
        .planned_steps_for("zeta", &tools, &versions, NOW)
        .is_none());
    assert!(catalog.agent_name("zeta", &versions, NOW).is_none());
    assert!(catalog
        .unsupported_agent_name("zeta", &versions, NOW)
        .is_none());
    assert!(catalog
        .update_target("zeta", &tools, &versions, NOW)
        .is_err());
    assert!(catalog.launch_env("zeta", "1.0.0").is_empty());
}
