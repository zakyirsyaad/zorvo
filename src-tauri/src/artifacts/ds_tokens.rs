//! A design system's `tokens.json`, read leniently: a value Zorvo cannot read drops that
//! token with a reason, never the system.
//! Design: `docs/superpowers/specs/2026-11-26-design-system-design.md`, section 1.

use serde::Serialize;

pub const MAX_TOKENS_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsTheme {
    pub id: String,
    pub name: String,
}

/// A token after aliases are resolved: one value per theme id, in `themes` order.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsToken {
    pub family: String,
    pub name: String,
    pub values: Vec<String>,
    pub usage: Option<String>,
    pub hash: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsFont {
    pub family: String,
    pub file: Option<String>,
    pub weight: Option<u16>,
    pub style: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsTypeStyle {
    pub group: String,
    pub name: String,
    pub font_size: String,
    pub line_height: String,
    pub font_weight: u16,
    pub letter_spacing: Option<String>,
    pub family: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsDropped {
    pub family: String,
    pub name: String,
    pub reason: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DsSource {
    Code {
        paths: Vec<String>,
        commit: Option<String>,
    },
    References {
        files: Vec<String>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsTokens {
    pub themes: Vec<DsTheme>,
    pub tokens: Vec<DsToken>,
    pub fonts: Vec<DsFont>,
    pub families: Vec<(String, String)>,
    pub styles: Vec<DsTypeStyle>,
    pub dropped: Vec<DsDropped>,
    pub source: Option<DsSource>,
}

type Fields = serde_json::Map<String, serde_json::Value>;
type Reason = &'static str;

const NAMED_COLOUR: Reason = "named colour";
const VAR: Reason = "var()";
const COLOR_MIX: Reason = "color-mix()";
const MISSING_ALIAS: Reason = "missing alias";
const ALIAS_OF_ITSELF: Reason = "alias of itself";
const DUPLICATE_NAME: Reason = "duplicate name";
const BAD_LENGTH: Reason = "bad length";
const NO_VALUE: Reason = "no value";
const NOT_A_LIST: Reason = "not a list";

/// Top-level keys that are not token families.
const NOT_FAMILIES: &[&str] = &["name", "version", "meta", "type"];
const MAX_NAME_CHARS: usize = 64;
const MAX_THEME_ID_CHARS: usize = 32;
const MAX_THEME_NAME_CHARS: usize = 60;
const HASH_HEX_CHARS: usize = 16;

/// Reads `tokens.json`. Only the file as a whole can be refused (size, UTF-8, JSON, not an
/// object); every token that cannot be read is dropped with its reason.
pub fn parse_tokens(bytes: &[u8]) -> Result<DsTokens, String> {
    if bytes.len() > MAX_TOKENS_BYTES {
        return Err("tokens.json: over 1 MB".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "tokens.json: not valid UTF-8")?;
    let value: serde_json::Value =
        serde_json::from_str(source).map_err(|_| "tokens.json: not valid JSON")?;
    let root = value
        .as_object()
        .ok_or("tokens.json: must be a JSON object")?;
    let themes = themes(root);
    let theme_ids: Vec<&str> = themes.iter().map(|theme| theme.id.as_str()).collect();
    let mut seen = Vec::new();
    let mut tokens = Vec::new();
    let mut dropped = Vec::new();
    for (family, value) in root
        .iter()
        .filter(|(key, _)| !NOT_FAMILIES.contains(&key.as_str()))
    {
        let Some(list) = value.get("tokens").and_then(serde_json::Value::as_array) else {
            dropped.push(drop(family, "", NOT_A_LIST));
            continue;
        };
        read_family(
            family,
            list,
            &theme_ids,
            &mut seen,
            &mut tokens,
            &mut dropped,
        );
    }
    let kind = root.get("type").and_then(serde_json::Value::as_object);
    Ok(DsTokens {
        themes,
        tokens,
        fonts: kind.map(fonts).unwrap_or_default(),
        families: kind.map(font_families).unwrap_or_default(),
        styles: kind.map(styles).unwrap_or_default(),
        dropped,
        source: root
            .get("meta")
            .and_then(serde_json::Value::as_object)
            .and_then(source_of),
    })
}

pub fn is_theme_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_THEME_ID_CHARS
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A token name: `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`.
fn is_token_name(text: &str) -> bool {
    text.len() <= MAX_NAME_CHARS
        && text
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn drop(family: &str, name: &str, reason: Reason) -> DsDropped {
    DsDropped {
        family: family.to_string(),
        name: name.to_string(),
        reason,
    }
}

/// `color.themes`, without the entries whose id is not usable; `default` when none is.
fn themes(root: &Fields) -> Vec<DsTheme> {
    let listed = root
        .get("color")
        .and_then(|color| color.get("themes"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|theme| {
            let id = theme.get("id")?.as_str().filter(|id| is_theme_id(id))?;
            let name = theme
                .get("name")
                .and_then(serde_json::Value::as_str)
                .and_then(|name| super::store::clean_title_within(name, MAX_THEME_NAME_CHARS))
                .unwrap_or_else(|| id.to_string());
            Some(DsTheme {
                id: id.to_string(),
                name,
            })
        });
    let themes = listed.fold(Vec::new(), |mut kept: Vec<DsTheme>, theme| {
        if !kept.iter().any(|seen| seen.id == theme.id) {
            kept.push(theme);
        }
        kept
    });
    if themes.is_empty() {
        vec![DsTheme {
            id: "default".into(),
            name: "Default".into(),
        }]
    } else {
        themes
    }
}

/// A token before its aliases are resolved: one raw value per theme.
struct Raw<'a> {
    name: &'a str,
    values: Vec<String>,
    usage: Option<String>,
}

/// One family's list: names are claimed in `seen` on first sight, then values are resolved
/// and checked. Drops keep the order of the list.
fn read_family(
    family: &str,
    list: &[serde_json::Value],
    theme_ids: &[&str],
    seen: &mut Vec<String>,
    tokens: &mut Vec<DsToken>,
    dropped: &mut Vec<DsDropped>,
) {
    let mut slots: Vec<Result<Raw, (&str, Reason)>> = Vec::new();
    for item in list {
        let Some(name) = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .filter(|name| is_token_name(name))
        else {
            continue;
        };
        if seen.iter().any(|taken| taken == name) {
            slots.push(Err((name, DUPLICATE_NAME)));
            continue;
        }
        seen.push(name.to_string());
        slots.push(match raw_values(item.get("value"), theme_ids) {
            Some(values) => Ok(Raw {
                name,
                values,
                usage: item
                    .get("usage")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            }),
            None => Err((name, NO_VALUE)),
        });
    }
    let known: Vec<&Raw> = slots.iter().filter_map(|slot| slot.as_ref().ok()).collect();
    for slot in &slots {
        match slot {
            Err((name, reason)) => dropped.push(drop(family, name, reason)),
            Ok(raw) => match resolved(raw, &known, family) {
                Ok(values) => tokens.push(DsToken {
                    family: family.to_string(),
                    name: raw.name.to_string(),
                    hash: token_hash(raw.name, &values),
                    values,
                    usage: raw.usage.clone(),
                }),
                Err(reason) => dropped.push(drop(family, raw.name, reason)),
            },
        }
    }
}

/// One value per theme: a string for every theme, or an object by theme id where a missing
/// theme inherits the first. `None` when the first theme has no value.
fn raw_values(value: Option<&serde_json::Value>, theme_ids: &[&str]) -> Option<Vec<String>> {
    fn text(value: &serde_json::Value) -> Option<String> {
        let text = match value {
            serde_json::Value::String(text) => text.trim().to_string(),
            serde_json::Value::Number(number) => number.to_string(),
            _ => return None,
        };
        (!text.is_empty()).then_some(text)
    }
    let value = value?;
    if let Some(one) = text(value) {
        return Some(vec![one; theme_ids.len()]);
    }
    let by_theme = value.as_object()?;
    let first = text(by_theme.get(*theme_ids.first()?)?)?;
    Some(
        theme_ids
            .iter()
            .map(|id| {
                by_theme
                    .get(*id)
                    .and_then(text)
                    .unwrap_or_else(|| first.clone())
            })
            .collect(),
    )
}

fn token_hash(name: &str, values: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let text = format!("{name}\0{}", values.join("\0"));
    let digest = Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    hex[..HASH_HEX_CHARS].to_string()
}

/// The token's values with aliases followed within its family, each checked for the family.
fn resolved(raw: &Raw, known: &[&Raw], family: &str) -> Result<Vec<String>, Reason> {
    (0..raw.values.len())
        .map(|theme| {
            let value = follow(raw, known, theme)?;
            check_value(family, &value)?;
            Ok(value)
        })
        .collect()
}

fn alias_of(value: &str) -> Option<&str> {
    value
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
        .filter(|name| !name.is_empty())
}

fn follow(raw: &Raw, known: &[&Raw], theme: usize) -> Result<String, Reason> {
    let mut visited = vec![raw.name];
    let mut value = raw.values[theme].as_str();
    while let Some(target) = alias_of(value) {
        if visited.contains(&target) {
            return Err(ALIAS_OF_ITSELF);
        }
        let next = known
            .iter()
            .find(|other| other.name == target)
            .ok_or(MISSING_ALIAS)?;
        visited.push(next.name);
        value = next.values[theme].as_str();
    }
    Ok(value.to_string())
}

fn check_value(family: &str, value: &str) -> Result<(), Reason> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("var(") {
        return Err(VAR);
    }
    if lower.contains("color-mix(") {
        return Err(COLOR_MIX);
    }
    match family {
        "color" => check_colour(value),
        "spacing" | "radius" | "size" => is_length(value).then_some(()).ok_or(BAD_LENGTH),
        "shadow" => check_shadow(value),
        "motion" => is_motion(value).then_some(()).ok_or(BAD_LENGTH),
        _ => is_plain_text(&lower).then_some(()).ok_or(BAD_LENGTH),
    }
}

/// `-?(\d+|\d*\.\d+)` followed by one of `units`, or by nothing when `bare` is true.
fn is_number_with(value: &str, units: &[&str], bare: bool) -> bool {
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let digits_end = unsigned
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(unsigned.len());
    let (number, unit) = unsigned.split_at(digits_end);
    let number_ok = match number.split_once('.') {
        None => !number.is_empty(),
        Some((whole, fraction)) => {
            !fraction.is_empty()
                && !fraction.contains('.')
                && whole.chars().all(|c| c.is_ascii_digit())
        }
    };
    number_ok && ((unit.is_empty() && bare) || units.contains(&unit))
}

fn is_length(value: &str) -> bool {
    is_number_with(value, &["px", "rem", "em", "%"], true)
}

const COLOUR_FUNCTIONS: &[&str] = &["rgb", "rgba", "hsl", "hsla", "oklch", "oklab", "lab", "lch"];

fn check_colour(value: &str) -> Result<(), Reason> {
    if let Some(hex) = value.strip_prefix('#') {
        let ok = matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
        return ok.then_some(()).ok_or(NAMED_COLOUR);
    }
    let Some((name, rest)) = value.split_once('(') else {
        return Err(NAMED_COLOUR);
    };
    let Some(args) = rest.strip_suffix(')') else {
        return Err(NAMED_COLOUR);
    };
    let plain = args.replace("deg", "").replace("none", "");
    let ok = COLOUR_FUNCTIONS.contains(&name)
        && !args.trim().is_empty()
        && plain
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | '%' | '-' | '+' | ',' | '/' | ' '));
    ok.then_some(()).ok_or(NAMED_COLOUR)
}

/// Splits `text` on `separator` where it is outside every parenthesis.
fn split_outside_parens(text: &str, separator: impl Fn(char) -> bool) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (at, c) in text.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ if depth == 0 && separator(c) => {
                parts.push(&text[start..at]);
                start = at + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
}

fn check_shadow(value: &str) -> Result<(), Reason> {
    for layer in split_outside_parens(value, |c| c == ',') {
        let words: Vec<&str> = split_outside_parens(layer, char::is_whitespace)
            .into_iter()
            .filter(|word| !word.is_empty())
            .collect();
        if words.is_empty() {
            return Err(BAD_LENGTH);
        }
        for word in words {
            if word == "inset" || is_length(word) {
                continue;
            }
            if word.starts_with(|c: char| c.is_ascii_digit() || matches!(c, '.' | '-')) {
                return Err(BAD_LENGTH);
            }
            check_colour(word)?;
        }
    }
    Ok(())
}

const EASINGS: &[&str] = &["linear", "ease", "ease-in", "ease-out", "ease-in-out"];

fn is_motion(value: &str) -> bool {
    if EASINGS.contains(&value) || is_number_with(value, &["ms", "s"], false) {
        return true;
    }
    let Some(args) = value
        .strip_prefix("cubic-bezier(")
        .and_then(|rest| rest.strip_suffix(')'))
    else {
        return false;
    };
    let numbers: Vec<&str> = args.split(',').map(str::trim).collect();
    numbers.len() == 4 && numbers.iter().all(|n| is_number_with(n, &[], true))
}

/// Text for a family Zorvo knows nothing of: it lands in a stylesheet, so nothing that could
/// end a declaration, open a rule or load a URL.
fn is_plain_text(lower: &str) -> bool {
    !lower
        .chars()
        .any(|c| c.is_control() || matches!(c, ';' | '{' | '}' | '<' | '\\'))
        && !["url(", "var(", "expression("]
            .iter()
            .any(|bad| lower.contains(bad))
}

fn number_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn weight_of(value: Option<&serde_json::Value>) -> Option<u16> {
    let weight = match value? {
        serde_json::Value::Number(number) => number.as_u64()?,
        serde_json::Value::String(text) => text.trim().parse().ok()?,
        _ => return None,
    };
    (100..=900).contains(&weight).then_some(weight as u16)
}

fn string_of(fields: &serde_json::Value, name: &str) -> Option<String> {
    fields
        .get(name)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn fonts(kind: &Fields) -> Vec<DsFont> {
    kind.get("fonts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|font| {
            Some(DsFont {
                family: string_of(font, "family")?,
                file: string_of(font, "file"),
                weight: weight_of(font.get("weight")),
                style: string_of(font, "style"),
            })
        })
        .collect()
}

fn font_families(kind: &Fields) -> Vec<(String, String)> {
    kind.get("families")
        .and_then(serde_json::Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(name, _)| is_token_name(name))
        .filter_map(|(name, stack)| Some((name.clone(), stack.as_str()?.to_string())))
        .collect()
}

fn styles(kind: &Fields) -> Vec<DsTypeStyle> {
    let groups = kind
        .get("groups")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten();
    groups
        .flat_map(|group| {
            let group_name = string_of(group, "name").unwrap_or_default();
            let group_family = string_of(group, "family");
            group
                .get("styles")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(move |style| {
                    Some(DsTypeStyle {
                        group: group_name.clone(),
                        name: string_of(style, "name")?,
                        font_size: number_text(style.get("fontSize")?)?,
                        line_height: number_text(style.get("lineHeight")?)?,
                        font_weight: weight_of(style.get("fontWeight"))?,
                        letter_spacing: style.get("letterSpacing").and_then(number_text),
                        family: string_of(style, "family").or_else(|| group_family.clone()),
                    })
                })
        })
        .collect()
}

fn strings(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect()
}

/// `meta.source`: Zorvo's `{kind, ...}` object, or the older shape of a string beside
/// `meta.ref` (`branch@commit`) and `meta.paths` (lists by name), read as code.
fn source_of(meta: &Fields) -> Option<DsSource> {
    match meta.get("source")? {
        serde_json::Value::Object(source) => {
            match source.get("kind").and_then(serde_json::Value::as_str)? {
                "code" => Some(DsSource::Code {
                    paths: strings(source.get("paths")),
                    commit: source
                        .get("commit")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                }),
                "references" => Some(DsSource::References {
                    files: strings(source.get("files")),
                }),
                _ => None,
            }
        }
        serde_json::Value::String(_) => Some(DsSource::Code {
            paths: meta
                .get("paths")
                .and_then(serde_json::Value::as_object)
                .into_iter()
                .flat_map(|paths| paths.values())
                .flat_map(|list| strings(Some(list)))
                .collect(),
            commit: meta
                .get("ref")
                .and_then(serde_json::Value::as_str)
                .and_then(|reference| reference.split_once('@'))
                .map(|(_, commit)| commit.to_string())
                .filter(|commit| !commit.is_empty()),
        }),
        _ => None,
    }
}

#[cfg(test)]
#[path = "ds_tokens_tests.rs"]
mod tests;
