//! What an artifact page may send Zorvo, and what Zorvo sends it back.
//!
//! The page's own scripts can call the same handler Zorvo's script uses, so
//! every message is checked here as untrusted data: a known kind, every field
//! within its limit, nothing else. Design: `docs/superpowers/specs/2026-11-17-artifact-comments-design.md`.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// The event an accepted message goes out on, to the main webview.
pub const ARTIFACT_PAGE_PICK: &str = "artifact-page-pick";
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
pub const MAX_QUOTE_CHARS: usize = 1000;
pub const MAX_CONTEXT_CHARS: usize = 60;
pub const MAX_TAG_CHARS: usize = 32;
pub const MAX_ELEMENT_ID_CHARS: usize = 100;
pub const MAX_CLASSES: usize = 5;
pub const MAX_CLASS_CHARS: usize = 60;
pub const MAX_LABEL_CHARS: usize = 100;
pub const MAX_ELEMENT_TEXT_CHARS: usize = 200;
pub const MAX_PATH_LEVELS: usize = 12;
pub const MAX_PATH_CHARS: usize = 1000;
pub const MAX_MARKS: usize = 200;
pub const MAX_PER_SECOND: u32 = 5;
/// Messages a page may send in a second, accepted or not, before it is ended.
/// Zorvo's own script sends a few at most: one per click or selection, one per marks call.
pub const MAX_MESSAGES_PER_SECOND: u32 = 200;
const PATH_SEPARATOR: &str = " > ";
const RATE_WINDOW: Duration = Duration::from_secs(1);

/// Selected text, cut from the page's text nodes, with a little context on each side.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextAnchor {
    pub quote: String,
    pub before: String,
    pub after: String,
}

/// A clicked element, described so the agent can find it and the page can find it again.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementAnchor {
    pub tag: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_id: Option<String>,
    pub classes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub text: String,
    pub path: String,
}

/// Holds nothing; it makes a message with no fields refuse any field it is sent.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoFields {}

/// The numbers of marks the page could not find again.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MissingMarks {
    pub numbers: Vec<u32>,
}

/// What the page sends. Wire form: `{"kind":"pick-text",...}`, `{"kind":"pick-element",...}`,
/// `{"kind":"cancel"}`, `{"kind":"marks-missing","numbers":[...]}`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PageMessage {
    PickText(TextAnchor),
    PickElement(ElementAnchor),
    Cancel(NoFields),
    MarksMissing(MissingMarks),
}

impl PageMessage {
    /// A pick is followed by the user writing the comment, so the keyboard must leave the page.
    pub fn takes_keyboard(&self) -> bool {
        matches!(self, Self::PickText(_) | Self::PickElement(_))
    }
}

/// Where a comment is on the page: `{"kind":"text",...}` or `{"kind":"element",...}`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PageAnchor {
    Text(TextAnchor),
    Element(ElementAnchor),
}

/// A comment's number and where it is, for the page to draw.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PageMark {
    pub n: u32,
    pub anchor: PageAnchor,
}

/// What the shown page has been told, which decides what it may send.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ViewState {
    pub is_commenting: bool,
    pub has_marks: bool,
}

/// An accepted message, with the page it came from.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PagePickEvent {
    pub session_id: String,
    pub artifact_id: String,
    pub version: u32,
    pub message: PageMessage,
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

