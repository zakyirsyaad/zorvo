//! `canvas.json`, version 1: the list of artboards an agent lays out on a design canvas.
//! Format: `docs/superpowers/specs/2026-11-21-design-canvas-design.md`, section 1.
//! Agent data is read field by field from a `serde_json::Value`, never deserialized into
//! the types, so every refusal can name its field and none repeats the file's text.

use super::source::{read_checked, MAX_PATH_CHARS};
use super::store::clean_title_within;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub const NOT_A_CANVAS: &str = "The canvas must be a folder with a canvas.json inside this folder.";
const CANVAS_FILE: &str = "canvas.json";

/// What an artboard's page may load, by extension (lowercase), with the type it is served as.
pub const SERVED_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("htm", "text/html; charset=utf-8"),
    ("css", "text/css"),
    ("js", "text/javascript"),
    ("mjs", "text/javascript"),
    ("json", "application/json"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("svg", "image/svg+xml"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("otf", "font/otf"),
];

/// A canvas folder: its canonical path, and its path relative to the session's folder.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasFolder {
    pub root: PathBuf,
    pub relative: String,
}

/// Finds the canvas the agent names (its folder or its `canvas.json`). Only a folder inside
/// the session's folder counts, never a temporary one, and a refusal never repeats the path.
pub fn resolve_canvas(session_folder: &Path, path: &str) -> Result<CanvasFolder, String> {
    let refused = || NOT_A_CANVAS.to_string();
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
        return Err(refused());
    }
    let session = fs::canonicalize(session_folder).map_err(|_| refused())?;
    let mut root = fs::canonicalize(session.join(path)).map_err(|_| refused())?;
    if root.is_file() && root.file_name().is_some_and(|name| name == CANVAS_FILE) {
        root.pop();
    }
    let relative = root.strip_prefix(&session).map_err(|_| refused())?;
    if !root.is_dir() || !root.join(CANVAS_FILE).is_file() {
        return Err(refused());
    }
    let relative = relative
        .components()
        .map(|part| part.as_os_str().to_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(refused)?
        .join("/");
    Ok(CanvasFolder { root, relative })
}

pub fn read_canvas(root: &Path) -> Result<Canvas, String> {
    parse_canvas(&read_checked(&root.join(CANVAS_FILE))?)
}

/// The file a canvas page asks for: its canonical path inside `root` and the type it is served
/// as, or `None` for anything else. The text is judged before the disk is touched.
pub fn canvas_file(root: &Path, relative: &str) -> Option<(PathBuf, &'static str)> {
    let is_plain = !relative.starts_with('/')
        && !relative.chars().any(|c| c.is_control() || c == '\\')
        && relative
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    if !is_plain {
        return None;
    }
    let canonical = fs::canonicalize(root.join(relative)).ok()?;
    if !canonical.starts_with(root) {
        return None;
    }
    let extension = canonical.extension()?.to_str()?.to_ascii_lowercase();
    let (_, kind) = SERVED_TYPES.iter().find(|(name, _)| *name == extension)?;
    Some((canonical, kind))
}

/// Lowercase hex SHA-256 of a file read through the same checks as every other read.
pub fn file_sha256(path: &Path) -> Option<String> {
    let bytes = read_checked(path).ok()?;
    Some(hex(Sha256::digest(bytes)))
}

/// How deep the folder digest of `board_key` walks, and how many entries (of any kind, pages and
/// folders included) it looks at; past either, the rest is left out.
pub const MAX_DIGEST_DEPTH: usize = 8;
pub const MAX_DIGEST_ENTRIES: usize = 5000;

fn hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Whether a file of the folder is one an artboard may load but is no artboard's page:
/// `canvas.json` and HTML pages are left out, since each artboard's key already holds its own
/// page and its width and height.
fn is_shared_file(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    lower != CANVAS_FILE && !lower.ends_with(".html") && !lower.ends_with(".htm")
}

/// The servable files of the canvas folder that are no page (CSS, scripts, images, fonts), each
/// as its relative path, size and modification time, in path order. No file is opened. Links
/// are followed only to files inside the folder, never into folders. Each folder is read in name
/// order and every entry counts toward the limit, so a folder too big to walk whole always stops
/// at the same entries and its digest stays the same while nothing changes.
fn folder_digest(root: &Path) -> String {
    folder_digest_within(root, MAX_DIGEST_ENTRIES)
}

