//! The artifact page's own webview: a child of the main window, placed over
//! the box the main webview leaves for it.
//!
//! It is made with wry directly, so Tauri never sees it: no Tauri IPC script
//! and no invoke key exist inside it. Its one initialization script and its
//! one message handler are Zorvo's own, for comments (`page_script.js`,
//! `picks.rs`): the handler carries data only, never a command, and every
//! message is checked as the page's, since the page can call it too. It has its own web
//! content process, so a page that never yields cannot stop Zorvo's interface
//! (a frame inside the main webview does; see the spec's spike results).
//! There is one at a time, and it lives on the main thread.
//!
//! A canvas shows in the same view, through Zorvo's wrapper (`canvas_shell.html`): the comment
//! script then runs in every frame, so it reaches the artboards too, and a message is read as
//! the wrapper's only when its frame's URL is the wrapper's (`canvas_view.rs`).

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager};

use super::canvas::Canvas;
pub use super::canvas_view::ShownCanvas;
use super::canvas_view::{
    apply_script, canvas_intake, canvas_marks_script, canvas_mode_script, command_script,
    pick_event, view_event, CanvasIntake, CanvasNavigation, CANVAS_PICK, CANVAS_VIEW,
};
use super::page_script::{marks_script, mode_script, PAGE_SCRIPT};
use super::picks::{
    accepted_message, FloodGuard, Intake, PageMark, PagePickEvent, RateLimit, ViewState,
    ARTIFACT_PAGE_PICK,
};
use super::protocol::{canvas_shell_url, is_allowed_navigation, respond, Served, SCHEME};

const MAIN_WINDOW: &str = "main";
pub const COULD_NOT_SHOW: &str = "Zorvo could not show that page.";

/// Which stored page the view shows, so deleting another session's pages leaves it alone.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownPage {
    pub session_id: String,
    pub artifact_id: String,
    pub version: u32,
}

/// What the one view shows: a stored page, or a canvas through Zorvo's wrapper.
#[derive(Clone, Debug, PartialEq)]
pub enum ShownView {
    Page(ShownPage),
    Canvas(ShownCanvas),
    Motion(ShownMotion),
}

/// A motion the view shows through Zorvo's preview wrapper.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownMotion {
    pub session_id: String,
    pub key: String,
}

/// What decides whether the view is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Display {
    /// The page has finished loading. Until then the view is not drawn: a new
    /// webview is white, which flashes in a dark window before the page paints.
    pub is_loaded: bool,
    /// Something of Zorvo's is drawn where the page is.
    pub is_hidden: bool,
    /// The page's box is nowhere in the window. The view is kept, so the page
    /// is the same one when its box comes back.
    pub is_outside: bool,
}

pub fn is_visible(display: Display) -> bool {
    display.is_loaded && !display.is_hidden && !display.is_outside
}

/// `display` once the page's box is at `bounds`, or nowhere in the window.
pub fn with_place(display: Display, bounds: Option<Bounds>) -> Display {
    Display {
        is_outside: bounds.is_none(),
        ..display
    }
}

/// A page that has not said it loaded is shown anyway after this long, so one
/// that never finishes loading is still seen (and can be reloaded).
const SHOW_ANYWAY_AFTER: std::time::Duration = std::time::Duration::from_secs(3);