fn is_tag(tag: &str) -> bool {
    let mut letters = tag.chars();
    let starts_with_letter = letters.next().is_some_and(|c| c.is_ascii_lowercase());
    starts_with_letter
        && chars(tag) <= MAX_TAG_CHARS
        && letters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_within(text: Option<&String>, limit: usize) -> bool {
    text.is_none_or(|text| chars(text) <= limit)
}

fn is_valid_text(anchor: &TextAnchor) -> bool {
    !anchor.quote.is_empty()
        && chars(&anchor.quote) <= MAX_QUOTE_CHARS
        && chars(&anchor.before) <= MAX_CONTEXT_CHARS
        && chars(&anchor.after) <= MAX_CONTEXT_CHARS
}

fn is_valid_element(anchor: &ElementAnchor) -> bool {
    is_tag(&anchor.tag)
        && is_within(anchor.element_id.as_ref(), MAX_ELEMENT_ID_CHARS)
        && anchor.classes.len() <= MAX_CLASSES
        && anchor
            .classes
            .iter()
            .all(|class| chars(class) <= MAX_CLASS_CHARS)
        && is_within(anchor.label.as_ref(), MAX_LABEL_CHARS)
        && chars(&anchor.text) <= MAX_ELEMENT_TEXT_CHARS
        && !anchor.path.is_empty()
        && chars(&anchor.path) <= MAX_PATH_CHARS
        && anchor.path.split(PATH_SEPARATOR).count() <= MAX_PATH_LEVELS
}

fn is_valid_anchor(anchor: &PageAnchor) -> bool {
    match anchor {
        PageAnchor::Text(text) => is_valid_text(text),
        PageAnchor::Element(element) => is_valid_element(element),
    }
}

fn is_valid_message(message: &PageMessage) -> bool {
    match message {
        PageMessage::PickText(text) => is_valid_text(text),
        PageMessage::PickElement(element) => is_valid_element(element),
        PageMessage::Cancel(_) => true,
        PageMessage::MarksMissing(missing) => {
            missing.numbers.len() <= MAX_MARKS && missing.numbers.iter().all(|&n| n > 0)
        }
    }
}

/// The message in `raw`, or `None` when it is too large, of an unknown kind,
/// has a field it should not, or breaks a limit.
pub fn parse_page_message(raw: &str) -> Option<PageMessage> {
    if raw.len() > MAX_MESSAGE_BYTES {
        return None;
    }
    serde_json::from_str::<PageMessage>(raw)
        .ok()
        .filter(is_valid_message)
}

/// The marks to send a page, or `None` when there are too many, a number is 0
/// or repeated, or an anchor breaks a pick's limits.
pub fn checked_marks(marks: Vec<PageMark>) -> Option<Vec<PageMark>> {
    let mut numbers = HashSet::new();
    let is_valid = marks.len() <= MAX_MARKS
        && marks
            .iter()
            .all(|mark| mark.n > 0 && numbers.insert(mark.n) && is_valid_anchor(&mark.anchor));
    is_valid.then_some(marks)
}

/// Picks and `cancel` count only in comment mode; `marks-missing` only after marks were sent.
pub fn is_accepted(message: &PageMessage, state: ViewState) -> bool {
    match message {
        PageMessage::PickText(_) | PageMessage::PickElement(_) | PageMessage::Cancel(_) => {
            state.is_commenting
        }
        PageMessage::MarksMissing(_) => state.has_marks,
    }
}

/// What the view's handler does with `raw`: the message, when it comes from the
/// view on screen (`is_current`), is well formed, is accepted in `state`, and
/// fits the rate. Only accepted messages use the rate.
pub fn accepted_message(
    raw: &str,
    is_current: bool,
    state: ViewState,
    rate: &mut RateLimit,
    now: Instant,
) -> Option<PageMessage> {
    if !is_current {
        return None;
    }
    parse_page_message(raw)
        .filter(|message| is_accepted(message, state))
        .filter(|_| rate.allow(now))
}

/// What the view does with a message before reading it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intake {
    Read,
    /// The page sends what Zorvo's script never would: end its process.
    EndPage,
    /// The page is being ended; nothing more of it is read.
    Drop,
}

/// Counts every message a page sends, refused ones too. WebKit hands each one
/// to the main thread, so a page that floods the handler would slow Zorvo's
/// interface; the base design keeps pages in a process of their own so that
/// one cannot. A body over `MAX_MESSAGE_BYTES`, or more than
/// `MAX_MESSAGES_PER_SECOND` in a second, ends the page.
#[derive(Debug, Default)]
pub struct FloodGuard {
    window_start: Option<Instant>,
    count: u32,
    is_ending: bool,
}

impl FloodGuard {
    pub fn admit(&mut self, body_bytes: usize, now: Instant) -> Intake {
        if self.is_ending {
            return Intake::Drop;
        }
        let is_new_window = self
            .window_start
            .is_none_or(|start| now.saturating_duration_since(start) >= RATE_WINDOW);
        if is_new_window {
            self.window_start = Some(now);
            self.count = 0;
        }
        self.count += 1;
        if body_bytes > MAX_MESSAGE_BYTES || self.count > MAX_MESSAGES_PER_SECOND {
            self.is_ending = true;
            return Intake::EndPage;
        }
        Intake::Read
    }
}

/// Lets `MAX_PER_SECOND` messages through in a window of one second, counted
/// from the window's first message.
#[derive(Debug, Default)]
pub struct RateLimit {
    window_start: Option<Instant>,
    count: u32,
}

impl RateLimit {
    pub fn allow(&mut self, now: Instant) -> bool {
        self.allow_up_to(now, MAX_PER_SECOND)
    }

