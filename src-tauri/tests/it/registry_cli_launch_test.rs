//! Google Antigravity runs through the user's `agy acp` when a new enough `agy`
//! is on `PATH`, ahead of a same-named program and of Zorvo's registry copy.

use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use zorvo_lib::installer::plan::InstalledTools;
use zorvo_lib::registry::resolve::{
    install_status, planned_steps, resolve_profile, InstallStatus, SystemTools,
};
use zorvo_lib::registry::schema::{current_platform, BinaryTarget, Distribution, RegistryEntry};

const AGY_ARGS: [&str; 3] = ["acp", "--app-data-dir", "antigravity-acp"];

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch_with(names: &[&str]) -> Scratch {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "zorvo-cli-launch-test-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    for name in names {
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\n").expect("write program");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    Scratch(dir)
}

fn path_of(dir: &Path) -> String {
    dir.to_string_lossy().to_string()
}

fn program_in(dir: &Path, name: &str) -> String {
    path_of(&dir.join(name))
}

fn antigravity() -> RegistryEntry {
    let platforms = BTreeMap::from([(
        current_platform().to_string(),
        BinaryTarget {
            archive: "https://dl.google.com/agy-acp-server.zip".to_string(),
            cmd: "./agy_acp_server.par".to_string(),
            args: Vec::new(),
            sha256: "a".repeat(64),
            env: BTreeMap::new(),
        },
    )]);
    RegistryEntry {
        id: "antigravity-acp".to_string(),
        name: "Google Antigravity".to_string(),
        version: "1.5.2".to_string(),
        description: None,
        icon: None,
        distribution: Distribution::Binary { platforms },
    }
}

/// `agy` at `path` reported `version`.
fn agy_reported(path: &str, version: &str) -> InstalledTools {
    InstalledTools {
        cli_versions: BTreeMap::from([(path.to_string(), version.to_string())]),
        ..InstalledTools::none()
    }
}

fn tools<'a>(
    path: &'a str,
    globals: &'a BTreeSet<String>,
    installed: &'a InstalledTools,
) -> SystemTools<'a> {
    SystemTools {
        path_var: Some(path),
        npm_globals: globals,
        installed,
    }
}

#[test]
fn a_new_enough_agy_runs_antigravity_through_agy_acp() {
    let dir = scratch_with(&["agy"]);
    let path = path_of(&dir.0);
    let agy = program_in(&dir.0, "agy");
    let globals = BTreeSet::new();
    let installed = agy_reported(&agy, "1.5.17");
    let tools = tools(&path, &globals, &installed);

    let profile = resolve_profile(&antigravity(), &tools, true);

    assert_eq!(profile.availability, "ready");
    assert!(profile.detected);
    assert_eq!(profile.command, "agy");
    assert_eq!(profile.acp_program.as_deref(), Some("agy"));
    assert_eq!(profile.acp_program_path.as_deref(), Some(agy.as_str()));
    assert_eq!(profile.acp_args, AGY_ARGS);
    assert!(profile.setup_args.is_empty());
    assert!(profile.installed_on_system);
    assert_eq!(profile.distribution.as_deref(), Some("binary"));
    // The registry's version stays the one in use, so an update or a pick still names it.
    assert_eq!(profile.version.as_deref(), Some("1.5.2"));
    assert!(planned_steps(&antigravity(), &tools).is_empty());
    assert_eq!(
        install_status(&antigravity(), &tools),
        InstallStatus::OnYourMac {
            location: Some(agy)
        }
    );
}

#[test]
fn agy_comes_before_a_program_named_like_the_registry_build() {
    let dir = scratch_with(&["agy", "agy_acp_server.par"]);
    let path = path_of(&dir.0);
    let agy = program_in(&dir.0, "agy");
    let globals = BTreeSet::new();
    let installed = agy_reported(&agy, "1.6.0");

    let profile = resolve_profile(&antigravity(), &tools(&path, &globals, &installed), true);

    assert_eq!(profile.acp_program_path.as_deref(), Some(agy.as_str()));
    assert_eq!(profile.acp_args, AGY_ARGS);
}

#[test]
fn agy_comes_before_zorvos_copy_of_the_registry_build() {
    let dir = scratch_with(&["agy"]);
    let copy = scratch_with(&["agy_acp_server.par"]);
    let path = path_of(&dir.0);
    let agy = program_in(&dir.0, "agy");
    let globals = BTreeSet::new();
    let entry = antigravity();
    let installed = InstalledTools {
        agents: BTreeMap::from([((entry.id.clone(), entry.version.clone()), copy.0.clone())]),
        ..agy_reported(&agy, "1.5.17")
    };

    let profile = resolve_profile(&entry, &tools(&path, &globals, &installed), true);

    assert_eq!(profile.acp_program_path.as_deref(), Some(agy.as_str()));
}

#[test]
fn an_older_agy_leaves_the_registry_build_in_place() {
    let dir = scratch_with(&["agy", "agy_acp_server.par"]);
    let path = path_of(&dir.0);
    let agy = program_in(&dir.0, "agy");
    let globals = BTreeSet::new();
    let installed = agy_reported(&agy, "1.5.16");

    let profile = resolve_profile(&antigravity(), &tools(&path, &globals, &installed), true);

    assert_eq!(profile.command, "agy_acp_server.par");
    assert_eq!(
        profile.acp_program_path,
        Some(program_in(&dir.0, "agy_acp_server.par"))
    );
    assert!(profile.acp_args.is_empty());
}

#[test]
fn an_agy_with_no_known_version_is_not_used() {
    let dir = scratch_with(&["agy"]);
    let path = path_of(&dir.0);
    let globals = BTreeSet::new();
    let installed = InstalledTools::none();

    let profile = resolve_profile(&antigravity(), &tools(&path, &globals, &installed), true);

    assert_eq!(profile.availability, "not_installed");
    assert_eq!(profile.command, "agy_acp_server.par");
    assert!(!profile.installed_on_system);
}

#[test]
fn a_version_reported_for_another_agy_does_not_count() {
    let dir = scratch_with(&["agy"]);
    let path = path_of(&dir.0);
    let globals = BTreeSet::new();
    let installed = agy_reported("/somewhere/else/agy", "1.6.0");

    let profile = resolve_profile(&antigravity(), &tools(&path, &globals, &installed), true);

    assert_eq!(profile.availability, "not_installed");
}

#[test]
fn agy_does_not_change_other_binary_agents() {
    let dir = scratch_with(&["agy", "opencode"]);
    let path = path_of(&dir.0);
    let agy = program_in(&dir.0, "agy");
    let globals = BTreeSet::new();
    let installed = agy_reported(&agy, "1.6.0");
    let opencode = RegistryEntry {
        id: "opencode".to_string(),
        name: "OpenCode".to_string(),
        ..antigravity()
    };
    let opencode = RegistryEntry {
        distribution: Distribution::Binary {
            platforms: BTreeMap::from([(
                current_platform().to_string(),
                BinaryTarget {
                    archive: "https://example.com/opencode.tar.gz".to_string(),
                    cmd: "./opencode".to_string(),
                    args: vec!["acp".to_string()],
                    sha256: "a".repeat(64),
                    env: BTreeMap::new(),
                },
            )]),
        },
        ..opencode
    };

    let profile = resolve_profile(&opencode, &tools(&path, &globals, &installed), true);

    assert_eq!(profile.command, "opencode");
    assert_eq!(profile.acp_args, vec!["acp"]);
}
