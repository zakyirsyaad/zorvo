//! A project's design system: a folder holding `design-system.json`, read leniently.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::ds_tokens::{parse_tokens, DsDropped};
use super::source::read_checked;
use super::store::clean_title_within;

pub const INDEX_FILE: &str = "design-system.json";
pub const MAX_INDEX_BYTES: usize = 256 * 1024;
pub const MAX_DS_TITLE_CHARS: usize = 120;

pub const NOT_A_DESIGN_SYSTEM: &str =
    "The design system must be a folder with a design-system.json inside this folder.";
pub const UNREADABLE_INDEX: &str =
    "design-system.json could not be read: it must be a JSON object with a title.";
pub const NO_README: &str = "A design system needs a README.md beside its design-system.json.";
pub const TOO_BIG: &str = "A file of this design system is over its limit.";

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

pub const MAX_FIND_DEPTH: usize = 4;
pub const MAX_FIND_ENTRIES: usize = 5000;
pub const MAX_SYSTEMS: usize = 20;

/// A system found in a session's folder.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundSystem {
    pub key: String,
    #[serde(skip)]
    pub folder: PathBuf,
    /// The folder relative to the session's folder; `.` for the session's folder itself.
    pub relative: String,
    pub title: String,
    /// The computed default, not the index's own flag.
    pub is_default: bool,
    /// The tokens `tokens.json` could not read, so the guide line repeats them.
    pub dropped: Vec<DsDropped>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemList {
    pub systems: Vec<FoundSystem>,
    pub default_problem: Option<DefaultProblem>,
}

/// Why several systems have no default.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DefaultProblem {
    SeveralMarked { relatives: Vec<String> },
    NoneMarked { relatives: Vec<String> },
}

pub fn find_systems(session_folder: &Path) -> SystemList {
    find_systems_within(session_folder, MAX_FIND_ENTRIES)
}

/// Folders never searched: they hold dependencies, build output or a tool's own files.
const SKIPPED_FOLDERS: &[&str] = &["node_modules", ".git", "target", "dist"];
const TOKENS_FILE: &str = "tokens.json";

/// A system as read, before the default is worked out.
struct Candidate {
    found: FoundSystem,
    is_marked: bool,
}

/// `find_systems` with an entry limit of the caller's choosing. Each folder is read in name
/// order and every entry counts, so a large project always stops at the same entries; a
/// folder is judged when its entry is read, and a link is never followed.
fn find_systems_within(root: &Path, max_entries: usize) -> SystemList {
    let Ok(root) = fs::canonicalize(root) else {
        return with_default(Vec::new());
    };
    let mut found: Vec<Candidate> = read_system(&root, ".").into_iter().collect();
    let mut seen = 0usize;
    let mut folders = vec![(root.clone(), String::new(), 0usize)];
    'walk: while let Some((folder, prefix, depth)) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        let mut subfolders = Vec::new();
        for entry in entries {
            if seen >= max_entries || found.len() >= MAX_SYSTEMS {
                break 'walk;
            }
            seen += 1;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let is_folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if !is_folder || name.starts_with('.') || SKIPPED_FOLDERS.contains(&name.as_str()) {
                continue;
            }
            let relative = format!("{prefix}{name}");
            found.extend(read_system(&entry.path(), &relative));
            if depth + 1 < MAX_FIND_DEPTH {
                subfolders.push((entry.path(), format!("{relative}/"), depth + 1));
            }
        }
        // Pushed in reverse, so the first name is walked first.
        folders.extend(subfolders.into_iter().rev());
    }
    found.truncate(MAX_SYSTEMS);
    with_default(found)
}

/// The regular file at `path`, read without following a link; `None` for anything else.
fn regular_file(path: &Path) -> Option<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    read_checked(path).ok()
}

/// The system in `folder`, when it holds a `design-system.json` that reads.
fn read_system(folder: &Path, relative: &str) -> Option<Candidate> {
    let index = parse_index(&regular_file(&folder.join(INDEX_FILE))?).ok()?;
    let folder = fs::canonicalize(folder).ok()?;
    let dropped = regular_file(&folder.join(TOKENS_FILE))
        .and_then(|bytes| parse_tokens(&bytes).ok())
        .map(|tokens| tokens.dropped)
        .unwrap_or_default();
    Some(Candidate {
        found: FoundSystem {
            key: system_key(&folder),
            folder,
            relative: relative.to_string(),
            title: index.title,
            is_default: false,
            dropped,
        },
        is_marked: index.is_default,
    })
}