fn folder_digest_within(root: &Path, max_entries: usize) -> String {
    let mut lines = Vec::new();
    let mut seen = 0usize;
    let mut folders = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((folder, prefix, depth)) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        let mut subfolders = Vec::new();
        for entry in entries {
            if seen >= max_entries {
                break;
            }
            seen += 1;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let relative = format!("{prefix}{name}");
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if depth + 1 < MAX_DIGEST_DEPTH {
                    subfolders.push((entry.path(), format!("{relative}/"), depth + 1));
                }
                continue;
            }
            if !is_shared_file(&relative) {
                continue;
            }
            let Some((path, _)) = canvas_file(root, &relative) else {
                continue;
            };
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_nanos());
            lines.push(format!("{relative}\0{}\0{modified}", meta.len()));
        }
        // A stack: push in reverse so the first subfolder by name is walked next.
        folders.extend(subfolders.into_iter().rev());
    }
    lines.sort();
    hex(Sha256::digest(lines.join("\n")))
}

/// What an artboard's picture and live frame are keyed by: the SHA-256 of its page's path in
/// the folder, its page's hash, the folder digest and its width and height. A change to any of
/// them, a shared stylesheet's included, draws a new picture and reloads the frame; the path is
/// in it because one page in two folders loads its relative files from each. `None` when the
/// page cannot be served.
pub fn board_key(root: &Path, file: &str, width: u32, height: u32) -> Option<String> {
    let (path, _) = canvas_file(root, file)?;
    let page = file_sha256(&path)?;
    let folder = folder_digest(root);
    Some(hex(Sha256::digest(format!(
        "{file}\0{page}\0{folder}\0{width}x{height}"
    ))))
}

pub const MAX_CANVAS_JSON_BYTES: usize = 256 * 1024;
pub const MAX_SECTIONS: usize = 50;
pub const MAX_ARTBOARDS: usize = 200;
pub const MIN_SIDE: u64 = 200;
pub const MAX_SIDE: u64 = 8000;
pub const MAX_CANVAS_TITLE_CHARS: usize = 120;
pub const MAX_ID_CHARS: usize = 64;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub title: String,
    pub sections: Vec<Section>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub title: String,
    pub artboards: Vec<Artboard>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artboard {
    pub id: String,
    pub title: String,
    pub file: String,
    pub width: u32,
    pub height: u32,
    pub group: Option<String>,
}

/// A file an artboard may name: a relative `.html`/`.htm` path inside the canvas folder.
/// Only the text is judged here; the reader that opens the file refuses links that leave.
pub fn is_relative_file(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    if !(lower.ends_with(".html") || lower.ends_with(".htm")) {
        return false;
    }
    if file.starts_with('/') || file.chars().any(|c| c.is_control() || c == '\\') {
        return false;
    }
    file.split('/')
        .all(|part| !part.is_empty() && part != "." && part != "..")
}

pub(crate) fn is_id(text: &str) -> bool {
    (1..=MAX_ID_CHARS).contains(&text.chars().count())
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

type Fields = serde_json::Map<String, serde_json::Value>;

fn object<'a>(value: &'a serde_json::Value, path: &str) -> Result<&'a Fields, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{path}: must be an object"))
}

fn text<'a>(fields: &'a Fields, name: &str, path: &str) -> Result<&'a str, String> {
    match fields.get(name) {
        None => Err(format!("{path}.{name}: is required")),
        Some(value) => value
            .as_str()
            .ok_or_else(|| format!("{path}.{name}: must be a string")),
    }
}

fn title(fields: &Fields, path: &str) -> Result<String, String> {
    let raw = text(fields, "title", path)?;
    clean_title_within(raw, MAX_CANVAS_TITLE_CHARS)
        .ok_or_else(|| format!("{path}.title: must hold visible text"))
}

fn id(fields: &Fields, name: &str, path: &str) -> Result<String, String> {
    let raw = text(fields, name, path)?;
    if is_id(raw) {
        Ok(raw.to_string())
    } else {
        Err(format!(
            "{path}.{name}: must be 1 to {MAX_ID_CHARS} characters of a-z, 0-9 and -"
        ))
    }
}

