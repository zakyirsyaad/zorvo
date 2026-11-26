//! A design system in the shared child webview: which system is shown, what its view may load,
//! the shell state kept across views of it, and the component list messages are checked
//! against (Part 4). The webview itself lives in `view.rs`; this module holds the rules.

use serde_json::Value;
use std::cell::RefCell;
use std::time::Instant;

use super::ds_content::is_component_name;
use super::ds_protocol::{ds_shell_url, is_allowed_ds_navigation, parse_ds_url, DsUrl};
use super::ds_tokens::is_token_name;
use super::picks::{
    is_accepted, parse_page_message, PageMark, PageMessage, RateLimit, ViewState,
    MAX_CONTEXT_CHARS, MAX_QUOTE_CHARS,
};

/// Emitted with `{sessionId, key, kind: "preview-loaded", component}` when a live preview loads.
pub const DS_VIEW: &str = "ds-view";
/// Emitted with `{sessionId, key, target, message?}` for a comment pick on the system on screen.
pub const DS_PICK: &str = "ds-pick";
/// The shell's own messages a second, as the canvas wrapper's.
const MAX_SHELL_PER_SECOND: u32 = 20;
const MAX_SECTION_FILE_CHARS: usize = 256;

/// The most `ds_view_apply` takes, as the canvas's apply does.
pub const MAX_STATE_BYTES: usize = 1024 * 1024;

/// Which design system the view shows.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownDesignSystem {
    pub session_id: String,
    pub key: String,
}

thread_local! {
    /// The last state asked for, with its system, as the script that applies it. Kept across views
    /// of the same system, and run again once such a view has loaded.
    static STATE: RefCell<Option<(ShownDesignSystem, String)>> = const { RefCell::new(None) };
    /// The components of the shown system as `ds_view_apply` last read them, so a message from a
    /// preview frame can be checked against what the system holds.
    static COMPONENTS: RefCell<Option<(ShownDesignSystem, Vec<String>)>> = const { RefCell::new(None) };
}

/// The shell's `apply` call for a state: `None` when it is not a JSON object or is over
/// `MAX_STATE_BYTES`. The text run is the object written out again, never what was sent.
pub fn ds_apply_script(state_json: &str) -> Option<String> {
    if state_json.len() > MAX_STATE_BYTES {
        return None;
    }
    let state @ Value::Object(_) = serde_json::from_str::<Value>(state_json).ok()? else {
        return None;
    };
    let literal = serde_json::to_string(&state).ok()?;
    Some(format!("window.__zorvoDs.apply({literal});"))
}

/// Keeps `script` for `shown`; the caller runs it when that system is on screen and loaded.
pub fn keep_state(shown: ShownDesignSystem, script: String) {
    STATE.with(|state| *state.borrow_mut() = Some((shown, script)));
}

/// The kept state's script, when it is for `shown`.
pub fn kept_state(shown: &ShownDesignSystem) -> Option<String> {
    STATE.with(|state| {
        state
            .borrow()
            .as_ref()
            .filter(|(of, _)| of == shown)
            .map(|(_, script)| script.clone())
    })
}

/// Records the components `ds_view_apply` read for `shown`.
pub fn record_components(shown: &ShownDesignSystem, names: Vec<String>) {
    COMPONENTS.with(|components| *components.borrow_mut() = Some((shown.clone(), names)));
}

/// Whether `shown` has a component called `name`, as last recorded.
pub fn has_component(shown: &ShownDesignSystem, name: &str) -> bool {
    COMPONENTS.with(|components| {
        components
            .borrow()
            .as_ref()
            .is_some_and(|(of, names)| of == shown && names.iter().any(|item| item == name))
    })
}

/// The view's navigation rule: the shell once (its own load), the shell again only for a
/// `#fragment` of it (the index's and the README's links are same-document navigations that
/// reach this handler), and this system's files. A preview frame that went to the shell's URL
/// would post messages as the shell, so a second full load is refused.
#[derive(Debug, Default)]
pub struct DsNavigation {
    has_shell: bool,
}

