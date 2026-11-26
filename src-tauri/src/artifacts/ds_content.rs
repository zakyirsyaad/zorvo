//! What `ds_read` returns of a design system: its brand book's sections, its components,
//! assets and fonts, and the digest a preview URL carries.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 3.

use std::fs;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::canvas::{digest_where, MAX_DIGEST_ENTRIES};
use super::design_system::{
    parse_index, DsIndex, INDEX_FILE, MAX_DS_TITLE_CHARS, NOT_A_DESIGN_SYSTEM, NO_README, TOO_BIG,
    UNREADABLE_INDEX,
};
use super::ds_markdown::markdown_html;
use super::ds_tokens::{parse_tokens, DsTokens};
use super::protocol::encode_segment;
use super::source::{read_bytes_checked, read_checked};
use super::store::clean_title_within;

pub const MAX_SECTION_BYTES: usize = 256 * 1024;
pub const MAX_SECTIONS: usize = 24;
pub const MAX_COMPONENTS: usize = 400;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsComponent {
    pub name: String,
    pub group: Option<String>,
    pub height: Option<u32>,
    pub has_readme: bool,
    pub preview_hash: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsSection {
    pub file: String,
    pub title: String,
    pub html: String,
    pub hash: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsAsset {
    pub group: String,
    /// The file's path relative to the system's folder.
    pub file: String,
    pub kind: &'static str,
    pub size: Option<u64>,
    pub is_missing: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsContent {
    pub index: DsIndex,
    pub tokens: Option<DsTokens>,
    pub tokens_error: Option<String>,
    pub sections: Vec<DsSection>,
    pub components: Vec<DsComponent>,
    pub assets: Vec<DsAsset>,
    pub fonts: Vec<DsAsset>,
    pub digest: String,
}

const README: &str = "README.md";
const README_TITLE: &str = "Overview";
const TOKENS: &str = "tokens.json";
const PREVIEW: &str = "preview.html";
/// Folders whose notes are not brand-book sections (spec gap 1), and folders never searched.
const NOT_SECTION_FOLDERS: &[&str] = &["components", "assets", "fonts"];
const SKIPPED_FOLDERS: &[&str] = &["node_modules", "target", "dist"];
const MAX_SECTION_DEPTH: usize = 4;
const MAX_GROUP_CHARS: usize = 60;
const MAX_HEIGHT: u32 = 4000;
const HASH_HEX_CHARS: usize = 16;
const NO_THEME: &str = "default";

/// Reads a system's folder (already checked). A refusal is one of the fixed sentences of
/// `design_system.rs`, so it never repeats the folder's contents.
pub fn read_content(root: &Path) -> Result<DsContent, String> {
    let root = &fs::canonicalize(root).map_err(|_| NOT_A_DESIGN_SYSTEM)?;
    let index_bytes = read_checked(&root.join(INDEX_FILE)).map_err(|_| NOT_A_DESIGN_SYSTEM)?;
    let index = parse_index(&index_bytes).map_err(|_| UNREADABLE_INDEX)?;
    let readme = section_text(&root.join(README))?.ok_or(NO_README)?;
    let (tokens, tokens_error) = match read_bytes_checked(&root.join(TOKENS)) {
        Err(_) if !root.join(TOKENS).exists() => (None, None),
        Err(error) => (None, Some(format!("{TOKENS}: {error}"))),
        Ok(bytes) => match parse_tokens(&bytes) {
            Ok(tokens) => (Some(tokens), None),
            Err(error) => (None, Some(error)),
        },
    };
    let theme = tokens
        .as_ref()
        .and_then(|t| t.themes.first())
        .map_or(NO_THEME, |t| t.id.as_str())
        .to_string();
    let mut sections = vec![section(README, README_TITLE.to_string(), &readme, &theme)];
    sections.extend(other_sections(root, &theme));
    Ok(DsContent {
        assets: assets(root, &index, &index_bytes),
        fonts: fonts(root, tokens.as_ref()),
        components: components(root),
        digest: digest_where(root, MAX_DIGEST_ENTRIES, &is_digest_file),
        index,
        tokens,
        tokens_error,
        sections,
    })
}

/// A section's text: `None` when the file is not there, `TOO_BIG` over the limit.
fn section_text(path: &Path) -> Result<Option<String>, String> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Ok(None);
    };
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_SECTION_BYTES as u64 {
        return Err(TOO_BIG.to_string());
    }
    let bytes = read_checked(path).map_err(|_| NOT_A_DESIGN_SYSTEM)?;
    if bytes.len() > MAX_SECTION_BYTES {
        return Err(TOO_BIG.to_string());
    }
    Ok(String::from_utf8(bytes).ok())
}

fn short_hash(bytes: &[u8]) -> String {
    let hex: String = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    hex[..HASH_HEX_CHARS].to_string()
}

fn section(file: &str, title: String, text: &str, theme: &str) -> DsSection {
    let folder: Vec<String> = file
        .split('/')
        .rev()
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(encode_segment)
        .collect();
    let image_base = std::iter::once(format!("t/{theme}/f"))
        .chain(folder)
        .collect::<Vec<_>>()
        .join("/");
    DsSection {
        file: file.to_string(),
        title,
        html: markdown_html(text, &format!("{image_base}/")),
        hash: short_hash(text.as_bytes()),
    }
}

/// The first `# heading`, else the file's name without `.md`.
fn section_title(file: &str, text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("# "))
        .and_then(|heading| clean_title_within(heading, MAX_DS_TITLE_CHARS))
        .unwrap_or_else(|| {
            let name = file.rsplit('/').next().unwrap_or(file);
            name.strip_suffix(".md").unwrap_or(name).to_string()
        })
}

