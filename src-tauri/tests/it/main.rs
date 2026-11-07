//! Every integration test in one binary, so tauri, tokio and the rest are
//! linked once instead of once per file. `installer_state_test.rs` stays
//! apart: it sets process-wide installer state that other tests also read.

mod common;

mod acp_jsonrpc_test;
mod acp_manager_test;
mod acp_private_errors_test;
mod acp_prompt_blocks_test;
mod acp_session_list_test;
mod acp_session_reopen_test;
mod background_processes_test;
mod branches_test;
mod changes_test;
mod config_test;
mod data_migration_test;
mod diff_since_test;
mod diff_stats_test;
mod e2e_integration_test;
mod env_resolver_test;
mod git_info_test;
mod installer_archive_test;
mod installer_cleanup_test;
mod installer_download_test;
mod installer_install_test;
mod installer_layout_test;
mod installer_plan_test;
mod installer_prerequisites_test;
mod installer_runtimes_test;
mod profiles_test;
mod pty_session_test;
mod registry_catalog_test;
mod registry_catalog_view_test;
mod registry_fetch_test;
mod registry_history_test;
mod registry_icons_test;
mod registry_resolve_test;
mod registry_schema_test;
mod store_test;
mod workspace_files_test;
mod workspace_terminal_test;
mod workspaces_test;
mod worktrees_test;

/// Test files that are binaries of their own, directly in `tests/`.
const OWN_BINARIES: &[&str] = &["installer_state_test.rs", "private_proxy_test.rs"];

/// The `.rs` file names directly in `dir`.
fn rust_files_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("read {}: {error}", dir.display()))
        .map(|entry| entry.expect("read a dir entry").path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "rs"))
        .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

// A file here without a `mod` line would never be compiled or run, and a new
// file in `tests/` would link everything again as a binary of its own.
#[test]
fn every_integration_test_file_is_a_module_of_this_binary() {
    let tests = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let declared = include_str!("main.rs");

    let missing: Vec<String> = rust_files_in(&tests.join("it"))
        .into_iter()
        .filter(|name| name != "main.rs")
        .filter(|name| !declared.contains(&format!("\nmod {};", name.trim_end_matches(".rs"))))
        .collect();
    let stray: Vec<String> = rust_files_in(&tests)
        .into_iter()
        .filter(|name| !OWN_BINARIES.contains(&name.as_str()))
        .collect();

    assert!(
        missing.is_empty(),
        "add `mod` lines to tests/it/main.rs for {missing:?}"
    );
    assert!(
        stray.is_empty(),
        "move {stray:?} into tests/it/ (or list it in OWN_BINARIES if it sets process-wide state)"
    );
}
