//! Zorvo's own script in an artifact page, and the two calls Rust makes into it.
//!
//! The script is added with wry's `with_initialization_script`, so the served
//! body stays the stored bytes. It reports picks through the view's IPC
//! handler (`picks.rs` checks each one) and draws numbered marks. It is sent no
//! comment text, ever.

use super::picks::PageMark;

pub const PAGE_SCRIPT: &str = include_str!("page_script.js");

/// The one call that turns comment mode on or off in the page.
pub fn mode_script(on: bool) -> String {
    format!("window.__zorvoCommentMode && window.__zorvoCommentMode({on})")
}

/// The one call that draws `marks`, written by serde, so nothing in an anchor
/// can be anything but a JSON string inside it.
pub fn marks_script(marks: &[PageMark]) -> String {
    let json = serde_json::to_string(marks).unwrap_or_else(|_| "[]".to_string());
    format!("window.__zorvoMarks && window.__zorvoMarks({json})")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::picks::PageMark;
    use sha2::{Digest, Sha256};

    #[test]
    fn page_script_is_pinned() {
        let digest = Sha256::digest(PAGE_SCRIPT.as_bytes());
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        // A change to the script must be a visible change: update this after reviewing it.
        assert_eq!(hex, PINNED_SHA256);
    }

    const PINNED_SHA256: &str = "3e4ca0f2a118520fc191ed83f3e28411ab4100d852b60cbf987137ffa4365564";

    #[test]
    fn page_script_names_no_tauri_internals() {
        assert!(!PAGE_SCRIPT.contains("__TAURI"));
        assert!(!PAGE_SCRIPT.contains("eval("));
        assert!(!PAGE_SCRIPT.contains("fetch("));
        assert!(!PAGE_SCRIPT.contains("XMLHttpRequest"));
        assert!(PAGE_SCRIPT.contains("__zorvoMarks"));
        assert!(PAGE_SCRIPT.contains("__zorvoCommentMode"));
    }

    #[test]
    fn mode_script_is_one_fixed_call() {
        assert_eq!(
            mode_script(true),
            "window.__zorvoCommentMode && window.__zorvoCommentMode(true)"
        );
        assert_eq!(
            mode_script(false),
            "window.__zorvoCommentMode && window.__zorvoCommentMode(false)"
        );
    }

    #[test]
    fn marks_script_is_one_fixed_call() {
        let marks: Vec<PageMark> = serde_json::from_value(serde_json::json!([
            { "n": 1, "anchor": { "kind": "text", "quote": "</script>\u{2028}\"x", "before": "", "after": "" } }
        ]))
        .unwrap();

        let script = marks_script(&marks);

        let prefix = "window.__zorvoMarks && window.__zorvoMarks(";
        assert!(script.starts_with(prefix));
        assert!(script.ends_with(')'));
        let json = &script[prefix.len()..script.len() - 1];
        let back: Vec<PageMark> = serde_json::from_str(json).expect("the argument is the JSON");
        // The argument reads back as the marks, so nothing in the quote ended the call early.
        assert_eq!(back, marks);
    }
}