/// The one system marked default; with exactly one system and none marked, that one.
/// Otherwise no default, and the problem names the systems.
fn with_default(found: Vec<Candidate>) -> SystemList {
    let marked: Vec<String> = found
        .iter()
        .filter(|c| c.is_marked)
        .map(|c| c.found.relative.clone())
        .collect();
    let default_problem = match (marked.len(), found.len()) {
        (0, 0 | 1) | (1, _) => None,
        (0, _) => Some(DefaultProblem::NoneMarked {
            relatives: found.iter().map(|c| c.found.relative.clone()).collect(),
        }),
        _ => Some(DefaultProblem::SeveralMarked {
            relatives: marked.clone(),
        }),
    };
    let systems = found
        .into_iter()
        .map(|candidate| {
            let is_default =
                default_problem.is_none() && (candidate.is_marked || marked.is_empty());
            FoundSystem {
                is_default,
                ..candidate.found
            }
        })
        .collect();
    SystemList {
        systems,
        default_problem,
    }
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

    use super::super::test_support::Temp;

    fn system(root: &Path, relative: &str, json: &str) {
        let folder = root.join(relative);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(INDEX_FILE), json).unwrap();
    }

    fn titled(root: &Path, relative: &str) {
        system(root, relative, &format!(r#"{{"title": "{relative}"}}"#));
    }

    fn relatives(list: &SystemList) -> Vec<&str> {
        list.systems.iter().map(|s| s.relative.as_str()).collect()
    }

    #[test]
    fn finds_systems_four_levels_deep_and_not_five() {
        let temp = Temp::new("ds-depth");
        titled(&temp.0, "a/b/c/d");
        titled(&temp.0, "e/f/g/h/i");
        assert_eq!(relatives(&find_systems(&temp.0)), ["a/b/c/d"]);
    }

    #[test]
    fn the_session_folder_itself_can_be_a_system() {
        let temp = Temp::new("ds-root");
        system(&temp.0, ".", r#"{"title": "Root"}"#);
        let list = find_systems(&temp.0);
        assert_eq!(relatives(&list), ["."]);
        assert_eq!(list.systems[0].folder, temp.0);
        assert_eq!(list.systems[0].key, system_key(&temp.0));
    }

    #[test]
    fn skips_node_modules_git_target_dist_and_hidden_folders() {
        let temp = Temp::new("ds-skip");
        for skipped in ["node_modules/x", ".git", "target", "dist/ds", ".hidden"] {
            titled(&temp.0, skipped);
        }
        titled(&temp.0, "docs/design-system");
        assert_eq!(relatives(&find_systems(&temp.0)), ["docs/design-system"]);
    }

    #[test]
    fn never_follows_a_symlinked_folder() {
        let temp = Temp::new("ds-link");
        let elsewhere = Temp::new("ds-link-target");
        titled(&elsewhere.0, "brand");
        std::os::unix::fs::symlink(elsewhere.0.join("brand"), temp.0.join("brand")).unwrap();
        std::os::unix::fs::symlink(&elsewhere.0, temp.0.join("outside")).unwrap();
        assert!(find_systems(&temp.0).systems.is_empty());
    }

    #[test]
    fn an_index_that_is_a_link_is_not_a_system() {
        let temp = Temp::new("ds-index-link");
        let elsewhere = Temp::new("ds-index-link-target");
        fs::write(elsewhere.0.join(INDEX_FILE), r#"{"title": "Elsewhere"}"#).unwrap();
        fs::create_dir_all(temp.0.join("brand")).unwrap();
        std::os::unix::fs::symlink(
            elsewhere.0.join(INDEX_FILE),
            temp.0.join("brand").join(INDEX_FILE),
        )
        .unwrap();
        assert!(find_systems(&temp.0).systems.is_empty());
    }

    #[test]
    fn stops_at_the_entry_limit_in_name_order() {
        let temp = Temp::new("ds-limit");
        for n in 0..10 {
            fs::write(temp.0.join(format!("f{n:04}")), "").unwrap();
        }
        titled(&temp.0, "zz");
        assert!(find_systems_within(&temp.0, 10).systems.is_empty());
        assert_eq!(relatives(&find_systems_within(&temp.0, 11)), ["zz"]);
        fs::rename(temp.0.join("zz"), temp.0.join("aa")).unwrap();
        assert_eq!(relatives(&find_systems_within(&temp.0, 10)), ["aa"]);
        assert_eq!(MAX_FIND_ENTRIES, 5000);
    }

    #[test]
    fn keeps_at_most_20() {
        let temp = Temp::new("ds-many");
        for n in 0..21 {
            titled(&temp.0, &format!("s{n:02}"));
        }
        let list = find_systems(&temp.0);
        assert_eq!(list.systems.len(), MAX_SYSTEMS);
        assert_eq!(list.systems[0].relative, "s00");
        assert_eq!(list.systems[19].relative, "s19");
    }

    #[test]
    fn an_index_that_does_not_parse_is_not_a_system() {
        let temp = Temp::new("ds-bad");
        system(&temp.0, "a", r#"{"title": ""}"#);
        system(&temp.0, "b", "not json");
        fs::create_dir_all(temp.0.join("c").join(INDEX_FILE)).unwrap();
        titled(&temp.0, "d");
        assert_eq!(relatives(&find_systems(&temp.0)), ["d"]);
    }

    #[test]
    fn a_found_system_carries_its_dropped_tokens() {
        let temp = Temp::new("ds-dropped");
        titled(&temp.0, "a");
        fs::write(
            temp.0.join("a/tokens.json"),
            r#"{"color": {"tokens": [{"name": "brand", "value": "var(--x)"}]}}"#,
        )
        .unwrap();
        titled(&temp.0, "b");
        let list = find_systems(&temp.0);
        assert_eq!(
            list.systems[0].dropped,
            vec![DsDropped {
                family: "color".into(),
                name: "brand".into(),
                reason: "var()"
            }]
        );
        assert!(list.systems[1].dropped.is_empty());
    }

    #[test]
    fn the_default() {
        let one = Temp::new("ds-default-one");
        titled(&one.0, "a");
        let list = find_systems(&one.0);
        assert!(list.systems[0].is_default);
        assert_eq!(list.default_problem, None);

        let marked = Temp::new("ds-default-marked");
        titled(&marked.0, "a");
        system(
            &marked.0,
            "b",
            r#"{"title": "B", "zorvo": {"default": true}}"#,
        );
        let list = find_systems(&marked.0);
        let defaults: Vec<bool> = list.systems.iter().map(|s| s.is_default).collect();
        assert_eq!(defaults, [false, true]);
        assert_eq!(list.default_problem, None);

        let several = Temp::new("ds-default-several");
        system(
            &several.0,
            "a",
            r#"{"title": "A", "zorvo": {"default": true}}"#,
        );
        system(
            &several.0,
            "b",
            r#"{"title": "B", "zorvo": {"default": true}}"#,
        );
        titled(&several.0, "c");
        let list = find_systems(&several.0);
        assert!(list.systems.iter().all(|s| !s.is_default));
        assert_eq!(
            list.default_problem,
            Some(DefaultProblem::SeveralMarked {
                relatives: vec!["a".into(), "b".into()]
            })
        );

        let none = Temp::new("ds-default-none");
        for name in ["a", "b", "c"] {
            titled(&none.0, name);
        }
        let list = find_systems(&none.0);
        assert!(list.systems.iter().all(|s| !s.is_default));
        assert_eq!(
            list.default_problem,
            Some(DefaultProblem::NoneMarked {
                relatives: vec!["a".into(), "b".into(), "c".into()]
            })
        );

        let empty = Temp::new("ds-default-empty");
        assert_eq!(
            find_systems(&empty.0),
            SystemList {
                systems: vec![],
                default_problem: None
            }
        );
    }

    #[test]
    fn a_list_serializes_for_the_webview() {
        let temp = Temp::new("ds-json");
        titled(&temp.0, "a");
        titled(&temp.0, "b");
        let json = serde_json::to_value(find_systems(&temp.0)).unwrap();
        assert!(json["systems"][0].get("folder").is_none());
        assert_eq!(json["systems"][0]["isDefault"], false);
        assert_eq!(json["defaultProblem"]["kind"], "noneMarked");
    }
}