thread_local! {
    /// The one child webview and what it shows. `wry::WebView` is not `Send`, so it stays here.
    static VIEW: RefCell<Option<(wry::WebView, ShownView)>> = const { RefCell::new(None) };
    static DISPLAY: Cell<Display> = const { Cell::new(Display { is_loaded: false, is_hidden: false, is_outside: false }) };
    /// Counts the views made, so a late "loaded" for an earlier view changes nothing.
    static GENERATION: Cell<u64> = const { Cell::new(0) };
    /// Comment mode of the view on screen; every new view starts with it off.
    static COMMENTING: Cell<bool> = const { Cell::new(false) };
    /// The last marks asked for, with their page. Kept across views of the same
    /// page (Reload), and run again once such a view has loaded.
    static MARKS: RefCell<Option<(ShownPage, Vec<PageMark>)>> = const { RefCell::new(None) };
    /// The generation marks were last run in, so only that view may say which it could not find.
    static MARKS_SENT: Cell<u64> = const { Cell::new(0) };
    /// How many messages the view on screen has had through this second.
    static RATE: RefCell<RateLimit> = RefCell::new(RateLimit::default());
    /// Every message the view on screen has sent, refused or not, to end a page that floods.
    static FLOOD: RefCell<FloodGuard> = RefCell::new(FloodGuard::default());
    /// How many messages the wrapper has had through this second (its own limit, not a page's).
    static SHELL_RATE: RefCell<RateLimit> = RefCell::new(RateLimit::default());
    /// The shown canvas as `canvas.json` last read, to know which files are its artboards.
    /// Replaced whenever the frontend hands the wrapper a state, since it read the canvas again.
    static CANVAS_BOARDS: RefCell<Option<(ShownCanvas, Canvas)>> = const { RefCell::new(None) };
    /// The last state asked for, with its canvas, as the script that applies it. Kept across
    /// views of the same canvas, and run again once such a view has loaded.
    static CANVAS_STATE: RefCell<Option<(ShownCanvas, String)>> = const { RefCell::new(None) };
    /// The generation canvas marks were last run in, so only that view may say which an
    /// artboard could not find.
    static CANVAS_MARKS_SENT: Cell<u64> = const { Cell::new(0) };
    /// The last state asked for a motion, as the script that applies it, run again once a view of
    /// that motion has loaded.
    static MOTION_STATE: RefCell<Option<(ShownMotion, String)>> = const { RefCell::new(None) };
}

/// Changes what decides the view's visibility and applies it. Main thread only.
fn update_display(change: impl FnOnce(Display) -> Display) {
    let display = change(DISPLAY.get());
    DISPLAY.set(display);
    VIEW.with(|slot| {
        if let Some((view, _)) = slot.borrow().as_ref() {
            let _ = view.set_visible(is_visible(display));
        }
    });
}

/// Marks the view of `generation` as loaded, if it is still the one shown, and
/// gives its page the comment mode and marks it should have. Main thread only.
fn mark_loaded(generation: u64) {
    if GENERATION.get() == generation {
        update_display(|display| Display {
            is_loaded: true,
            ..display
        });
        apply_page_state();
        apply_canvas_state();
        apply_motion_state();
    }
}

/// What the view on screen shows. Main thread only.
fn shown_view() -> Option<ShownView> {
    VIEW.with(|slot| slot.borrow().as_ref().map(|(_, shown)| shown.clone()))
}

/// The page the view on screen shows, when it shows a page. Main thread only.
fn shown_page() -> Option<ShownPage> {
    match shown_view()? {
        ShownView::Page(page) => Some(page),
        ShownView::Canvas(_) | ShownView::Motion(_) => None,
    }
}

/// The canvas the view on screen shows, when it shows one. Main thread only.
fn shown_canvas() -> Option<ShownCanvas> {
    match shown_view()? {
        ShownView::Canvas(canvas) => Some(canvas),
        ShownView::Page(_) | ShownView::Motion(_) => None,
    }
}

/// What a wrapper is told once it has loaded: the last state asked for its canvas, then its
/// comment mode, which may have been turned on while it loaded. The mode is sent on or off,
/// so running these twice says the same thing twice.
fn canvas_load_scripts(state: Option<String>, is_commenting: bool) -> Vec<String> {
    state
        .into_iter()
        .chain(std::iter::once(canvas_mode_script(is_commenting)))
        .collect()
}

/// Gives a loaded wrapper the last state asked for its canvas and its comment mode. Main
/// thread only.
fn apply_canvas_state() {
    let Some(canvas) = shown_canvas() else {
        return;
    };
    let state = CANVAS_STATE.with(|state| {
        state
            .borrow()
            .as_ref()
            .filter(|(of, _)| *of == canvas)
            .map(|(_, script)| script.clone())
    });
    for script in canvas_load_scripts(state, COMMENTING.get()) {
        evaluate(&script);
    }
}

/// Runs one of `page_script.rs`'s fixed calls in the view on screen. Main thread only.
fn evaluate(script: &str) {
    VIEW.with(|slot| {
        if let Some((view, _)) = slot.borrow().as_ref() {
            let _ = view.evaluate_script(script);
        }
    });
}