impl DsNavigation {
    pub fn allows(&mut self, url: &str, shown: &ShownDesignSystem) -> bool {
        if !is_allowed_ds_navigation(url, &shown.session_id, &shown.key) {
            return false;
        }
        if !matches!(parse_ds_url(url), Some(DsUrl::Shell { .. })) {
            return true;
        }
        let (without_fragment, fragment) = match url.split_once('#') {
            Some((before, after)) => (before, Some(after)),
            None => (url, None),
        };
        if without_fragment.contains('?') {
            return false;
        }
        if fragment.is_some() {
            return self.has_shell;
        }
        let is_first = !self.has_shell;
        self.has_shell = true;
        is_first
    }
}

/// What the shell itself says. Wire form: `{"kind":"ds-preview-loaded","component":"Button"}`,
/// `{"kind":"ds-pick-token","name":"accent"}`, `{"kind":"ds-pick-component","name":"Button"}`,
/// `{"kind":"ds-pick-section","file":"README.md","quote":"...","before":"...","after":"..."}`.
#[derive(Clone, Debug, PartialEq)]
pub enum DsShellMessage {
    PreviewLoaded(String),
    PickToken(String),
    PickComponent(String),
    PickSection {
        file: String,
        quote: String,
        before: String,
        after: String,
    },
}

impl DsShellMessage {
    /// A pick is followed by the user writing the comment, so the keyboard must leave the view.
    pub fn takes_keyboard(&self) -> bool {
        !matches!(self, Self::PreviewLoaded(_))
    }
}

fn is_section_file(file: &str) -> bool {
    file.chars().count() <= MAX_SECTION_FILE_CHARS
        && file.ends_with(".md")
        && !file.starts_with('/')
        && !file.contains('\\')
        && !file.chars().any(char::is_control)
        && !file.split('/').any(|part| part.is_empty() || part == "..")
}

fn text_field(fields: &serde_json::Map<String, Value>, name: &str, limit: usize) -> Option<String> {
    let text = fields.get(name)?.as_str()?;
    (text.chars().count() <= limit).then(|| text.to_string())
}

