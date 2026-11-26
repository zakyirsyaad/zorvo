//! A project's design system: a folder holding `design-system.json`, read leniently.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`.

use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::store::clean_title_within;

pub const INDEX_FILE: &str = "design-system.json";
pub const MAX_INDEX_BYTES: usize = 256 * 1024;
pub const MAX_DS_TITLE_CHARS: usize = 120;

/// What Zorvo reads of `design-system.json`. Every other field is ignored.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsIndex {
    pub title: String,
    pub namespace: Option<String>,
    pub libraries: Vec<String>,
    pub asset_group_order: Vec<String>,
    pub is_default: bool,
}

type Fields = serde_json::Map<String, serde_json::Value>;

/// Reads `design-system.json`. Only `title` can refuse it; every other field Zorvo reads is
/// dropped when it does not fit, and a refusal never repeats a value from the file.
pub fn parse_index(bytes: &[u8]) -> Result<DsIndex, String> {
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(format!("{INDEX_FILE}: over 256 KB"));
    }
    let source =
        std::str::from_utf8(bytes).map_err(|_| format!("{INDEX_FILE}: not valid UTF-8"))?;
    let value: serde_json::Value =
        serde_json::from_str(source).map_err(|_| format!("{INDEX_FILE}: not valid JSON"))?;
    let root = value
        .as_object()
        .ok_or_else(|| format!("{INDEX_FILE}: must be a JSON object"))?;
    Ok(DsIndex {
        title: index_title(root)?,
        namespace: root
            .get("namespace")
            .and_then(serde_json::Value::as_str)
            .filter(|name| is_namespace(name))
            .map(str::to_string),
        libraries: libraries(root),
        asset_group_order: asset_group_order(root),
        is_default: root
            .get("zorvo")
            .and_then(|zorvo| zorvo.get("default"))
            .and_then(serde_json::Value::as_bool)
            == Some(true),
    })
}

fn index_title(root: &Fields) -> Result<String, String> {
    let raw = match root.get("title") {
        None => return Err("title: is required".into()),
        Some(value) => value.as_str().ok_or("title: must be a string")?,
    };
    let cleaned = clean_title_within(raw, usize::MAX).ok_or("title: must hold visible text")?;
    if cleaned.chars().count() > MAX_DS_TITLE_CHARS {
        return Err(format!(
            "title: must be at most {MAX_DS_TITLE_CHARS} characters"
        ));
    }
    Ok(cleaned)
}

/// The `bundle.js` global: `[A-Za-z_][A-Za-z0-9_]{0,63}`.
fn is_namespace(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Library names, from a string or an object's `name`; anything else is skipped.
fn libraries(root: &Fields) -> Vec<String> {
    let Some(list) = root.get("libraries").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|item| match item {
            serde_json::Value::String(name) => Some(name.as_str()),
            serde_json::Value::Object(fields) => {
                fields.get("name").and_then(serde_json::Value::as_str)
            }
            _ => None,
        })
        .map(str::to_string)
        .collect()
}

/// `groups` first, then the keys of `assetGroups` not yet listed.
fn asset_group_order(root: &Fields) -> Vec<String> {
    let listed = root
        .get("groups")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str);
    let keyed = root
        .get("assetGroups")
        .and_then(serde_json::Value::as_object)
        .into_iter()
        .flat_map(|groups| groups.keys().map(String::as_str));
    listed.chain(keyed).fold(Vec::new(), |mut order, name| {
        if !order.iter().any(|seen: &String| seen == name) {
            order.push(name.to_string());
        }
        order
    })
}

const KEY_PREFIX: &str = "d-";
const KEY_HEX_CHARS: usize = 16;