/// Runs the stored marks when they are for the page on screen. Main thread only.
fn run_marks(page: &ShownPage) {
    let script = MARKS.with(|marks| {
        marks
            .borrow()
            .as_ref()
            .filter(|(marked, _)| marked == page)
            .map(|(_, marks)| marks_script(marks))
    });
    if let Some(script) = script {
        evaluate(&script);
        MARKS_SENT.set(GENERATION.get());
    }
}

/// Gives a loaded page its comment mode and marks. Main thread only.
fn apply_page_state() {
    let Some(page) = shown_page() else {
        return;
    };
    if COMMENTING.get() {
        evaluate(&mode_script(true));
    }
    run_marks(&page);
}

/// Counts a message of the view of `generation` and says whether to read it; a view that
/// floods is ended. Main thread only.
fn admits(app: &AppHandle, generation: u64, body: &str) -> bool {
    if GENERATION.get() != generation {
        return false;
    }
    match FLOOD.with(|flood| flood.borrow_mut().admit(body.len(), Instant::now())) {
        Intake::Read => true,
        Intake::Drop => false,
        Intake::EndPage => {
            // Not from inside the view's own handler: the end runs once this call has returned.
            let _ = app.run_on_main_thread(move || {
                if GENERATION.get() == generation {
                    end_current();
                }
            });
            false
        }
    }
}

/// What the canvas view sent, read by `canvas_intake`: the wrapper's kinds only from its own
/// frame, a comment pick only from an artboard of this canvas. Main thread only.
fn on_canvas_message(app: &AppHandle, generation: u64, frame_url: &str, body: &str) {
    if !admits(app, generation, body) {
        return;
    }
    let Some(shown) = shown_canvas() else {
        return;
    };
    let state = ViewState {
        is_commenting: COMMENTING.get(),
        has_marks: CANVAS_MARKS_SENT.get() == generation,
    };
    let intake = CANVAS_BOARDS.with(|boards| {
        let boards = boards.borrow();
        let canvas = boards
            .as_ref()
            .filter(|(of, _)| *of == shown)
            .map(|(_, canvas)| canvas);
        RATE.with(|rate| {
            SHELL_RATE.with(|shell_rate| {
                canvas_intake(
                    frame_url,
                    body,
                    &shown,
                    canvas,
                    state,
                    &mut rate.borrow_mut(),
                    &mut shell_rate.borrow_mut(),
                    Instant::now(),
                )
            })
        })
    });
    match intake {
        CanvasIntake::Shell(message) => {
            let _ = app.emit(CANVAS_VIEW, view_event(&shown, &message));
        }
        CanvasIntake::Board {
            artboard_id,
            message,
        } => {
            if message.takes_keyboard() {
                focus_zorvo(app);
            }
            let _ = app.emit(CANVAS_PICK, pick_event(&shown, &artboard_id, &message));
        }
        CanvasIntake::Refused => {}
    }
}

/// What the page sent, once `picks.rs` accepts it, goes to the main webview with
/// the page it came from. Main thread only (wry calls the handler there).
fn on_page_message(app: &AppHandle, generation: u64, body: &str) {
    if !admits(app, generation, body) {
        return;
    }
    let Some(page) = shown_page() else {
        return;
    };
    let state = ViewState {
        is_commenting: COMMENTING.get(),
        has_marks: MARKS_SENT.get() == generation,
    };
    let is_current = GENERATION.get() == generation;
    let message = RATE.with(|rate| {
        accepted_message(
            body,
            is_current,
            state,
            &mut rate.borrow_mut(),
            Instant::now(),
        )
    });
    if let Some(message) = message {
        if message.takes_keyboard() {
            focus_zorvo(app);
        }
        let _ = app.emit(
            ARTIFACT_PAGE_PICK,
            PagePickEvent {
                session_id: page.session_id,
                artifact_id: page.artifact_id,
                version: page.version,
                message,
            },
        );
    }
}

/// Gives the keyboard to Zorvo's own webview, so the comment the user writes after a pick goes
/// to the comment box and never to the page, which keeps it while it is the first responder.
fn focus_zorvo(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.with_webview(|webview| {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let view = webview.inner().cast::<AnyObject>();
        let ns_window = webview.ns_window().cast::<AnyObject>();
        if view.is_null() || ns_window.is_null() {
            return;
        }
        // SAFETY: `with_webview` runs this on the main thread, and both pointers are the live
        // main WKWebView and its NSWindow, checked non-null above; `makeFirstResponder:` takes
        // one view of that window and returns a BOOL.
        unsafe {
            let _: bool = msg_send![&*ns_window, makeFirstResponder: &*view];
        }
    });
}