/// Refuses a field not in `known`. The name is echoed only when it is short and plain, so a
/// file cannot make an error carry its own text.
fn only_known(fields: &Fields, known: &[&str], path: &str) -> Result<(), String> {
    let Some(unknown) = fields.keys().find(|key| !known.contains(&key.as_str())) else {
        return Ok(());
    };
    let plain = unknown.chars().count() <= 32
        && unknown
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{path}.")
    };
    if plain {
        Err(format!("{prefix}{unknown}: is not a field of canvas.json"))
    } else {
        Err(format!(
            "{}: has a field canvas.json does not use",
            path.trim_end_matches('.')
        ))
    }
}

fn side(fields: &Fields, name: &str, path: &str) -> Result<u32, String> {
    let wrong = || format!("{path}.{name}: must be a whole number from {MIN_SIDE} to {MAX_SIDE}");
    let value = fields
        .get(name)
        .ok_or_else(|| format!("{path}.{name}: is required"))?;
    let number = value.as_u64().ok_or_else(wrong)?;
    if (MIN_SIDE..=MAX_SIDE).contains(&number) {
        u32::try_from(number).map_err(|_| wrong())
    } else {
        Err(wrong())
    }
}

fn artboard(
    value: &serde_json::Value,
    path: &str,
    seen: &mut Vec<String>,
) -> Result<Artboard, String> {
    let fields = object(value, path)?;
    only_known(
        fields,
        &["id", "title", "file", "width", "height", "group"],
        path,
    )?;
    let board_id = id(fields, "id", path)?;
    if seen.contains(&board_id) {
        return Err(format!("{path}.id: must be unique in the canvas"));
    }
    seen.push(board_id.clone());
    let board_title = title(fields, path)?;
    let file = text(fields, "file", path)?;
    if !is_relative_file(file) {
        return Err(format!(
            "{path}.file: must be a relative .html or .htm path inside the canvas folder"
        ));
    }
    let width = side(fields, "width", path)?;
    let height = side(fields, "height", path)?;
    let group = match fields.get("group") {
        None => None,
        Some(_) => Some(id(fields, "group", path)?),
    };
    Ok(Artboard {
        id: board_id,
        title: board_title,
        file: file.to_string(),
        width,
        height,
        group,
    })
}

fn section(
    value: &serde_json::Value,
    path: &str,
    seen: &mut Vec<String>,
    total: &mut usize,
) -> Result<Section, String> {
    let fields = object(value, path)?;
    only_known(fields, &["id", "title", "artboards"], path)?;
    let section_id = id(fields, "id", path)?;
    if seen.contains(&section_id) {
        return Err(format!("{path}.id: must be unique in the canvas"));
    }
    seen.push(section_id.clone());
    let section_title = title(fields, path)?;
    let list = fields
        .get("artboards")
        .ok_or_else(|| format!("{path}.artboards: is required"))?
        .as_array()
        .ok_or_else(|| format!("{path}.artboards: must be a list"))?;
    if list.is_empty() || list.len() > MAX_ARTBOARDS {
        return Err(format!(
            "{path}.artboards: must hold 1 to {MAX_ARTBOARDS} artboards"
        ));
    }
    *total += list.len();
    if *total > MAX_ARTBOARDS {
        return Err(format!(
            "{path}.artboards: the canvas may hold at most {MAX_ARTBOARDS} artboards in all"
        ));
    }
    let mut artboards = Vec::with_capacity(list.len());
    for (index, item) in list.iter().enumerate() {
        artboards.push(artboard(item, &format!("{path}.artboards[{index}]"), seen)?);
    }
    Ok(Section {
        id: section_id,
        title: section_title,
        artboards,
    })
}