    /// `allow` with another number a second, for a sender that may say more than a page.
    pub fn allow_up_to(&mut self, now: Instant, limit: u32) -> bool {
        let is_new_window = self
            .window_start
            .is_none_or(|start| now.saturating_duration_since(start) >= RATE_WINDOW);
        if is_new_window {
            self.window_start = Some(now);
            self.count = 1;
            return true;
        }
        if self.count < limit {
            self.count += 1;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn text_pick(quote: &str) -> String {
        serde_json::json!({ "kind": "pick-text", "quote": quote, "before": "a", "after": "b" })
            .to_string()
    }

    fn element_pick(extra: serde_json::Value) -> String {
        let mut body = serde_json::json!({
            "kind": "pick-element",
            "tag": "button",
            "elementId": "export",
            "classes": ["btn"],
            "label": "Export",
            "text": "Export CSV",
            "path": "main > section:nth-of-type(2) > button",
        });
        if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                body.insert(key.clone(), value.clone());
            }
        }
        body.to_string()
    }

    #[test]
    fn parses_each_kind() {
        let bodies = [
            text_pick("Annual plan saves 20%"),
            element_pick(serde_json::json!({})),
            r#"{"kind":"cancel"}"#.to_string(),
            r#"{"kind":"marks-missing","numbers":[2,5]}"#.to_string(),
        ];
        for body in bodies {
            let message = parse_page_message(&body).expect("a valid message");
            let back: serde_json::Value = serde_json::to_value(&message).unwrap();
            let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(back, sent, "round trip of {body}");
        }
    }

