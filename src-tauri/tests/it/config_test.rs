use serde_json::Value;

fn tauri_config() -> Value {
    let raw = std::fs::read_to_string(format!("{}/tauri.conf.json", env!("CARGO_MANIFEST_DIR")))
        .expect("read tauri.conf.json");
    serde_json::from_str(&raw).expect("parse tauri.conf.json")
}

/// The webview renders agent output and can call powerful commands, so a
/// policy must stop injected script and remote loads.
#[test]
fn the_app_ships_with_a_strict_content_security_policy() {
    let config = tauri_config();
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("a CSP string, not null");

    assert!(csp.contains("default-src 'self'"), "{csp}");
    assert!(csp.contains("script-src 'self'"), "{csp}");
    assert!(csp.contains("object-src 'none'"), "{csp}");
    let script_src = csp
        .split(';')
        .find(|d| d.trim().starts_with("script-src"))
        .expect("script-src");
    assert!(
        !script_src.contains("unsafe-inline") && !script_src.contains("unsafe-eval"),
        "{script_src}"
    );
    assert!(
        !csp.contains("https:") && !csp.contains("http: "),
        "no remote origins: {csp}"
    );
}

/// Tauri adds hashes/nonces to the CSP of bundled assets; in `style-src` they
/// would void `'unsafe-inline'`, which xterm's injected <style> needs.
#[test]
fn inline_styles_stay_allowed_in_the_bundled_app() {
    let config = tauri_config();
    let security = &config["app"]["security"];

    let untouched: Vec<&str> = security["dangerousDisableAssetCspModification"]
        .as_array()
        .expect("a list of directives Tauri must not modify")
        .iter()
        .filter_map(|d| d.as_str())
        .collect();

    assert_eq!(
        untouched,
        ["style-src"],
        "only style-src: script-src keeps Tauri's nonces"
    );
    assert!(security["csp"]
        .as_str()
        .unwrap()
        .contains("style-src 'self' 'unsafe-inline'"));
}

/// Attached images are served by the asset protocol. Its scope must start
/// empty: the backend adds one checked image at a time, so the webview can
/// never load an arbitrary file.
#[test]
fn the_asset_protocol_starts_with_an_empty_scope() {
    let config = tauri_config();
    let asset = &config["app"]["security"]["assetProtocol"];

    assert_eq!(asset["enable"], true, "{asset}");
    assert_eq!(asset["scope"], serde_json::json!([]), "{asset}");
}

/// An update must prove it was signed for the version `latest.json` announces, or an older
/// signed release could be offered under a newer number. A plugin that does not know the key
/// ignores it without a word, so a typo here would switch the protection off.
#[test]
fn an_update_must_record_the_version_it_was_signed_for() {
    let config = tauri_config();
    let updater = &config["plugins"]["updater"];

    assert_eq!(
        updater["requireSignedVersion"],
        Value::Bool(true),
        "{updater}"
    );
    assert!(
        updater["pubkey"]
            .as_str()
            .is_some_and(|key| !key.is_empty() && !key.contains("REPLACE_WITH")),
        "a real public key: {updater}"
    );
}

/// The updater runs from Rust only (`app_update.rs`), so the window sends no URL, proxy or
/// header of its own. Granting it the plugin's permissions would let it.
#[test]
fn the_window_has_no_permission_to_drive_the_updater_itself() {
    let raw = std::fs::read_to_string(format!(
        "{}/capabilities/default.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("read capabilities/default.json");

    assert!(!raw.contains("updater"), "{raw}");
}
