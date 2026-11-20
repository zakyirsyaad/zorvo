//! The rules for the canvas view: which frame a message came from, what the wrapper may say,
//! and which scripts Zorvo runs in it. `view.rs` does the plumbing on the main thread; every
//! decision is here, so it can be tested without a webview.

use serde_json::Value;

use std::time::Instant;

use super::canvas::{is_id, Canvas};
use super::picks::{is_accepted, parse_page_message, PageMessage, RateLimit, ViewState};
use super::protocol::{
    canvas_shell_url, is_allowed_canvas_navigation, parse_canvas_url, CanvasUrl,
};

/// Emitted with `{sessionId, key, kind: "select"|"zoom", artboardId?, zoom?}` from the wrapper.
pub const CANVAS_VIEW: &str = "canvas-view";
/// The wrapper reports a zoom at most every 100 ms and a select per click; more is not the wrapper.
pub const MAX_SHELL_PER_SECOND: u32 = 20;
/// The largest state `apply` takes: 200 artboards with their URLs fit many times over.
pub const MAX_STATE_BYTES: usize = 1024 * 1024;
const MIN_ZOOM: f64 = 0.05;
const MAX_ZOOM: f64 = 2.0;

/// Which canvas the view shows.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownCanvas {
    pub session_id: String,
    pub key: String,
}

/// The frame a message was posted from, by its URL (wry's `request.uri()`).
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    /// The wrapper itself: its URL exactly, with no query or fragment.
    Shell,
    /// An artboard of this canvas, by its file.
    Board(String),
    Other,
}

pub fn canvas_message_source(frame_url: &str, canvas: &ShownCanvas) -> Source {
    if frame_url == canvas_shell_url(&canvas.session_id, &canvas.key) {
        return Source::Shell;
    }
    match parse_canvas_url(frame_url) {
        Some(CanvasUrl::File {
            session_id,
            key,
            relative,
        }) if session_id == canvas.session_id && key == canvas.key => Source::Board(relative),
        _ => Source::Other,
    }
}

/// What the wrapper says: a selection (none for a click on the background) or the zoom.
#[derive(Clone, Debug, PartialEq)]
pub enum ShellMessage {
    Select(Option<String>),
    Zoom(f64),
}

/// The wrapper's message, or `None` for anything it never sends: another kind, a field more
/// or less, an id that is not an artboard id, a zoom outside the wrapper's range.
pub fn parse_shell_message(body: &str) -> Option<ShellMessage> {
    let Value::Object(fields) = serde_json::from_str::<Value>(body).ok()? else {
        return None;
    };
    match (fields.get("kind")?.as_str()?, fields.len()) {
        ("canvas-select", 2) => match fields.get("artboardId")? {
            Value::Null => Some(ShellMessage::Select(None)),
            Value::String(id) if is_id(id) => Some(ShellMessage::Select(Some(id.clone()))),
            _ => None,
        },
        ("canvas-zoom", 2) => {
            let zoom = fields.get("zoom")?.as_f64()?;
            (zoom.is_finite() && (MIN_ZOOM..=MAX_ZOOM).contains(&zoom))
                .then_some(ShellMessage::Zoom(zoom))
        }
        _ => None,
    }
}

/// Emitted with `{sessionId, key, artboardId, message}` for a comment pick on an artboard.
pub const CANVAS_PICK: &str = "canvas-pick";

/// What a message of the canvas view is, by the frame it came from and what it says.
#[derive(Clone, Debug, PartialEq)]
pub enum CanvasIntake {
    Shell(ShellMessage),
    Board {
        artboard_id: String,
        message: PageMessage,
    },
    Refused,
}