/// Whether the view shows something of `session_id` (and, when one is named, that artifact or
/// canvas: artifact ids and canvas keys never look alike).
pub fn is_showing(shown: Option<&ShownView>, session_id: &str, artifact_id: Option<&str>) -> bool {
    let (session, id) = match shown {
        Some(ShownView::Page(page)) => (&page.session_id, &page.artifact_id),
        Some(ShownView::Canvas(canvas)) => (&canvas.session_id, &canvas.key),
        Some(ShownView::Motion(motion)) => (&motion.session_id, &motion.key),
        None => return false,
    };
    session == session_id && artifact_id.is_none_or(|wanted| id == wanted)
}

/// Ends a view: its page's process first, then the view.
///
/// Dropping a `wry::WebView` only takes it out of the window: wry keeps the
/// `WKWebView` alive on purpose, so its web content process would go on
/// running, and a page that loops would hold a core until Zorvo quit (seen in
/// the spike: 98% of a core, 16 s after the drop). WebKit has no public call
/// that ends the process of a page that does not yield, so this asks for it by
/// the name WebKit's own tools use, and only when the view answers to it; on a
/// macOS where it does not, the page is merely hidden, as before.
pub(crate) fn end(view: wry::WebView) {
    use objc2::{msg_send, sel};
    use wry::WebViewExtMacOS;
    let webview = view.webview();
    // SAFETY: both messages go to a live WKWebView on the main thread (every
    // caller runs there), and the second is sent only when the first says the
    // object answers it; it takes no arguments and returns nothing.
    unsafe {
        let responds: bool = msg_send![&*webview, respondsToSelector: sel!(_killWebContentProcess)];
        if responds {
            let _: () = msg_send![&*webview, _killWebContentProcess];
        }
    }
    drop(view);
}

/// Takes the view out of its slot and ends it. Main thread only.
fn end_current() {
    if let Some((view, _)) = VIEW.with(|slot| slot.borrow_mut().take()) {
        end(view);
    }
}

