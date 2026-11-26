//! A design system in the shared child webview: which system is shown, what its view may load,
//! the shell state kept across views of it, and the component list messages are checked
//! against (Part 4). The webview itself lives in `view.rs`; this module holds the rules.

use serde_json::Value;
use std::cell::RefCell;

use super::ds_protocol::{is_allowed_ds_navigation, parse_ds_url, DsUrl};

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
}