/// The wrapper's kinds are read only from the wrapper's frame, and a page's kinds only from an
/// artboard of this canvas (a file `canvas.json` lists); an artboard saying what the wrapper
/// says, or the wrapper saying a pick, is refused. Board picks share `rate` (5 a second);
/// the wrapper's kinds share `shell_rate` (20 a second). Without a canvas read, only
/// board messages are refused.
#[allow(clippy::too_many_arguments)]
pub fn canvas_intake(
    frame_url: &str,
    raw: &str,
    shown: &ShownCanvas,
    canvas: Option<&Canvas>,
    state: ViewState,
    rate: &mut RateLimit,
    shell_rate: &mut RateLimit,
    now: Instant,
) -> CanvasIntake {
    match canvas_message_source(frame_url, shown) {
        Source::Shell => parse_shell_message(raw)
            .filter(|_| shell_rate.allow_up_to(now, MAX_SHELL_PER_SECOND))
            .map_or(CanvasIntake::Refused, CanvasIntake::Shell),
        Source::Board(file) => {
            let Some(artboard) = canvas
                .into_iter()
                .flat_map(|canvas| &canvas.sections)
                .flat_map(|section| &section.artboards)
                .find(|artboard| artboard.file == file)
            else {
                return CanvasIntake::Refused;
            };
            match parse_page_message(raw)
                .filter(|message| is_accepted(message, state))
                .filter(|_| rate.allow(now))
            {
                Some(message) => CanvasIntake::Board {
                    artboard_id: artboard.id.clone(),
                    message,
                },
                None => CanvasIntake::Refused,
            }
        }
        Source::Other => CanvasIntake::Refused,
    }
}

/// The `canvas-pick` event for a pick on an artboard of the canvas on screen.
pub fn pick_event(canvas: &ShownCanvas, artboard_id: &str, message: &PageMessage) -> Value {
    serde_json::json!({
        "sessionId": canvas.session_id,
        "key": canvas.key,
        "artboardId": artboard_id,
        "message": message,
    })
}

/// The `canvas-view` event for a message of the canvas on screen.
pub fn view_event(canvas: &ShownCanvas, message: &ShellMessage) -> Value {
    let mut event = serde_json::json!({ "sessionId": canvas.session_id, "key": canvas.key });
    let fields = event.as_object_mut().expect("an object literal");
    match message {
        ShellMessage::Select(id) => {
            fields.insert("kind".into(), "select".into());
            fields.insert("artboardId".into(), id.clone().into());
        }
        ShellMessage::Zoom(zoom) => {
            fields.insert("kind".into(), "zoom".into());
            fields.insert("zoom".into(), (*zoom).into());
        }
    }
    event
}

fn is_command(name: &str) -> bool {
    if matches!(name, "fit" | "actual" | "in" | "out" | "prev" | "next") {
        return true;
    }
    ["section:", "focus:"]
        .iter()
        .any(|prefix| name.strip_prefix(prefix).is_some_and(is_id))
}

/// The script that runs one of the wrapper's commands, or `None` for a name outside the list.
pub fn command_script(name: &str) -> Option<String> {
    is_command(name).then(|| {
        // The name is letters, digits, `-` and `:` only, so as a JSON string it is plain text.
        let literal = serde_json::to_string(name).expect("a string serializes");
        format!("window.__zorvoCanvas.command({literal});")
    })
}

/// The script that turns the wrapper's comment mode on or off; the wrapper posts it to every
/// live artboard.
pub fn canvas_mode_script(on: bool) -> String {
    format!("window.__zorvoCanvas.mode({on});")
}

/// The script that hands the wrapper a state, or `None` when it is not one JSON object of at
/// most `MAX_STATE_BYTES`. The text run is the object written out again, never what was sent.
pub fn apply_script(state_json: &str) -> Option<String> {
    if state_json.len() > MAX_STATE_BYTES {
        return None;
    }
    let state @ Value::Object(_) = serde_json::from_str::<Value>(state_json).ok()? else {
        return None;
    };
    let literal = serde_json::to_string(&state).ok()?;
    Some(format!("window.__zorvoCanvas.apply({literal});"))
}