/// A rectangle in the main window, in logical points from its top-left corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// `bounds` clipped to a window of the given size, or `None` when a number is
/// not finite, the size is not positive, or nothing of it is inside the window.
pub fn checked_bounds(bounds: Bounds, window_width: f64, window_height: f64) -> Option<Bounds> {
    let numbers = [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        window_width,
        window_height,
    ];
    if numbers.iter().any(|n| !n.is_finite()) || bounds.width <= 0.0 || bounds.height <= 0.0 {
        return None;
    }
    let left = bounds.x.max(0.0);
    let top = bounds.y.max(0.0);
    let right = (bounds.x + bounds.width).min(window_width);
    let bottom = (bounds.y + bounds.height).min(window_height);
    (right > left && bottom > top).then_some(Bounds {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

fn rect(bounds: Bounds) -> wry::Rect {
    wry::Rect {
        position: wry::dpi::LogicalPosition::new(bounds.x, bounds.y).into(),
        size: wry::dpi::LogicalSize::new(bounds.width, bounds.height).into(),
    }
}

/// Shows the page at `url` in a new webview at `bounds`, ending any earlier one.
pub fn show(
    app: &AppHandle,
    served: Arc<Served>,
    page: ShownPage,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    show_view(app, served, ShownView::Page(page), url, bounds)
}

/// Shows a canvas through Zorvo's wrapper in a new webview at `bounds`, ending any earlier one.
/// The comment script runs in every frame, so it reaches the artboards; only the wrapper's
/// URL, once, and the canvas's own files may be loaded.
pub fn show_canvas(
    app: &AppHandle,
    served: Arc<Served>,
    canvas: ShownCanvas,
    bounds: Bounds,
) -> Result<(), String> {
    let url = canvas_shell_url(&canvas.session_id, &canvas.key);
    show_view(app, served, ShownView::Canvas(canvas), url, bounds)
}

/// Keeps `state_json` (one JSON object of at most 1 MiB) for `canvas` and hands it to the
/// wrapper now when that canvas is shown and loaded; a view of it made or loaded later gets it
/// then, so a state sent before its view exists is not lost.
pub fn apply_canvas(
    app: &AppHandle,
    canvas: ShownCanvas,
    boards: Option<Canvas>,
    state_json: String,
) -> Result<(), String> {
    let script = apply_script(&state_json).ok_or_else(|| COULD_NOT_SHOW.to_string())?;
    let _ = app.run_on_main_thread(move || {
        let is_shown = shown_canvas().as_ref() == Some(&canvas);
        CANVAS_BOARDS.with(|slot| {
            *slot.borrow_mut() = boards.map(|boards| (canvas.clone(), boards));
        });
        CANVAS_STATE.with(|state| *state.borrow_mut() = Some((canvas, script.clone())));
        if is_shown && DISPLAY.get().is_loaded {
            evaluate(&script);
        }
    });
    Ok(())
}

/// The motion the view on screen shows, when it shows one. Main thread only.
fn shown_motion() -> Option<ShownMotion> {
    match shown_view()? {
        ShownView::Motion(motion) => Some(motion),
        ShownView::Page(_) | ShownView::Canvas(_) => None,
    }
}

/// Hands the motion wrapper on screen the last state asked for it. Main thread only.
fn apply_motion_state() {
    let Some(motion) = shown_motion() else {
        return;
    };
    let script = MOTION_STATE.with(|state| {
        state
            .borrow()
            .as_ref()
            .filter(|(of, _)| *of == motion)
            .map(|(_, script)| script.clone())
    });
    if let Some(script) = script {
        evaluate(&script);
    }
}

/// Shows a motion through Zorvo's preview wrapper in a new webview at `bounds`, ending any
/// earlier one. The motion runtime runs in every frame; only the wrapper and that motion's files
/// may be loaded.
pub fn show_motion(
    app: &AppHandle,
    served: Arc<Served>,
    motion: ShownMotion,
    bounds: Bounds,
) -> Result<(), String> {
    let url = super::motion_protocol::motion_shell_url(&motion.session_id, &motion.key);
    show_view(app, served, ShownView::Motion(motion), url, bounds)
}

/// Keeps `script` (the wrapper's `apply`) for `motion` and runs it now when that motion is shown
/// and loaded; a view of it made or loaded later gets it then.
pub fn apply_motion(app: &AppHandle, motion: ShownMotion, script: String) {
    let _ = app.run_on_main_thread(move || {
        let is_shown = shown_motion().as_ref() == Some(&motion);
        MOTION_STATE.with(|state| *state.borrow_mut() = Some((motion, script.clone())));
        if is_shown && DISPLAY.get().is_loaded {
            evaluate(&script);
        }
    });
}

/// Runs one wrapper command (built from a fixed list) while that motion is shown and loaded.
pub fn motion_command(app: &AppHandle, motion: ShownMotion, script: String) {
    let _ = app.run_on_main_thread(move || {
        if shown_motion().as_ref() == Some(&motion) && DISPLAY.get().is_loaded {
            evaluate(&script);
        }
    });
}

/// Runs one of the wrapper's commands, only while that canvas is shown and loaded; a name
/// outside the list is refused.
pub fn canvas_command(app: &AppHandle, canvas: ShownCanvas, name: String) -> Result<(), String> {
    let script = command_script(&name).ok_or_else(|| COULD_NOT_SHOW.to_string())?;
    let _ = app.run_on_main_thread(move || {
        if shown_canvas().as_ref() == Some(&canvas) && DISPLAY.get().is_loaded {
            evaluate(&script);
        }
    });
    Ok(())
}

fn show_view(
    app: &AppHandle,
    served: Arc<Served>,
    shown: ShownView,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let (sent, received) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        // Ended first: a stuck page stops here, before its replacement exists.
        end_current();
        let generation = GENERATION.get() + 1;
        GENERATION.set(generation);
        DISPLAY.set(Display::default());
        COMMENTING.set(false);
        RATE.with(|rate| *rate.borrow_mut() = RateLimit::default());
        SHELL_RATE.with(|rate| *rate.borrow_mut() = RateLimit::default());
        FLOOD.with(|flood| *flood.borrow_mut() = FloodGuard::default());
        let messages = handle.clone();
        let built = handle
            .get_webview_window(MAIN_WINDOW)
            .ok_or(())
            .and_then(|window| {
                let builder = match shown.clone() {
                    ShownView::Page(_) => wry::WebViewBuilder::new()
                        .with_initialization_script(PAGE_SCRIPT)
                        .with_ipc_handler(move |request| {
                            on_page_message(&messages, generation, request.body())
                        })
                        .with_navigation_handler(|url| is_allowed_navigation(&url)),
                    ShownView::Canvas(canvas) => {
                        let navigation = RefCell::new(CanvasNavigation::default());
                        let rule = canvas.clone();
                        wry::WebViewBuilder::new()
                            .with_initialization_script_for_main_only(PAGE_SCRIPT, false)
                            .with_ipc_handler(move |request| {
                                let frame = request.uri().to_string();
                                on_canvas_message(&messages, generation, &frame, request.body())
                            })
                            .with_navigation_handler(move |url| {
                                navigation.borrow_mut().allows(&url, &rule)
                            })
                    }
                    ShownView::Motion(motion) => wry::WebViewBuilder::new()
                        .with_initialization_script_for_main_only(
                            super::motion_protocol::MOTION_RUNTIME,
                            false,
                        )
                        .with_navigation_handler(move |url| {
                            super::motion_protocol::is_allowed_motion_navigation(
                                &url,
                                &motion.session_id,
                                &motion.key,
                            )
                        }),
                };
                builder
                    .with_incognito(true)
                    .with_visible(false)
                    .with_on_page_load_handler(move |event, _url| {
                        if matches!(event, wry::PageLoadEvent::Finished) {
                            mark_loaded(generation);
                        }
                    })
                    .with_bounds(rect(bounds))
                    .with_custom_protocol(SCHEME.to_string(), move |_id, request| {
                        respond(
                            &served,
                            request.method().as_str(),
                            &request.uri().to_string(),
                        )
                        .map(Cow::from)
                    })
                    .with_url(url)
                    .build_as_child(&window)
                    .map_err(|_| ())
            });
        let shown = built.map(|view| VIEW.with(|slot| *slot.borrow_mut() = Some((view, shown))));
        if shown.is_ok() {
            let later = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY_AFTER);
                let _ = later.run_on_main_thread(move || mark_loaded(generation));
            });
        }
        let _ = sent.send(shown);
    })
    .map_err(|_| COULD_NOT_SHOW.to_string())?;
    received
        .recv()
        .map_err(|_| ())
        .and_then(|shown| shown)
        .map_err(|()| COULD_NOT_SHOW.to_string())
}