/// Every other `*.md` outside `components/`, `assets/` and `fonts/`, in path order: a file
/// over its limit or that is not text is left out, never the system.
fn other_sections(root: &Path, theme: &str) -> Vec<DsSection> {
    let mut files = Vec::new();
    collect_markdown(root, "", 0, &mut files);
    files.sort();
    files
        .into_iter()
        .filter_map(|file| {
            let text = section_text(&root.join(&file)).ok()??;
            Some(section(&file, section_title(&file, &text), &text, theme))
        })
        .take(MAX_SECTIONS)
        .collect()
}

fn collect_markdown(folder: &Path, prefix: &str, depth: usize, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries.into_iter().take(MAX_DIGEST_ENTRIES) {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let relative = format!("{prefix}{name}");
        if name.starts_with('.') {
            continue;
        }
        if kind.is_dir() {
            let skipped = SKIPPED_FOLDERS.contains(&name.as_str())
                || (depth == 0 && NOT_SECTION_FOLDERS.contains(&name.as_str()));
            if !skipped && depth + 1 < MAX_SECTION_DEPTH {
                collect_markdown(&entry.path(), &format!("{relative}/"), depth + 1, files);
            }
        } else if kind.is_file() && name.ends_with(".md") && relative != README {
            files.push(relative);
        }
    }
}

/// The digest preview URLs carry: `tokens.json`, `components/bundle.*` and `components/lib/*.js`.
fn is_digest_file(relative: &str) -> bool {
    match relative {
        TOKENS | "components/" | "components/lib/" => true,
        _ => {
            relative
                .strip_prefix("components/bundle.")
                .is_some_and(|rest| !rest.contains('/'))
                || relative
                    .strip_prefix("components/lib/")
                    .is_some_and(|rest| !rest.contains('/') && rest.ends_with(".js"))
        }
    }
}

/// A component's folder name: what a URL and a comment name it by.
fn is_component_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name != "lib"
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn components(root: &Path) -> Vec<DsComponent> {
    let Ok(entries) = fs::read_dir(root.join("components")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| is_component_name(name))
        .collect();
    names.sort();
    let mut found: Vec<DsComponent> = names
        .into_iter()
        .filter_map(|name| component(root, name))
        .take(MAX_COMPONENTS)
        .collect();
    let mut groups: Vec<String> = Vec::new();
    for group in found.iter().filter_map(|c| c.group.as_ref()) {
        if !groups.contains(group) {
            groups.push(group.clone());
        }
    }
    let rank = |c: &DsComponent| {
        c.group
            .as_ref()
            .and_then(|g| groups.iter().position(|seen| seen == g))
            .unwrap_or(groups.len())
    };
    found.sort_by_key(|c| (rank(c), c.name.clone()));
    found
}