/// A group names variants of one screen, so it needs two artboards or more.
fn check_groups(sections: &[Section]) -> Result<(), String> {
    let members = |group: &str| {
        sections
            .iter()
            .flat_map(|s| &s.artboards)
            .filter(|b| b.group.as_deref() == Some(group))
            .count()
    };
    for (si, section) in sections.iter().enumerate() {
        for (ai, board) in section.artboards.iter().enumerate() {
            if let Some(group) = &board.group {
                if members(group) < 2 {
                    return Err(format!(
                        "sections[{si}].artboards[{ai}].group: a group needs two artboards or more"
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Reads `canvas.json`. Every refusal names the field that is wrong and the rule it broke,
/// and never repeats a value from the file.
pub fn parse_canvas(bytes: &[u8]) -> Result<Canvas, String> {
    if bytes.len() > MAX_CANVAS_JSON_BYTES {
        return Err("canvas.json: over 256 KB".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "canvas.json: not valid UTF-8")?;
    let value: serde_json::Value =
        serde_json::from_str(source).map_err(|_| "canvas.json: not valid JSON")?;
    let root = value
        .as_object()
        .ok_or("canvas.json: must be a JSON object")?;
    if root.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("version: must be 1".into());
    }
    only_known(root, &["version", "title", "sections"], "")?;
    let canvas_title = match root.get("title") {
        None => return Err("title: is required".into()),
        Some(v) => v.as_str().ok_or("title: must be a string")?,
    };
    let canvas_title = clean_title_within(canvas_title, MAX_CANVAS_TITLE_CHARS)
        .ok_or("title: must hold visible text")?;
    let list = root
        .get("sections")
        .ok_or("sections: is required")?
        .as_array()
        .ok_or("sections: must be a list")?;
    if list.is_empty() || list.len() > MAX_SECTIONS {
        return Err(format!("sections: must hold 1 to {MAX_SECTIONS} sections"));
    }
    let mut seen = Vec::new();
    let mut total = 0;
    let mut sections = Vec::with_capacity(list.len());
    for (index, item) in list.iter().enumerate() {
        sections.push(section(
            item,
            &format!("sections[{index}]"),
            &mut seen,
            &mut total,
        )?);
    }
    check_groups(&sections)?;
    Ok(Canvas {
        title: canvas_title,
        sections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = r#"{
      "version": 1, "title": "Checkout",
      "sections": [{ "id": "flow", "title": "Flow", "artboards": [
        { "id": "cart", "title": "Cart", "file": "cart.html", "width": 1440, "height": 900 },
        { "id": "pay-a", "title": "Payment A", "file": "pay-a.html", "width": 1440, "height": 900, "group": "pay" },
        { "id": "pay-b", "title": "Payment B", "file": "pay-b.html", "width": 1440, "height": 900, "group": "pay" }
      ]}]
    }"#;

    fn one(board: &str) -> String {
        format!(
            r#"{{"version":1,"title":"x","sections":[{{"id":"s","title":"S","artboards":[{board}]}}]}}"#
        )
    }

    fn board(id: &str, file: &str) -> String {
        format!(r#"{{"id":"{id}","title":"T","file":"{file}","width":400,"height":400}}"#)
    }

    fn err(json: &str) -> String {
        parse_canvas(json.as_bytes()).expect_err("should be refused")
    }

    #[test]
    fn parses_the_spec_example() {
        let canvas = parse_canvas(SPEC.as_bytes()).expect("spec example parses");
        assert_eq!(canvas.title, "Checkout");
        assert_eq!(canvas.sections.len(), 1);
        let boards = &canvas.sections[0].artboards;
        assert_eq!(boards.len(), 3);
        assert_eq!(boards[0].group, None);
        assert_eq!(boards[1].group.as_deref(), Some("pay"));
        assert_eq!((boards[2].width, boards[2].height), (1440, 900));
    }

    #[test]
    fn refuses_another_version() {
        let json = SPEC.replace(r#""version": 1"#, r#""version": 2"#);
        assert_eq!(err(&json), "version: must be 1");
    }

    #[test]
    fn names_the_field_that_is_wrong() {
        let json = SPEC.replace(
            r#""file": "pay-b.html", "width": 1440"#,
            r#""file": "pay-b.html", "width": 100"#,
        );
        assert_eq!(
            err(&json),
            "sections[0].artboards[2].width: must be a whole number from 200 to 8000"
        );
    }

    #[test]
    fn refuses_unknown_top_level_fields() {
        let json = SPEC.replacen("\"version\": 1,", "\"version\": 1, \"extra\": 1,", 1);
        assert!(err(&json).starts_with("extra:"));
    }

    #[test]
    fn refuses_duplicate_ids_across_sections() {
        let json = format!(
            r#"{{"version":1,"title":"x","sections":[
              {{"id":"s1","title":"A","artboards":[{}]}},
              {{"id":"s2","title":"B","artboards":[{}]}}]}}"#,
            board("a", "a.html"),
            board("a", "b.html")
        );
        assert!(err(&json).ends_with("must be unique in the canvas"));
    }

    #[test]
    fn refuses_a_group_of_one() {
        let json =
            one(r#"{"id":"a","title":"T","file":"a.html","width":400,"height":400,"group":"pay"}"#);
        assert_eq!(
            err(&json),
            "sections[0].artboards[0].group: a group needs two artboards or more"
        );
    }

    #[test]
    fn refuses_files_that_leave_the_folder() {
        for file in ["../x.html", "/x.html", "a/../../x.html", "x.txt", ""] {
            assert!(!is_relative_file(file), "{file:?}");
            assert!(
                parse_canvas(one(&board("a", file)).as_bytes()).is_err(),
                "{file:?}"
            );
        }
    }

    #[test]
    fn accepts_a_file_in_a_subfolder() {
        assert!(is_relative_file("screens/cart.html"));
        assert!(parse_canvas(one(&board("a", "screens/cart.html")).as_bytes()).is_ok());
    }

    #[test]
    fn cleans_titles_and_refuses_invisible_ones() {
        let json = SPEC.replace("\"Cart\"", "\"Cart\\u202E\"");
        let canvas = parse_canvas(json.as_bytes()).expect("cleaned");
        assert_eq!(canvas.sections[0].artboards[0].title, "Cart");
        let json = SPEC.replace("\"Flow\"", "\"\\u200B\"");
        assert_eq!(err(&json), "sections[0].title: must hold visible text");
    }

    #[test]
    fn refuses_more_than_200_artboards_and_more_than_256_kib() {
        let boards: Vec<String> = (0..201)
            .map(|i| board(&format!("a{i}"), "a.html"))
            .collect();
        assert!(parse_canvas(one(&boards.join(",")).as_bytes()).is_err());
        let big = vec![b' '; MAX_CANVAS_JSON_BYTES + 1];
        assert_eq!(parse_canvas(&big).unwrap_err(), "canvas.json: over 256 KB");
    }

    #[test]
    fn refuses_invalid_utf8_and_non_objects() {
        assert_eq!(
            parse_canvas(&[0xff]).unwrap_err(),
            "canvas.json: not valid UTF-8"
        );
        assert_eq!(err("[]"), "canvas.json: must be a JSON object");
    }

    #[test]
    fn never_repeats_the_files_text() {
        let secret = "secret".repeat(83);
        let json = SPEC
            .replace("\"Checkout\"", &format!("\"{secret}\""))
            .replace("\"version\": 1", "\"version\": \"secretsecret\"");
        assert!(!err(&json).contains("secret"));
        let json = SPEC.replace("\"cart.html\"", &format!("\"{secret}\""));
        assert!(!err(&json).contains("secret"));
        let json = SPEC.replacen(
            "\"version\": 1,",
            &format!("\"version\": 1, \"{secret}\": 1,"),
            1,
        );
        assert!(!err(&json).contains("secret"));
    }
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    use crate::artifacts::test_support::Temp;
    use std::fs;

    #[test]
    fn resolves_the_folder_or_its_canvas_json() {
        let session = Temp::new("canvas-resolve");
        fs::create_dir_all(session.0.join("design/c")).unwrap();
        fs::write(session.0.join("design/c/canvas.json"), b"{}").unwrap();

        let by_folder = resolve_canvas(&session.0, "design/c").unwrap();
        let by_file = resolve_canvas(&session.0, "design/c/canvas.json").unwrap();

        assert_eq!(by_folder, by_file);
        assert_eq!(by_folder.relative, "design/c");
        assert_eq!(by_folder.root, session.0.join("design/c"));
    }

    #[test]
    fn refuses_a_folder_outside_the_session_or_in_temp() {
        let session = Temp::new("canvas-outside");
        let other = Temp::new("canvas-other");
        fs::write(other.0.join("canvas.json"), b"{}").unwrap();
        fs::create_dir_all(session.0.join("c")).unwrap();
        fs::write(session.0.join("c/canvas.json"), b"{}").unwrap();
        let outside = other.0.to_str().unwrap();

        for path in [outside, "/tmp", "../other", "", "missing"] {
            assert_eq!(resolve_canvas(&session.0, path).unwrap_err(), NOT_A_CANVAS);
        }
        fs::create_dir_all(session.0.join("empty")).unwrap();
        assert_eq!(
            resolve_canvas(&session.0, "empty").unwrap_err(),
            NOT_A_CANVAS
        );
    }

    #[test]
    fn serves_only_listed_types_inside_the_root() {
        let root = Temp::new("canvas-serve");
        for name in ["a.png", "a.exe", "B.PNG", "noext"] {
            fs::write(root.0.join(name), b"x").unwrap();
        }

        let (path, kind) = canvas_file(&root.0, "a.png").unwrap();
        assert_eq!(path, root.0.join("a.png"));
        assert_eq!(kind, "image/png");
        assert_eq!(canvas_file(&root.0, "B.PNG").unwrap().1, "image/png");
        for bad in [
            "a.exe",
            "noext",
            "../a.png",
            "/a.png",
            "a//b.png",
            "a\\b.png",
            "",
            "missing.png",
        ] {
            assert!(canvas_file(&root.0, bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn refuses_a_link_out_of_the_root() {
        let root = Temp::new("canvas-link");
        std::os::unix::fs::symlink("/etc/hosts", root.0.join("x.png")).unwrap();

        assert!(canvas_file(&root.0, "x.png").is_none());
        assert!(read_checked(&root.0.join("x.png")).is_err());
    }

    #[test]
    fn an_artboards_key_follows_the_folders_other_files_and_its_size() {
        let root = Temp::new("canvas-key");
        fs::write(root.0.join("cart.html"), b"<p>cart</p>").unwrap();
        fs::write(root.0.join("other.html"), b"<p>other</p>").unwrap();
        fs::create_dir_all(root.0.join("css")).unwrap();
        fs::write(root.0.join("css/shared.css"), b"p{color:red}").unwrap();
        let key = |width, height| board_key(&root.0, "cart.html", width, height).unwrap();
        let first = key(1440, 900);

        assert_eq!(first.len(), 64);
        assert_eq!(key(1440, 900), first, "nothing changed");
        assert_ne!(key(390, 900), first, "width");
        assert_ne!(key(1440, 844), first, "height");

        // Another artboard's page and canvas.json are not part of this one's key.
        fs::write(root.0.join("other.html"), b"<p>other, changed</p>").unwrap();
        fs::write(root.0.join("canvas.json"), b"{}").unwrap();
        assert_eq!(key(1440, 900), first);

        fs::write(root.0.join("css/shared.css"), b"p{color:blue;}").unwrap();
        let resized = key(1440, 900);
        assert_ne!(resized, first, "the shared CSS's size");

        let touched = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        fs::File::options()
            .write(true)
            .open(root.0.join("css/shared.css"))
            .unwrap()
            .set_modified(touched)
            .unwrap();
        assert_ne!(
            key(1440, 900),
            resized,
            "the shared CSS's modification time"
        );

        fs::write(root.0.join("cart.html"), b"<p>cart, changed</p>").unwrap();
        assert_ne!(key(1440, 900), resized, "its own page");
        assert!(board_key(&root.0, "missing.html", 1440, 900).is_none());

        // The same page in another folder resolves its relative files from there.
        fs::create_dir_all(root.0.join("mobile")).unwrap();
        fs::write(root.0.join("mobile/cart.html"), b"<p>cart, changed</p>").unwrap();
        let moved = board_key(&root.0, "mobile/cart.html", 1440, 900).unwrap();
        assert_ne!(moved, key(1440, 900), "its path");
    }

    #[test]
    fn the_folder_digest_stops_at_the_same_entries_whatever_their_kind() {
        let root = Temp::new("canvas-digest-cut");
        // In name order: a.html, b.html, c.css. Pages count toward the limit, so with
        // room for two entries the stylesheet is past it.
        fs::write(root.0.join("c.css"), b"p{}").unwrap();
        fs::write(root.0.join("b.html"), b"<p>b</p>").unwrap();
        fs::write(root.0.join("a.html"), b"<p>a</p>").unwrap();
        let first = folder_digest_within(&root.0, 2);

        fs::write(root.0.join("c.css"), b"p{color:red}").unwrap();

        assert_eq!(folder_digest_within(&root.0, 2), first);
        assert_ne!(folder_digest_within(&root.0, 3), first);
    }

    #[test]
    fn hashes_a_file_and_none_for_a_missing_one() {
        let root = Temp::new("canvas-hash");
        fs::write(root.0.join("a.txt"), b"abc").unwrap();

        assert_eq!(
            file_sha256(&root.0.join("a.txt")).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(file_sha256(&root.0.join("nope")).is_none());
    }
}