/// Moves the view to `bounds`; with none (the box is outside the window) the
/// view stays where it was and is not drawn.
pub fn set_bounds(app: &AppHandle, bounds: Option<Bounds>) {
    let _ = app.run_on_main_thread(move || {
        if let Some(bounds) = bounds {
            VIEW.with(|slot| {
                if let Some((view, _)) = slot.borrow().as_ref() {
                    let _ = view.set_bounds(rect(bounds));
                }
            });
        }
        update_display(|display| with_place(display, bounds));
    });
}

/// Hides the page while something of Zorvo's must draw where it is: a native
/// webview is above the main webview's HTML.
pub fn set_hidden(app: &AppHandle, hidden: bool) {
    let _ = app.run_on_main_thread(move || {
        update_display(|display| Display {
            is_hidden: hidden,
            ..display
        });
    });
}

/// Turns comment mode on or off in the view, only when it shows `page`.
pub fn set_comment_mode(app: &AppHandle, page: ShownPage, on: bool) {
    let _ = app.run_on_main_thread(move || {
        if shown_page().as_ref() != Some(&page) {
            return;
        }
        COMMENTING.set(on);
        if DISPLAY.get().is_loaded {
            evaluate(&mode_script(on));
        }
    });
}

/// Turns comment mode on or off for the canvas view, only when it shows `canvas`: the intake
/// reads it, and the wrapper passes it on to each live artboard's frame.
pub fn set_canvas_comment_mode(app: &AppHandle, canvas: ShownCanvas, on: bool) {
    let _ = app.run_on_main_thread(move || {
        if shown_canvas().as_ref() != Some(&canvas) {
            return;
        }
        COMMENTING.set(on);
        if DISPLAY.get().is_loaded {
            evaluate(&canvas_mode_script(on));
        }
    });
}

const COULD_NOT_MARK_ARTBOARD: &str = "Zorvo could not mark that artboard.";