/// The canvas view's navigation rule: the wrapper's URL once (its own load), then only the
/// canvas's files. Every frame goes through wry's navigation handler, and an artboard whose
/// frame went to the wrapper's URL would post messages as the wrapper.
#[derive(Debug, Default)]
pub struct CanvasNavigation {
    has_loaded_shell: bool,
}

impl CanvasNavigation {
    pub fn allows(&mut self, url: &str, canvas: &ShownCanvas) -> bool {
        if !is_allowed_canvas_navigation(url, &canvas.session_id, &canvas.key) {
            return false;
        }
        if !matches!(parse_canvas_url(url), Some(CanvasUrl::Shell { .. })) {
            return true;
        }
        let is_first = !self.has_loaded_shell;
        self.has_loaded_shell = true;
        is_first
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::protocol::canvas_file_url;

    const SESSION: &str = "session-1794800000000-k3x9a";
    const KEY: &str = "c-0123456789abcdef";

    fn canvas() -> ShownCanvas {
        ShownCanvas {
            session_id: SESSION.to_string(),
            key: KEY.to_string(),
        }
    }

    #[test]
    fn canvas_messages_are_taken_only_from_the_shell_frame() {
        let shown = canvas();
        let shell = canvas_shell_url(SESSION, KEY);

        assert_eq!(canvas_message_source(&shell, &shown), Source::Shell);
        // An artboard's frame is a board, whatever its query.
        let board = format!(
            "{}?v=0123456789ab",
            canvas_file_url(SESSION, KEY, "pay/b.html")
        );
        assert_eq!(
            canvas_message_source(&board, &shown),
            Source::Board("pay/b.html".to_string())
        );
        // A query or fragment on the shell is not the shell.
        assert_eq!(
            canvas_message_source(&format!("{shell}?x"), &shown),
            Source::Other
        );
        assert_eq!(
            canvas_message_source(&format!("{shell}#x"), &shown),
            Source::Other
        );
        // Another canvas, another session, a page, nothing.
        let other_key = "c-ffffffffffffffff";
        for url in [
            canvas_shell_url(SESSION, other_key),
            canvas_shell_url("session-2", KEY),
            canvas_file_url("session-2", KEY, "a.html"),
            "zorvo-artifact://localhost/session-1/a-0123456789abcdef/1".to_string(),
            "about:blank".to_string(),
            String::new(),
        ] {
            assert_eq!(canvas_message_source(&url, &shown), Source::Other, "{url}");
        }
    }

    #[test]
    fn only_the_shells_own_messages_are_read() {
        assert_eq!(
            parse_shell_message(r#"{"kind":"canvas-select","artboardId":"pay-b"}"#),
            Some(ShellMessage::Select(Some("pay-b".to_string())))
        );
        assert_eq!(
            parse_shell_message(r#"{"kind":"canvas-select","artboardId":null}"#),
            Some(ShellMessage::Select(None))
        );
        assert_eq!(
            parse_shell_message(r#"{"kind":"canvas-zoom","zoom":0.38}"#),
            Some(ShellMessage::Zoom(0.38))
        );
        for bad in [
            r#"{"kind":"canvas-select"}"#,
            r#"{"kind":"canvas-select","artboardId":"Pay B"}"#,
            r#"{"kind":"canvas-select","artboardId":"pay","extra":1}"#,
            r#"{"kind":"canvas-zoom","zoom":9}"#,
            r#"{"kind":"canvas-zoom","zoom":"1"}"#,
            r#"{"kind":"canvas-zoom","zoom":0.01}"#,
            r#"{"kind":"pick-text","quote":"x"}"#,
            r#"[1]"#,
            "not json",
        ] {
            assert_eq!(parse_shell_message(bad), None, "{bad}");
        }
        let long = format!(
            r#"{{"kind":"canvas-select","artboardId":"{}"}}"#,
            "a".repeat(65)
        );
        assert_eq!(parse_shell_message(&long), None);
    }

    #[test]
    fn refuses_a_command_outside_the_list() {
        for good in [
            "fit",
            "actual",
            "in",
            "out",
            "prev",
            "next",
            "section:flow",
            "focus:pay-b",
        ] {
            assert!(command_script(good).is_some(), "{good}");
        }
        for bad in [
            "eval:1",
            "section:",
            "focus:Pay B",
            "focus:x\");alert(1);(\"",
            "FIT",
            "fit ",
            "",
        ] {
            assert_eq!(command_script(bad), None, "{bad}");
        }
        assert_eq!(
            command_script("focus:pay-b").as_deref(),
            Some(r#"window.__zorvoCanvas.command("focus:pay-b");"#)
        );
    }

    #[test]
    fn applies_only_a_json_object_of_at_most_a_mebibyte() {
        assert_eq!(
            apply_script(r#"{"boards":[],"sections":[]}"#).as_deref(),
            Some(r#"window.__zorvoCanvas.apply({"boards":[],"sections":[]});"#)
        );
        for bad in ["[]", "1", "\"x\"", "null", "{", "{}); alert(1); ({"] {
            assert_eq!(apply_script(bad), None, "{bad}");
        }
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_STATE_BYTES));
        assert_eq!(apply_script(&big), None);
    }

    #[test]
    fn the_shell_url_may_be_loaded_once_per_view() {
        let shown = canvas();
        let mut navigation = CanvasNavigation::default();
        let shell = canvas_shell_url(SESSION, KEY);
        let file = canvas_file_url(SESSION, KEY, "a.html");

        assert!(navigation.allows(&shell, &shown));
        assert!(navigation.allows(&file, &shown));
        assert!(navigation.allows(&file, &shown));
        // An artboard that sends its frame to the shell would post as the shell.
        assert!(!navigation.allows(&shell, &shown));
        assert!(!navigation.allows("https://example.com/", &shown));
    }

    #[test]
    fn the_forty_artboard_fixture_is_a_valid_canvas() {
        let bytes = include_bytes!("../../tests/fixtures/canvas-40/canvas.json");
        let canvas = crate::artifacts::canvas::parse_canvas(bytes).expect("the fixture parses");
        let boards: Vec<_> = canvas.sections.iter().flat_map(|s| &s.artboards).collect();

        assert_eq!(canvas.sections.len(), 4);
        assert_eq!(boards.len(), 40);
        assert_eq!(boards.iter().filter(|b| b.group.is_some()).count(), 2);
        let folder = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/canvas-40");
        assert!(boards
            .iter()
            .all(|b| std::path::Path::new(folder).join(&b.file).is_file()));
    }

    #[test]
    fn a_view_event_names_the_canvas() {
        let event = view_event(&canvas(), &ShellMessage::Select(None));
        assert_eq!(
            event,
            serde_json::json!({ "sessionId": SESSION, "key": KEY, "kind": "select", "artboardId": null })
        );
        let event = view_event(&canvas(), &ShellMessage::Zoom(0.5));
        assert_eq!(
            event,
            serde_json::json!({ "sessionId": SESSION, "key": KEY, "kind": "zoom", "zoom": 0.5 })
        );
    }

    fn two_boards() -> Canvas {
        use crate::artifacts::canvas::{Artboard, Section};
        let board = |id: &str, file: &str| Artboard {
            id: id.to_string(),
            title: id.to_string(),
            file: file.to_string(),
            width: 100,
            height: 100,
            group: None,
        };
        Canvas {
            title: "c".to_string(),
            sections: vec![Section {
                id: "s".to_string(),
                title: "s".to_string(),
                artboards: vec![board("pay-a", "pay/a.html"), board("pay-b", "pay/b.html")],
            }],
        }
    }

    const PICK: &str = r#"{"kind":"pick-text","quote":"Pay","before":"","after":""}"#;
    const SELECT: &str = r#"{"kind":"canvas-select","artboardId":"pay-a"}"#;

    fn intake(frame: &str, raw: &str, shown: &ShownCanvas) -> CanvasIntake {
        let state = ViewState {
            is_commenting: true,
            has_marks: false,
        };
        canvas_intake(
            frame,
            raw,
            shown,
            Some(&two_boards()),
            state,
            &mut RateLimit::default(),
            &mut RateLimit::default(),
            Instant::now(),
        )
    }

    #[test]
    fn a_board_cannot_send_shell_kinds() {
        let url = canvas_file_url(SESSION, KEY, "pay/a.html");
        assert_eq!(intake(&url, SELECT, &canvas()), CanvasIntake::Refused);
    }

    #[test]
    fn the_shell_cannot_send_picks() {
        let url = canvas_shell_url(SESSION, KEY);
        assert_eq!(intake(&url, PICK, &canvas()), CanvasIntake::Refused);
        assert_eq!(
            intake(&url, SELECT, &canvas()),
            CanvasIntake::Shell(ShellMessage::Select(Some("pay-a".to_string())))
        );
    }

    #[test]
    fn a_board_of_another_canvas_is_refused() {
        let url = canvas_file_url(SESSION, "c-ffffffffffffffff", "pay/a.html");
        assert_eq!(intake(&url, PICK, &canvas()), CanvasIntake::Refused);
    }

    #[test]
    fn a_file_that_is_not_an_artboard_is_refused() {
        let url = canvas_file_url(SESSION, KEY, "assets/frame.html");
        assert_eq!(intake(&url, PICK, &canvas()), CanvasIntake::Refused);
    }

    #[test]
    fn picks_from_a_board_name_that_board() {
        let url = format!(
            "{}?v=0123456789ab",
            canvas_file_url(SESSION, KEY, "pay/b.html")
        );
        match intake(&url, PICK, &canvas()) {
            CanvasIntake::Board { artboard_id, .. } => assert_eq!(artboard_id, "pay-b"),
            other => panic!("{other:?}"),
        }
        // Outside comment mode a pick is refused, as on a page.
        let off = ViewState::default();
        let refused = canvas_intake(
            &url,
            PICK,
            &canvas(),
            Some(&two_boards()),
            off,
            &mut RateLimit::default(),
            &mut RateLimit::default(),
            Instant::now(),
        );
        assert_eq!(refused, CanvasIntake::Refused);
    }

    #[test]
    fn the_shell_is_heard_without_a_canvas_read_but_a_board_is_not() {
        let shell = canvas_shell_url(SESSION, KEY);
        let board = canvas_file_url(SESSION, KEY, "pay/a.html");
        let run = |frame: &str, raw: &str| {
            canvas_intake(
                frame,
                raw,
                &canvas(),
                None,
                ViewState {
                    is_commenting: true,
                    has_marks: false,
                },
                &mut RateLimit::default(),
                &mut RateLimit::default(),
                Instant::now(),
            )
        };
        assert_eq!(
            run(&shell, SELECT),
            CanvasIntake::Shell(ShellMessage::Select(Some("pay-a".to_string())))
        );
        assert_eq!(run(&board, PICK), CanvasIntake::Refused);
    }

    #[test]
    fn the_shell_is_limited_to_twenty_a_second() {
        let shell = canvas_shell_url(SESSION, KEY);
        let state = ViewState::default();
        let mut rate = RateLimit::default();
        let mut shell_rate = RateLimit::default();
        let now = Instant::now();
        let mut results = (0..21).map(|_| {
            canvas_intake(
                &shell,
                SELECT,
                &canvas(),
                None,
                state,
                &mut rate,
                &mut shell_rate,
                now,
            )
        });
        assert!(results
            .by_ref()
            .take(20)
            .all(|r| r != CanvasIntake::Refused));
        assert_eq!(results.next(), Some(CanvasIntake::Refused));
    }
}