    #[test]
    fn only_a_pick_takes_the_keyboard_from_the_page() {
        // After a pick the user writes the comment: their keys must reach Zorvo, never the page.
        let pick_text = parse_page_message(&text_pick("Annual plan")).unwrap();
        let pick_element = parse_page_message(&element_pick(serde_json::json!({}))).unwrap();
        let cancel = parse_page_message(r#"{"kind":"cancel"}"#).unwrap();
        let missing = parse_page_message(r#"{"kind":"marks-missing","numbers":[1]}"#).unwrap();

        assert!(pick_text.takes_keyboard());
        assert!(pick_element.takes_keyboard());
        assert!(!cancel.takes_keyboard());
        assert!(!missing.takes_keyboard());
    }

    #[test]
    fn an_element_pick_may_leave_out_its_id_and_label() {
        let body = r#"{"kind":"pick-element","tag":"div","classes":[],"text":"","path":"div"}"#;
        let message = parse_page_message(body).expect("a valid message");
        assert_eq!(
            serde_json::to_value(&message).unwrap(),
            serde_json::from_str::<serde_json::Value>(body).unwrap()
        );
    }

    #[test]
    fn refuses_a_body_over_16_kib() {
        let body = format!(
            r#"{{"kind":"cancel","pad":"{}"}}"#,
            "x".repeat(MAX_MESSAGE_BYTES)
        );
        assert_eq!(parse_page_message(&body), None);
        let quote = "x".repeat(MAX_QUOTE_CHARS);
        assert!(text_pick(&quote).len() < MAX_MESSAGE_BYTES);
    }

    #[test]
    fn refuses_an_unknown_kind_or_field() {
        assert_eq!(parse_page_message(r#"{"kind":"invoke","cmd":"x"}"#), None);
        assert_eq!(parse_page_message(r#"{"kind":"cancel","cmd":"x"}"#), None);
        assert_eq!(
            parse_page_message(&element_pick(serde_json::json!({ "x": 1 }))),
            None
        );
        assert_eq!(
            parse_page_message(r#"{"quote":"a","before":"","after":""}"#),
            None
        );
        assert_eq!(
            parse_page_message(r#"{"kind":"pick-text","quote":"a","before":""}"#),
            None
        );
        assert_eq!(parse_page_message("not json"), None);
    }

    #[test]
    fn refuses_a_quote_of_1001_characters() {
        let at_limit = "é".repeat(MAX_QUOTE_CHARS);
        assert!(parse_page_message(&text_pick(&at_limit)).is_some());
        let over = "é".repeat(MAX_QUOTE_CHARS + 1);
        assert_eq!(parse_page_message(&text_pick(&over)), None);
        let context = serde_json::json!({ "kind": "pick-text", "quote": "a", "before": "x".repeat(61), "after": "" });
        assert_eq!(parse_page_message(&context.to_string()), None);
    }

    #[test]
    fn refuses_an_empty_quote_or_path() {
        assert_eq!(parse_page_message(&text_pick("")), None);
        assert_eq!(
            parse_page_message(&element_pick(serde_json::json!({ "path": "" }))),
            None
        );
    }

    #[test]
    fn refuses_six_classes() {
        let five = element_pick(serde_json::json!({ "classes": ["a", "b", "c", "d", "e"] }));
        assert!(parse_page_message(&five).is_some());
        let six = element_pick(serde_json::json!({ "classes": ["a", "b", "c", "d", "e", "f"] }));
        assert_eq!(parse_page_message(&six), None);
        let long = element_pick(serde_json::json!({ "classes": ["x".repeat(61)] }));
        assert_eq!(parse_page_message(&long), None);
    }

    #[test]
    fn refuses_a_path_of_13_levels() {
        let twelve = ["div"; 12].join(" > ");
        assert!(parse_page_message(&element_pick(serde_json::json!({ "path": twelve }))).is_some());
        let thirteen = ["div"; 13].join(" > ");
        assert_eq!(
            parse_page_message(&element_pick(serde_json::json!({ "path": thirteen }))),
            None
        );
        let long = "d".repeat(MAX_PATH_CHARS + 1);
        assert_eq!(
            parse_page_message(&element_pick(serde_json::json!({ "path": long }))),
            None
        );
    }

    #[test]
    fn refuses_a_tag_with_capitals_or_spaces() {
        for tag in ["Button", "my tag", "", "1div", &"a".repeat(33)] {
            assert_eq!(
                parse_page_message(&element_pick(serde_json::json!({ "tag": tag }))),
                None,
                "tag {tag:?}"
            );
        }
        assert!(
            parse_page_message(&element_pick(serde_json::json!({ "tag": "my-card2" }))).is_some()
        );
    }

    #[test]
    fn refuses_long_element_fields() {
        for (field, limit) in [
            ("elementId", MAX_ELEMENT_ID_CHARS),
            ("label", MAX_LABEL_CHARS),
            ("text", MAX_ELEMENT_TEXT_CHARS),
        ] {
            let over = element_pick(serde_json::json!({ field: "x".repeat(limit + 1) }));
            assert_eq!(parse_page_message(&over), None, "{field}");
            let at = element_pick(serde_json::json!({ field: "x".repeat(limit) }));
            assert!(parse_page_message(&at).is_some(), "{field}");
        }
    }

    #[test]
    fn refuses_marks_missing_with_201_numbers_or_a_zero() {
        let at_limit: Vec<u32> = (1..=200).collect();
        let body = serde_json::json!({ "kind": "marks-missing", "numbers": at_limit }).to_string();
        assert!(parse_page_message(&body).is_some());
        let over: Vec<u32> = (1..=201).collect();
        let body = serde_json::json!({ "kind": "marks-missing", "numbers": over }).to_string();
        assert_eq!(parse_page_message(&body), None);
        assert_eq!(
            parse_page_message(r#"{"kind":"marks-missing","numbers":[0]}"#),
            None
        );
        assert_eq!(
            parse_page_message(r#"{"kind":"marks-missing","numbers":[-1]}"#),
            None
        );
    }

    #[test]
    fn picks_need_comment_mode() {
        let pick = parse_page_message(&text_pick("a")).unwrap();
        let cancel = parse_page_message(r#"{"kind":"cancel"}"#).unwrap();
        let off = ViewState {
            is_commenting: false,
            has_marks: true,
        };
        let on = ViewState {
            is_commenting: true,
            has_marks: false,
        };
        assert!(!is_accepted(&pick, off));
        assert!(!is_accepted(&cancel, off));
        assert!(is_accepted(&pick, on));
        assert!(is_accepted(&cancel, on));
    }

    #[test]
    fn marks_missing_needs_marks() {
        let missing = parse_page_message(r#"{"kind":"marks-missing","numbers":[]}"#).unwrap();
        assert!(!is_accepted(
            &missing,
            ViewState {
                is_commenting: true,
                has_marks: false
            }
        ));
        assert!(is_accepted(
            &missing,
            ViewState {
                is_commenting: false,
                has_marks: true
            }
        ));
    }

    #[test]
    fn allows_five_a_second_then_drops() {
        let start = Instant::now();
        let mut limit = RateLimit::default();
        for i in 0..5 {
            assert!(
                limit.allow(start + Duration::from_millis(i * 10)),
                "message {i}"
            );
        }
        assert!(!limit.allow(start + Duration::from_millis(500)));
        assert!(limit.allow(start + Duration::from_millis(1000)));
    }

    #[test]
    fn a_message_from_an_older_view_is_dropped() {
        let on = ViewState {
            is_commenting: true,
            has_marks: false,
        };
        let mut limit = RateLimit::default();
        let now = Instant::now();
        assert_eq!(
            accepted_message(&text_pick("a"), false, on, &mut limit, now),
            None
        );
        assert!(accepted_message(&text_pick("a"), true, on, &mut limit, now).is_some());
    }

    #[test]
    fn only_accepted_messages_use_the_rate() {
        let off = ViewState::default();
        let on = ViewState {
            is_commenting: true,
            has_marks: false,
        };
        let mut limit = RateLimit::default();
        let now = Instant::now();
        for _ in 0..10 {
            assert_eq!(
                accepted_message(&text_pick("a"), true, off, &mut limit, now),
                None
            );
            assert_eq!(accepted_message("junk", true, on, &mut limit, now), None);
        }
        for i in 0..5 {
            assert!(
                accepted_message(&text_pick("a"), true, on, &mut limit, now).is_some(),
                "{i}"
            );
        }
        assert_eq!(
            accepted_message(&text_pick("a"), true, on, &mut limit, now),
            None
        );
    }

    #[test]
    fn a_body_over_16_kib_ends_the_page() {
        let mut guard = FloodGuard::default();
        let now = Instant::now();
        assert_eq!(guard.admit(MAX_MESSAGE_BYTES, now), Intake::Read);
        assert_eq!(guard.admit(MAX_MESSAGE_BYTES + 1, now), Intake::EndPage);
        // Once the page is being ended, nothing else of it is read or ended again.
        assert_eq!(guard.admit(10, now), Intake::Drop);
    }

    #[test]
    fn two_hundred_messages_a_second_are_read_and_the_next_ends_the_page() {
        let mut guard = FloodGuard::default();
        let start = Instant::now();
        for i in 0..MAX_MESSAGES_PER_SECOND {
            let at = start + Duration::from_millis(u64::from(i));
            assert_eq!(guard.admit(10, at), Intake::Read, "message {i}");
        }
        assert_eq!(
            guard.admit(10, start + Duration::from_millis(900)),
            Intake::EndPage
        );
    }

    #[test]
    fn a_new_second_counts_again() {
        let mut guard = FloodGuard::default();
        let start = Instant::now();
        for _ in 0..MAX_MESSAGES_PER_SECOND {
            assert_eq!(guard.admit(10, start), Intake::Read);
        }
        assert_eq!(
            guard.admit(10, start + Duration::from_secs(1)),
            Intake::Read
        );
    }

    fn mark(n: u32, anchor: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "n": n, "anchor": anchor })
    }

    fn marks(values: Vec<serde_json::Value>) -> Vec<PageMark> {
        serde_json::from_value(serde_json::Value::Array(values)).expect("marks shape")
    }

    #[test]
    fn checked_marks_refuses_a_repeated_number_and_a_bad_anchor() {
        let text = serde_json::json!({ "kind": "text", "quote": "a", "before": "", "after": "" });
        let element = serde_json::json!({ "kind": "element", "tag": "p", "classes": [], "text": "", "path": "p" });
        let good = marks(vec![mark(1, text.clone()), mark(2, element.clone())]);
        assert_eq!(checked_marks(good.clone()), Some(good));
        assert_eq!(
            checked_marks(marks(vec![mark(1, text.clone()), mark(1, element.clone())])),
            None
        );
        assert_eq!(checked_marks(marks(vec![mark(0, text.clone())])), None);
        let bad = serde_json::json!({ "kind": "element", "tag": "P", "classes": [], "text": "", "path": "p" });
        assert_eq!(checked_marks(marks(vec![mark(1, bad)])), None);
        let many: Vec<_> = (1..=201).map(|n| mark(n, text.clone())).collect();
        assert_eq!(checked_marks(marks(many)), None);
    }

    #[test]
    fn the_event_names_its_page_in_camel_case() {
        let event = PagePickEvent {
            session_id: "s".into(),
            artifact_id: "a-0000000000000000".into(),
            version: 3,
            message: PageMessage::Cancel(NoFields {}),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({ "sessionId": "s", "artifactId": "a-0000000000000000", "version": 3, "message": { "kind": "cancel" } })
        );
        assert_eq!(ARTIFACT_PAGE_PICK, "artifact-page-pick");
    }
}