/// Has the wrapper post `marks` to one artboard of `canvas`, only while that canvas is shown and
/// loaded. Nothing is kept: the wrapper says when each live artboard loads, and the frontend
/// sends that artboard's marks then.
pub fn set_canvas_marks(
    app: &AppHandle,
    canvas: ShownCanvas,
    artboard_id: String,
    marks: Vec<PageMark>,
) -> Result<(), String> {
    let script = canvas_marks_script(&artboard_id, &marks)
        .ok_or_else(|| COULD_NOT_MARK_ARTBOARD.to_string())?;
    let _ = app.run_on_main_thread(move || {
        if shown_canvas().as_ref() == Some(&canvas) && DISPLAY.get().is_loaded {
            evaluate(&script);
            CANVAS_MARKS_SENT.set(GENERATION.get());
        }
    });
    Ok(())
}

/// Keeps `marks` for `page`, and runs them now when the view shows that page
/// and it has loaded; a page still loading gets them once it has.
pub fn set_marks(app: &AppHandle, page: ShownPage, marks: Vec<PageMark>) {
    let _ = app.run_on_main_thread(move || {
        let is_shown = shown_page().as_ref() == Some(&page);
        MARKS.with(|stored| *stored.borrow_mut() = Some((page.clone(), marks)));
        if is_shown && DISPLAY.get().is_loaded {
            run_marks(&page);
        }
    });
}

pub fn close(app: &AppHandle) {
    let _ = app.run_on_main_thread(end_current);
}

/// Native observations for the explicit browser integration harness, never IPC.
#[cfg(all(target_os = "macos", debug_assertions))]
pub(crate) async fn smoke_state(app: &AppHandle) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use wry::WebViewExtMacOS;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let state = VIEW.with(|slot| {
            let view = slot.borrow();
            let Some((view, _)) = view.as_ref() else {
                return json!({"exists":false});
            };
            // SAFETY: the retained WKWebView is inspected on its main thread.
            unsafe {
                let native = view.webview();
                let frame = native.frame();
                json!({"exists":true,"hidden":native.isHidden(),"loading":native.isLoading(),
                    "loaded":DISPLAY.get().is_loaded,
                    "url":native.URL().and_then(|url|url.absoluteString()).map(|url|url.to_string()),
                    "bounds":{"x":frame.origin.x,"y":frame.origin.y,
                        "width":frame.size.width,"height":frame.size.height}})
            }
        });
        let _ = send.send(state);
    }).map_err(|_| "The artifact main thread is unavailable.")?;
    tokio::time::timeout(std::time::Duration::from_secs(3), receive)
        .await
        .map_err(|_| "Native artifact inspection timed out.")?
        .map_err(|_| "Native artifact inspection was cancelled.".into())
}