pub fn parse_ds_shell_message(body: &str) -> Option<DsShellMessage> {
    let Value::Object(fields) = serde_json::from_str::<Value>(body).ok()? else {
        return None;
    };
    let name = || {
        fields
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    match (fields.get("kind")?.as_str()?, fields.len()) {
        ("ds-preview-loaded", 2) => {
            let component = fields.get("component")?.as_str()?;
            is_component_name(component).then(|| DsShellMessage::PreviewLoaded(component.into()))
        }
        ("ds-pick-token", 2) => name()
            .filter(|name| is_token_name(name))
            .map(DsShellMessage::PickToken),
        ("ds-pick-component", 2) => name()
            .filter(|name| is_component_name(name))
            .map(DsShellMessage::PickComponent),
        ("ds-pick-section", 5) => {
            let file = fields.get("file")?.as_str()?;
            let quote = text_field(&fields, "quote", MAX_QUOTE_CHARS)?;
            (is_section_file(file) && !quote.trim().is_empty()).then_some(())?;
            Some(DsShellMessage::PickSection {
                file: file.into(),
                quote,
                before: text_field(&fields, "before", MAX_CONTEXT_CHARS)?,
                after: text_field(&fields, "after", MAX_CONTEXT_CHARS)?,
            })
        }
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum DsIntake {
    Shell(DsShellMessage),
    Preview {
        component: String,
        message: PageMessage,
    },
    Refused,
}

/// The component a preview frame's URL names, when it is one of the shown system's previews.
fn preview_component(frame_url: &str, shown: &ShownDesignSystem) -> Option<String> {
    let Some(DsUrl::File {
        session_id,
        key,
        relative,
        ..
    }) = parse_ds_url(frame_url)
    else {
        return None;
    };
    if session_id != shown.session_id || key != shown.key {
        return None;
    }
    let parts: Vec<&str> = relative.split('/').collect();
    match parts.as_slice() {
        ["components", name, file] if file.eq_ignore_ascii_case("preview.html") => {
            Some((*name).to_string())
        }
        _ => None,
    }
}

/// Reads one message of the design system view, matched to its frame by the URL wry gives:
/// the shell's own kinds only from the shell's exact URL (a pick only in comment mode), a page's
/// kinds only from a preview of a component the system holds. Everything else is refused.
#[allow(clippy::too_many_arguments)]
pub fn ds_intake(
    frame_url: &str,
    raw: &str,
    shown: &ShownDesignSystem,
    components: Option<&[String]>,
    state: ViewState,
    rate: &mut RateLimit,
    shell_rate: &mut RateLimit,
    now: Instant,
) -> DsIntake {
    if frame_url == ds_shell_url(&shown.session_id, &shown.key) {
        return parse_ds_shell_message(raw)
            .filter(|message| !message.takes_keyboard() || state.is_commenting)
            .filter(|_| shell_rate.allow_up_to(now, MAX_SHELL_PER_SECOND))
            .map_or(DsIntake::Refused, DsIntake::Shell);
    }
    let Some(component) = preview_component(frame_url, shown) else {
        return DsIntake::Refused;
    };
    if !components.is_some_and(|names| names.contains(&component)) {
        return DsIntake::Refused;
    }
    match parse_page_message(raw)
        .filter(|message| is_accepted(message, state))
        .filter(|_| rate.allow(now))
    {
        Some(message) => DsIntake::Preview { component, message },
        None => DsIntake::Refused,
    }
}

/// The components recorded for `shown`, for `ds_intake`.
pub fn recorded_components(shown: &ShownDesignSystem) -> Option<Vec<String>> {
    COMPONENTS.with(|components| {
        components
            .borrow()
            .as_ref()
            .filter(|(of, _)| of == shown)
            .map(|(_, names)| names.clone())
    })
}

pub fn ds_mode_script(on: bool) -> String {
    format!("window.__zorvoDs.mode({on});")
}

/// The shell's call that posts `marks` to one preview frame; `None` for a name that is not a
/// component's.
pub fn ds_marks_script(component: &str, marks: &[PageMark]) -> Option<String> {
    if !is_component_name(component) {
        return None;
    }
    let name = serde_json::to_string(component).ok()?;
    let marks = serde_json::to_string(marks).ok()?;
    Some(format!("window.__zorvoDs.marks({name}, {marks});"))
}

/// What the frontend hears of a pick.
pub fn ds_pick_event(shown: &ShownDesignSystem, intake: &DsIntake) -> Option<Value> {
    let (target, message) = match intake {
        DsIntake::Shell(DsShellMessage::PickToken(name)) => {
            (serde_json::json!({"kind": "token", "name": name}), None)
        }
        DsIntake::Shell(DsShellMessage::PickComponent(name)) => {
            (serde_json::json!({"kind": "component", "name": name}), None)
        }
        DsIntake::Shell(DsShellMessage::PickSection {
            file,
            quote,
            before,
            after,
        }) => (
            serde_json::json!({"kind": "section", "file": file}),
            Some(
                serde_json::json!({"kind": "pick-text", "quote": quote, "before": before, "after": after}),
            ),
        ),
        DsIntake::Preview { component, message } => (
            serde_json::json!({"kind": "component", "name": component}),
            serde_json::to_value(message).ok(),
        ),
        DsIntake::Shell(DsShellMessage::PreviewLoaded(_)) | DsIntake::Refused => return None,
    };
    let mut event = serde_json::json!({
        "sessionId": shown.session_id,
        "key": shown.key,
        "target": target,
    });
    if let Some(message) = message {
        event["message"] = message;
    }
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::ds_protocol::{ds_file_url, ds_shell_url};

    const SESSION: &str = "session-1794800000000-k3x9a";
    const KEY: &str = "d-0123456789abcdef";

    fn shown() -> ShownDesignSystem {
        ShownDesignSystem {
            session_id: SESSION.into(),
            key: KEY.into(),
        }
    }

    #[test]
    fn navigation_allows_the_shell_once_then_files() {
        let mut navigation = DsNavigation::default();
        let shell = ds_shell_url(SESSION, KEY);
        let file = ds_file_url(SESSION, KEY, "dark", "components/Button/preview.html");
        assert!(navigation.allows(&shell, &shown()));
        assert!(navigation.allows(&file, &shown()));
        assert!(!navigation.allows(&shell, &shown()));
    }

    #[test]
    fn navigation_allows_a_fragment_on_the_shell() {
        let mut navigation = DsNavigation::default();
        let shell = ds_shell_url(SESSION, KEY);
        assert!(!navigation.allows(&format!("{shell}#colours"), &shown()));
        assert!(navigation.allows(&shell, &shown()));
        assert!(navigation.allows(&format!("{shell}#colours"), &shown()));
        assert!(navigation.allows(&format!("{shell}#ds-u-usage"), &shown()));
        assert!(!navigation.allows(&format!("{shell}?x=1"), &shown()));
        assert!(!navigation.allows(&ds_shell_url(SESSION, "d-ffffffffffffffff"), &shown()));
        assert!(!navigation.allows(
            &ds_file_url(SESSION, "d-ffffffffffffffff", "dark", "README.md"),
            &shown()
        ));
        assert!(!navigation.allows("https://example.com/", &shown()));
    }

    #[test]
    fn apply_script_refuses_over_1_mib_and_non_objects() {
        assert_eq!(
            ds_apply_script(r#"{"title":"A"}"#).as_deref(),
            Some(r#"window.__zorvoDs.apply({"title":"A"});"#)
        );
        assert_eq!(ds_apply_script("[1]"), None);
        assert_eq!(ds_apply_script("not json"), None);
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_STATE_BYTES));
        assert_eq!(ds_apply_script(&big), None);
    }

    #[test]
    fn apply_records_the_components_it_read() {
        record_components(&shown(), vec!["Button".into()]);
        assert!(has_component(&shown(), "Button"));
        assert!(!has_component(&shown(), "Card"));
        let other = ShownDesignSystem {
            session_id: SESSION.into(),
            key: "d-ffffffffffffffff".into(),
        };
        assert!(!has_component(&other, "Button"));
        record_components(&shown(), Vec::new());
        assert!(!has_component(&shown(), "Button"));
    }

    #[test]
    fn a_state_is_kept_for_its_system_only() {
        keep_state(shown(), "a();".into());
        assert_eq!(kept_state(&shown()).as_deref(), Some("a();"));
        let other = ShownDesignSystem {
            session_id: SESSION.into(),
            key: "d-ffffffffffffffff".into(),
        };
        assert_eq!(kept_state(&other), None);
    }

    fn state(is_commenting: bool) -> ViewState {
        ViewState {
            is_commenting,
            has_marks: false,
        }
    }

    fn intake(frame: &str, raw: &str, components: Option<&[String]>, commenting: bool) -> DsIntake {
        ds_intake(
            frame,
            raw,
            &shown(),
            components,
            state(commenting),
            &mut RateLimit::default(),
            &mut RateLimit::default(),
            Instant::now(),
        )
    }

    #[test]
    fn the_shell_says_its_kinds_and_picks_only_in_comment_mode() {
        let shell = ds_shell_url(SESSION, KEY);
        let token = r#"{"kind":"ds-pick-token","name":"accent"}"#;
        assert_eq!(intake(&shell, token, None, false), DsIntake::Refused);
        assert_eq!(
            intake(&shell, token, None, true),
            DsIntake::Shell(DsShellMessage::PickToken("accent".into()))
        );
        let loaded = r#"{"kind":"ds-preview-loaded","component":"Button"}"#;
        assert_eq!(
            intake(&shell, loaded, None, false),
            DsIntake::Shell(DsShellMessage::PreviewLoaded("Button".into()))
        );
        let section = r#"{"kind":"ds-pick-section","file":"README.md","quote":"Short","before":"","after":"."}"#;
        assert!(matches!(
            intake(&shell, section, None, true),
            DsIntake::Shell(DsShellMessage::PickSection { .. })
        ));
        for bad in [
            r#"{"kind":"ds-pick-section","file":"../x.md","quote":"q","before":"","after":""}"#,
            r#"{"kind":"ds-pick-token","name":"a b"}"#,
            r#"{"kind":"pick-text","quote":"q","before":"","after":""}"#,
        ] {
            assert_eq!(intake(&shell, bad, None, true), DsIntake::Refused, "{bad}");
        }
    }

    #[test]
    fn the_shell_is_held_to_its_rate() {
        let shell = ds_shell_url(SESSION, KEY);
        let mut shell_rate = RateLimit::default();
        let now = Instant::now();
        let loaded = r#"{"kind":"ds-preview-loaded","component":"Button"}"#;
        let accepted = (0..30)
            .filter(|_| {
                ds_intake(
                    &shell,
                    loaded,
                    &shown(),
                    None,
                    state(false),
                    &mut RateLimit::default(),
                    &mut shell_rate,
                    now,
                ) != DsIntake::Refused
            })
            .count();
        assert_eq!(accepted, MAX_SHELL_PER_SECOND as usize);
    }

    #[test]
    fn a_preview_says_page_kinds_only_for_a_recorded_component() {
        let preview = format!(
            "{}?v=1&d=2",
            ds_file_url(SESSION, KEY, "dark", "components/Button/preview.html")
        );
        let pick = r#"{"kind":"pick-text","quote":"Allow","before":"","after":""}"#;
        let names = vec!["Button".to_string()];
        assert!(matches!(
            intake(&preview, pick, Some(&names), true),
            DsIntake::Preview { ref component, .. } if component == "Button"
        ));
        assert_eq!(intake(&preview, pick, None, true), DsIntake::Refused);
        let other = vec!["Card".to_string()];
        assert_eq!(
            intake(&preview, pick, Some(&other), true),
            DsIntake::Refused
        );
        let shell_kind = r#"{"kind":"ds-pick-token","name":"accent"}"#;
        assert_eq!(
            intake(&preview, shell_kind, Some(&names), true),
            DsIntake::Refused
        );
        let elsewhere = ds_file_url(
            SESSION,
            "d-ffffffffffffffff",
            "dark",
            "components/Button/preview.html",
        );
        assert_eq!(
            intake(&elsewhere, pick, Some(&names), true),
            DsIntake::Refused
        );
        let not_preview = ds_file_url(SESSION, KEY, "dark", "README.md");
        assert_eq!(
            intake(&not_preview, pick, Some(&names), true),
            DsIntake::Refused
        );
    }

    #[test]
    fn every_pick_takes_the_keyboard_but_a_load() {
        assert!(DsShellMessage::PickToken("a".into()).takes_keyboard());
        assert!(!DsShellMessage::PreviewLoaded("Button".into()).takes_keyboard());
    }

    #[test]
    fn the_marks_script_refuses_a_name_that_is_not_a_component() {
        assert!(ds_marks_script("Button", &[]).is_some());
        assert_eq!(ds_marks_script("a\"); alert(1); (\"", &[]), None);
        assert_eq!(ds_mode_script(true), "window.__zorvoDs.mode(true);");
    }

    #[test]
    fn a_pick_event_names_its_target() {
        let event = ds_pick_event(
            &shown(),
            &DsIntake::Shell(DsShellMessage::PickToken("accent".into())),
        )
        .unwrap();
        assert_eq!(
            event["target"],
            serde_json::json!({"kind": "token", "name": "accent"})
        );
        assert!(event.get("message").is_none());
        assert_eq!(ds_pick_event(&shown(), &DsIntake::Refused), None);
    }
}