fn component(root: &Path, name: String) -> Option<DsComponent> {
    let folder = root.join("components").join(&name);
    let has_readme = fs::symlink_metadata(folder.join(README)).is_ok_and(|m| m.is_file());
    let preview = read_checked(&folder.join(PREVIEW)).ok();
    if !has_readme && preview.is_none() {
        return None;
    }
    let (group, height) = preview
        .as_deref()
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .and_then(|text| text.lines().next())
        .map_or((None, None), ds_card);
    Some(DsComponent {
        name,
        group,
        height,
        has_readme,
        preview_hash: preview.as_deref().map(short_hash),
    })
}

/// Reads `<!-- @dsCard group="Actions" height=120 -->`; anything else is `(None, None)`.
pub fn ds_card(first_line: &str) -> (Option<String>, Option<u32>) {
    let inner = first_line
        .trim()
        .strip_prefix("<!--")
        .and_then(|rest| rest.strip_suffix("-->"))
        .map(str::trim)
        .and_then(|rest| rest.strip_prefix("@dsCard"));
    let Some(inner) = inner else {
        return (None, None);
    };
    let group = attribute(inner, "group")
        .filter(|g| !g.trim().is_empty())
        .and_then(|g| clean_title_within(g, MAX_GROUP_CHARS));
    let height = attribute(inner, "height")
        .and_then(|h| h.parse::<u32>().ok())
        .filter(|h| (1..=MAX_HEIGHT).contains(h));
    (group, height)
}

/// `name="value"` or `name=value` in a `@dsCard` line.
fn attribute<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let at = text.find(&format!("{name}="))?;
    let before = text[..at].chars().last();
    if before.is_some_and(|c| !c.is_whitespace()) {
        return None;
    }
    let rest = &text[at + name.len() + 1..];
    match rest.strip_prefix('"') {
        Some(quoted) => quoted.split_once('"').map(|(value, _)| value),
        None => rest.split_whitespace().next(),
    }
}

fn kind_of(file: &str) -> &'static str {
    let extension = file
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" => "image",
        "pdf" => "pdf",
        "mp4" | "mov" | "m4v" | "webm" => "video",
        _ => "other",
    }
}