/// Closes the view only when it shows a page of `session_id` (and of
/// `artifact_id` when one is named): what is deleted must not stay on screen,
/// and nothing else may be taken off it.
pub fn close_for(app: &AppHandle, session_id: String, artifact_id: Option<String>) {
    let _ = app.run_on_main_thread(move || {
        let is_shown = VIEW.with(|slot| {
            is_showing(
                slot.borrow().as_ref().map(|(_, shown)| shown),
                &session_id,
                artifact_id.as_deref(),
            )
        });
        if is_shown {
            end_current();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn bounds_inside_the_window_are_kept() {
        let inside = bounds(800.0, 100.0, 560.0, 700.0);

        assert_eq!(checked_bounds(inside, 1440.0, 900.0), Some(inside));
    }

    #[test]
    fn bounds_must_be_finite_and_positive() {
        for bad in [
            bounds(f64::NAN, 0.0, 10.0, 10.0),
            bounds(0.0, f64::INFINITY, 10.0, 10.0),
            bounds(0.0, 0.0, f64::NAN, 10.0),
            bounds(0.0, 0.0, 10.0, f64::NEG_INFINITY),
            bounds(0.0, 0.0, 0.0, 10.0),
            bounds(0.0, 0.0, 10.0, -5.0),
        ] {
            assert_eq!(checked_bounds(bad, 1440.0, 900.0), None, "{bad:?}");
        }
        assert_eq!(
            checked_bounds(bounds(0.0, 0.0, 10.0, 10.0), f64::NAN, 900.0),
            None
        );
    }

    #[test]
    fn bounds_are_clipped_to_the_window() {
        let over = bounds(-20.0, 850.0, 200.0, 100.0);

        assert_eq!(
            checked_bounds(over, 1440.0, 900.0),
            Some(bounds(0.0, 850.0, 180.0, 50.0))
        );
    }

    #[test]
    fn bounds_outside_the_window_are_refused() {
        assert_eq!(
            checked_bounds(bounds(1500.0, 0.0, 100.0, 100.0), 1440.0, 900.0),
            None
        );
        assert_eq!(
            checked_bounds(bounds(0.0, -300.0, 100.0, 100.0), 1440.0, 900.0),
            None
        );
    }

    #[test]
    fn a_view_is_closed_only_for_what_it_shows() {
        let page = ShownPage {
            session_id: "s-1".to_string(),
            artifact_id: "a-0123456789abcdef".to_string(),
            version: 1,
        };

        let page = ShownView::Page(page);
        // Deleting the session it belongs to, or the artifact it shows, closes it.
        assert!(is_showing(Some(&page), "s-1", None));
        assert!(is_showing(Some(&page), "s-1", Some("a-0123456789abcdef")));
        // Deleting another session, or another artifact of the same session, does not.
        assert!(!is_showing(Some(&page), "s-2", None));
        assert!(!is_showing(Some(&page), "s-1", Some("a-ffffffffffffffff")));
        assert!(!is_showing(Some(&page), "s-2", Some("a-0123456789abcdef")));
        assert!(!is_showing(None, "s-1", None));
    }

    #[test]
    fn a_loaded_wrapper_gets_its_state_and_the_comment_mode_asked_for_before() {
        let state = Some("window.__zorvoCanvas.apply({});".to_string());

        // Comment mode turned on while the wrapper loaded reaches it once it has.
        assert_eq!(
            canvas_load_scripts(state.clone(), true),
            [
                "window.__zorvoCanvas.apply({});".to_string(),
                canvas_mode_script(true)
            ]
        );
        // Off is sent too, so a second load (`mark_loaded` may run twice) says the same thing.
        assert_eq!(
            canvas_load_scripts(None, false),
            [canvas_mode_script(false)]
        );
        assert_eq!(
            canvas_load_scripts(state.clone(), true),
            canvas_load_scripts(state, true)
        );
    }

    #[test]
    fn close_for_closes_a_canvas_of_that_session_only() {
        let canvas = ShownView::Canvas(ShownCanvas {
            session_id: "s-1".to_string(),
            key: "c-0123456789abcdef".to_string(),
        });

        // Deleting its session, or forgetting the canvas, closes it.
        assert!(is_showing(Some(&canvas), "s-1", None));
        assert!(is_showing(Some(&canvas), "s-1", Some("c-0123456789abcdef")));
        // Another session, another canvas, or a page of the same session does not.
        assert!(!is_showing(Some(&canvas), "s-2", None));
        assert!(!is_showing(
            Some(&canvas),
            "s-1",
            Some("c-ffffffffffffffff")
        ));
        assert!(!is_showing(
            Some(&canvas),
            "s-1",
            Some("a-0123456789abcdef")
        ));
    }

    #[test]
    fn a_page_shows_once_it_has_loaded_and_nothing_covers_it() {
        // Made invisible, so a dark window never flashes the webview's white before the page paints.
        assert!(!is_visible(Display {
            is_loaded: false,
            is_hidden: false,
            is_outside: false
        }));
        assert!(is_visible(Display {
            is_loaded: true,
            is_hidden: false,
            is_outside: false
        }));
        assert!(!is_visible(Display {
            is_loaded: true,
            is_hidden: true,
            is_outside: false
        }));
        assert!(!is_visible(Display {
            is_loaded: false,
            is_hidden: true,
            is_outside: false
        }));
    }

    #[test]
    fn a_page_whose_box_left_the_window_is_kept_but_not_drawn() {
        let outside = with_place(
            Display {
                is_loaded: true,
                is_hidden: false,
                is_outside: false,
            },
            None,
        );

        assert!(!is_visible(outside));
        // The box coming back shows the same page again.
        assert!(is_visible(with_place(
            outside,
            Some(bounds(0.0, 0.0, 10.0, 10.0))
        )));
    }

    #[test]
    fn the_lockfile_holds_one_wry() {
        let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.lock"))
            .expect("read Cargo.lock");

        let count = lock.matches("\nname = \"wry\"\n").count();

        assert_eq!(count, 1, "wry must stay at the version Tauri uses");
    }
}