/// A system's key: derived from its canonical folder, so the same folder always has it.
pub fn system_key(canonical_folder: &Path) -> String {
    let digest = Sha256::digest(canonical_folder.to_string_lossy().as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{KEY_PREFIX}{}", &hex[..KEY_HEX_CHARS])
}

pub fn is_ds_key(text: &str) -> bool {
    text.strip_prefix(KEY_PREFIX).is_some_and(|hex| {
        hex.len() == KEY_HEX_CHARS
            && hex
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(json: &str) -> Result<DsIndex, String> {
        parse_index(json.as_bytes())
    }

    #[test]
    fn reads_claudes_index_and_ignores_its_other_fields() {
        let read = parse_index(include_bytes!("../../tests/fixtures/ds-claude-index.json"))
            .expect("Claude's index reads");
        assert_eq!(read.title, "Acme Design System");
        assert_eq!(read.namespace.as_deref(), Some("Acme"));
        assert!(read.libraries.is_empty());
        assert!(!read.is_default);
    }

    #[test]
    fn reads_zorvos_own_index() {
        let read = parse_index(include_bytes!(
            "../../../docs/design-system/design-system.json"
        ))
        .expect("Zorvo's index reads");
        assert_eq!(read.title, "Zorvo Design System");
        assert_eq!(read.namespace.as_deref(), Some("Zorvo"));
        assert!(read.is_default);
        assert_eq!(read.asset_group_order, vec!["Logos".to_string()]);
    }

    #[test]
    fn title_is_required_and_visible() {
        for json in [
            r#"{}"#.to_string(),
            r#"{"title": ""}"#.to_string(),
            r#"{"title": "\u200b"}"#.to_string(),
            r#"{"title": 3}"#.to_string(),
            format!(r#"{{"title": "{}"}}"#, "a".repeat(121)),
        ] {
            let error = index(&json).expect_err("refused");
            assert!(error.starts_with("title: "), "{error}");
        }
        let read = index(&format!(r#"{{"title": "{}"}}"#, "a".repeat(120))).expect("120 is fine");
        assert_eq!(read.title.chars().count(), 120);
        let read = index(r#"{"title": "  Acme\u202e Kit\n "}"#).expect("cleaned");
        assert_eq!(read.title, "Acme Kit");
    }

    #[test]
    fn a_bad_namespace_is_dropped_not_refused() {
        assert_eq!(
            index(r#"{"title": "A", "namespace": "1bad"}"#)
                .unwrap()
                .namespace,
            None
        );
        let long = format!(r#"{{"title": "A", "namespace": "{}"}}"#, "a".repeat(65));
        assert_eq!(index(&long).unwrap().namespace, None);
        assert_eq!(
            index(r#"{"title": "A", "namespace": 4}"#)
                .unwrap()
                .namespace,
            None
        );
        let ok = format!(r#"{{"title": "A", "namespace": "_{}"}}"#, "a".repeat(63));
        assert!(index(&ok).unwrap().namespace.is_some());
    }

    #[test]
    fn libraries_take_strings_or_objects_with_a_name() {
        let read = index(
            r#"{"title": "A", "libraries": ["react", {"name": "react-dom", "version": "19"}, 3, {"version": "1"}]}"#,
        )
        .unwrap();
        assert_eq!(read.libraries, vec!["react", "react-dom"]);
        assert!(index(r#"{"title": "A", "libraries": "react"}"#)
            .unwrap()
            .libraries
            .is_empty());
    }

    #[test]
    fn asset_group_order_comes_from_groups_then_asset_groups() {
        let read = index(
            r#"{"title": "A", "groups": ["Icons", 7, "Logos"], "assetGroups": {"Logos": {}, "Photos": {}, "Icons": {}}}"#,
        )
        .unwrap();
        assert_eq!(read.asset_group_order, vec!["Icons", "Logos", "Photos"]);
    }

    #[test]
    fn default_is_true_only_for_a_json_true() {
        assert!(
            index(r#"{"title": "A", "zorvo": {"default": true}}"#)
                .unwrap()
                .is_default
        );
        assert!(
            !index(r#"{"title": "A", "zorvo": {"default": "true"}}"#)
                .unwrap()
                .is_default
        );
        assert!(
            !index(r#"{"title": "A", "zorvo": true}"#)
                .unwrap()
                .is_default
        );
    }

    #[test]
    fn refuses_over_256_kib_bad_utf8_and_non_objects() {
        let secret = "SECRETTEXT";
        let big = format!(
            r#"{{"title": "{secret}", "pad": "{}"}}"#,
            "x".repeat(MAX_INDEX_BYTES)
        );
        for bytes in [
            big.into_bytes(),
            vec![b'{', 0xff, b'}'],
            format!(r#"["{secret}"]"#).into_bytes(),
            format!(r#"{{"title": "{secret}""#).into_bytes(),
        ] {
            let error = parse_index(&bytes).expect_err("refused");
            assert!(!error.contains(secret), "{error}");
            assert!(error.starts_with("design-system.json: "), "{error}");
        }
    }

    #[test]
    fn the_key_is_the_same_for_the_same_folder() {
        let one = system_key(Path::new("/w/app/docs/design-system"));
        assert_eq!(one, system_key(Path::new("/w/app/docs/design-system")));
        assert!(is_ds_key(&one), "{one}");
        assert_eq!(one.len(), 18);
        assert_ne!(one, system_key(Path::new("/w/app/brand")));
        assert!(!is_ds_key("d-0123"));
        assert!(!is_ds_key("c-0123456789abcdef"));
        assert!(!is_ds_key("d-0123456789ABCDEF"));
        assert!(is_ds_key("d-0123456789abcdef"));
    }
}