/// A plain file name or relative path: no `..`, no `.`, no leading `/`, no `\`.
fn is_plain(relative: &str) -> bool {
    !relative.starts_with('/')
        && !relative.chars().any(|c| c.is_control() || c == '\\')
        && relative
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn asset(root: &Path, group: &str, file: String) -> DsAsset {
    let size = fs::canonicalize(root.join(&file))
        .ok()
        .filter(|path| path.starts_with(root))
        .and_then(|path| fs::metadata(path).ok())
        .filter(fs::Metadata::is_file)
        .map(|meta| meta.len());
    DsAsset {
        group: group.to_string(),
        kind: kind_of(&file),
        is_missing: size.is_none(),
        size,
        file,
    }
}

/// The files an index lists for a group: `assetGroups.<name>.order`, else its `files` keys.
fn listed_files(index_bytes: &[u8], group: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(index_bytes) else {
        return Vec::new();
    };
    let entry = &value["assetGroups"][group];
    let names: Vec<String> = match entry.get("order").and_then(|o| o.as_array()) {
        Some(order) => order
            .iter()
            .filter_map(|n| n.as_str().map(str::to_string))
            .collect(),
        None => entry
            .get("files")
            .and_then(|f| f.as_object())
            .map(|files| files.keys().cloned().collect())
            .unwrap_or_default(),
    };
    names.into_iter().filter(|name| is_plain(name)).collect()
}

/// Groups in the index's order, then the folders of `assets/` it does not name; in each, the
/// files the index lists (missing ones marked), then the folder's other files by name.
fn assets(root: &Path, index: &DsIndex, index_bytes: &[u8]) -> Vec<DsAsset> {
    let on_disk = |folder: &Path, want_dirs: bool| -> Vec<String> {
        let Ok(entries) = fs::read_dir(folder) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| {
                e.file_type()
                    .is_ok_and(|k| if want_dirs { k.is_dir() } else { k.is_file() })
            })
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter(|name| !name.starts_with('.') && is_plain(name))
            .collect();
        names.sort();
        names
    };
    let mut groups: Vec<String> = index
        .asset_group_order
        .iter()
        .filter(|g| is_plain(g) && !g.contains('/'))
        .cloned()
        .collect();
    for folder in on_disk(&root.join("assets"), true) {
        if !groups.contains(&folder) {
            groups.push(folder);
        }
    }
    groups
        .iter()
        .flat_map(|group| {
            let mut names = listed_files(index_bytes, group);
            for name in on_disk(&root.join("assets").join(group), false) {
                if !names.contains(&name) && !name.ends_with(".md") {
                    names.push(name);
                }
            }
            names
                .into_iter()
                .map(|name| asset(root, group, format!("assets/{group}/{name}")))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// A font file `tokens.json` names under `fonts/`, marked when it is not in the folder.
fn fonts(root: &Path, tokens: Option<&DsTokens>) -> Vec<DsAsset> {
    tokens
        .into_iter()
        .flat_map(|t| t.fonts.iter())
        .filter_map(|font| {
            let file = font.file.as_deref()?;
            (file.starts_with("fonts/") && is_plain(file))
                .then(|| asset(root, &font.family, file.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::super::test_support::Temp;
    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ds-two-themes")
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap().flatten() {
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_dir(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    fn copied(tag: &str) -> Temp {
        let temp = Temp::new(tag);
        copy_dir(&fixture(), &temp.0);
        temp
    }

    fn section_files(content: &DsContent) -> Vec<&str> {
        content.sections.iter().map(|s| s.file.as_str()).collect()
    }

    #[test]
    fn reads_the_fixture() {
        let content = read_content(&fixture()).expect("reads");
        assert_eq!(content.index.title, "Acme");
        let names: Vec<&str> = content.components.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Button", "Swatch"]);
        let button = &content.components[0];
        assert_eq!(button.group.as_deref(), Some("Actions"));
        assert_eq!(button.height, Some(120));
        assert!(button.has_readme);
        assert_eq!(button.preview_hash.as_ref().map(String::len), Some(16));
        assert!(!content.components[1].has_readme);
        assert_eq!(content.components[1].group, None);
        let assets: Vec<(&str, bool)> = content
            .assets
            .iter()
            .map(|a| (a.file.as_str(), a.is_missing))
            .collect();
        assert_eq!(
            assets,
            [
                ("assets/Logos/mark.svg", false),
                ("assets/Logos/gone.png", true)
            ]
        );
        assert_eq!(content.assets[0].kind, "image");
        assert!(content.assets[0].size.is_some());
        assert_eq!(content.assets[1].size, None);
        assert_eq!(content.fonts.len(), 1);
        assert_eq!(content.fonts[0].file, "fonts/Acme.woff2");
        assert!(!content.fonts[0].is_missing);
        assert_eq!(section_files(&content), ["README.md", "voice.md"]);
        assert_eq!(content.sections[0].title, "Overview");
        assert_eq!(content.sections[1].title, "Voice");
        assert!(content.sections[0]
            .html
            .contains(r#"src="t/dark/f/assets/Logos/mark.svg""#));
        assert_eq!(content.tokens.as_ref().map(|t| t.themes.len()), Some(2));
        assert_eq!(content.tokens_error, None);
    }

    #[test]
    fn ds_card_reads_group_and_height() {
        assert_eq!(
            ds_card(r#"<!-- @dsCard group="Actions" height=120 -->"#),
            (Some("Actions".into()), Some(120))
        );
        assert_eq!(
            ds_card(r#"<!-- @dsCard group="Forms" height="88" -->"#),
            (Some("Forms".into()), Some(88))
        );
        assert_eq!(ds_card(r#"<!-- @dsCard height=60 -->"#), (None, Some(60)));
        for other in [
            "<!doctype html>",
            "<!-- a comment -->",
            r#"@dsCard group="A""#,
            "",
        ] {
            assert_eq!(ds_card(other), (None, None), "{other}");
        }
    }

    #[test]
    fn components_group_in_first_seen_order_and_no_group_last() {
        let temp = copied("ds-groups");
        let comps = temp.0.join("components");
        for (name, card) in [
            ("Alpha", ""),
            ("Card", r#"<!-- @dsCard group="Layout" -->"#),
            ("Chip", r#"<!-- @dsCard group="Actions" -->"#),
        ] {
            fs::create_dir_all(comps.join(name)).unwrap();
            fs::write(
                comps.join(name).join("preview.html"),
                format!("{card}\n<p>x</p>"),
            )
            .unwrap();
        }
        let content = read_content(&temp.0).unwrap();
        let names: Vec<&str> = content.components.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Button", "Chip", "Card", "Alpha", "Swatch"]);
    }

    #[test]
    fn assets_and_fonts_notes_are_not_sections() {
        let temp = copied("ds-notes");
        fs::write(temp.0.join("assets/Logos/README.md"), "# Logos").unwrap();
        fs::write(temp.0.join("fonts/LICENSE.md"), "# Licence").unwrap();
        fs::write(temp.0.join("components/Button/notes.md"), "# Notes").unwrap();
        fs::create_dir_all(temp.0.join("docs")).unwrap();
        fs::write(temp.0.join("docs/motion.md"), "# Motion").unwrap();
        let content = read_content(&temp.0).unwrap();
        assert_eq!(
            section_files(&content),
            ["README.md", "docs/motion.md", "voice.md"]
        );
        assert!(content.sections[1].html.contains("Motion"));
    }

    #[test]
    fn a_section_image_is_relative_to_its_own_folder() {
        let temp = copied("ds-section-image");
        fs::create_dir_all(temp.0.join("docs")).unwrap();
        fs::write(temp.0.join("docs/brand.md"), "![x](pic.png)").unwrap();
        let content = read_content(&temp.0).unwrap();
        let brand = content
            .sections
            .iter()
            .find(|s| s.file == "docs/brand.md")
            .unwrap();
        assert!(
            brand.html.contains(r#"src="t/dark/f/docs/pic.png""#),
            "{}",
            brand.html
        );
        assert_eq!(brand.title, "brand");
    }

    #[test]
    fn the_digest_changes_with_tokens_bundle_and_lib_only() {
        let temp = copied("ds-digest");
        let first = read_content(&temp.0).unwrap().digest;
        fs::write(temp.0.join("README.md"), "# Changed").unwrap();
        fs::write(temp.0.join("components/Button/preview.html"), "<p>new</p>").unwrap();
        assert_eq!(read_content(&temp.0).unwrap().digest, first);
        fs::create_dir_all(temp.0.join("components/lib")).unwrap();
        fs::write(temp.0.join("components/lib/x.js"), "1").unwrap();
        let with_lib = read_content(&temp.0).unwrap().digest;
        assert_ne!(with_lib, first);
        fs::write(temp.0.join("components/bundle.css"), ".a{}").unwrap();
        let with_bundle = read_content(&temp.0).unwrap().digest;
        assert_ne!(with_bundle, with_lib);
        fs::write(temp.0.join("tokens.json"), "{}").unwrap();
        assert_ne!(read_content(&temp.0).unwrap().digest, with_bundle);
    }

    #[test]
    fn a_readme_over_256_kib_is_refused_with_too_big() {
        let temp = copied("ds-big-readme");
        fs::write(temp.0.join("README.md"), "a".repeat(MAX_SECTION_BYTES + 1)).unwrap();
        assert_eq!(read_content(&temp.0).unwrap_err(), TOO_BIG);
    }

    #[test]
    fn no_readme_is_refused() {
        let temp = copied("ds-no-readme");
        fs::remove_file(temp.0.join("README.md")).unwrap();
        assert_eq!(read_content(&temp.0).unwrap_err(), NO_README);
    }

    #[test]
    fn a_25th_section_is_left_out() {
        let temp = copied("ds-many-sections");
        fs::remove_file(temp.0.join("voice.md")).unwrap();
        for n in 0..25 {
            fs::write(temp.0.join(format!("s{n:02}.md")), "# S").unwrap();
        }
        let content = read_content(&temp.0).unwrap();
        assert_eq!(content.sections.len(), 1 + MAX_SECTIONS);
        assert_eq!(content.sections.last().unwrap().file, "s23.md");
    }

    #[test]
    fn a_bad_tokens_file_is_an_error_not_a_refusal() {
        let temp = copied("ds-bad-tokens");
        fs::write(temp.0.join("tokens.json"), "not json").unwrap();
        let content = read_content(&temp.0).unwrap();
        assert_eq!(content.tokens, None);
        assert_eq!(
            content.tokens_error.as_deref(),
            Some("tokens.json: not valid JSON")
        );
    }

    #[test]
    fn reads_zorvos_own_docs_design_system() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/design-system");
        let content = read_content(&root).expect("Zorvo's own system reads");
        assert_eq!(content.components.len(), 21);
        assert!(!section_files(&content).contains(&"assets/Logos/README.md"));
        let logos: Vec<&DsAsset> = content
            .assets
            .iter()
            .filter(|a| a.group == "Logos")
            .collect();
        assert_eq!(logos.len(), 5);
        assert!(logos.iter().all(|a| !a.is_missing));
    }
}
