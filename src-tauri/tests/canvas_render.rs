//! Draws a fixture artboard through `artifacts::render` in a real Tauri app and checks the
//! pictures, the PDF, and three PDFs joined into one (`join_pdfs`). `harness = false`: libtest
//! runs every test on a thread of its own, and Tauri's event loop can only be made on the
//! process's main thread, which `main` is here.
//!
//! It also shows the 40-artboard fixture through the canvas view (`view::show_canvas`) and checks
//! the two wry facts the canvas rests on: the comment script runs inside the artboards' frames,
//! and wry hands every message the URL of the frame that posted it, so an artboard's message is
//! read as that artboard's, and never as the wrapper's (`canvas_view::canvas_intake`). It watches
//! the real `canvas-pick` and `canvas-view` events; a refusal emits nothing, so each refused
//! message is followed by one the backend must accept, and only that one may arrive.
//!
//! It needs a window server, so it skips unless `ZORVO_RENDER_TEST=1`:
//! `ZORVO_RENDER_TEST=1 cargo test --test canvas_render`.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{Listener, Manager};

use zorvo_lib::artifacts::canvas_view::{ShownCanvas, CANVAS_PICK, CANVAS_VIEW};
use zorvo_lib::artifacts::commands::{show_canvas, CanvasRead};
use zorvo_lib::artifacts::ds_commands::show_design_system;
use zorvo_lib::artifacts::ds_protocol::ds_file_url;
use zorvo_lib::artifacts::ds_view::{ds_apply_script, ShownDesignSystem, DS_VIEW};
use zorvo_lib::artifacts::protocol::{canvas_file_url, canvas_themed_file_url, Served};
use zorvo_lib::artifacts::render::{
    join_pdfs, pdf_page_sizes, render_pdf, snapshot_png, snapshot_visual_png, RENDER_FAILED,
};
use zorvo_lib::artifacts::store::ArtifactStore;
use zorvo_lib::artifacts::view::{self, Bounds};
use zorvo_lib::artifacts::visual_wrapper::Theme;

const SESSION: &str = "session-1794800000000-k3x9a";
/// The whole test, launch included; a hang fails it.
const DEADLINE: Duration = Duration::from_secs(120);
const CANVAS_JSON: &str = r#"{"version":1,"title":"Probe","sections":[{"id":"s","title":"S",
    "artboards":[{"id":"a","title":"A","file":"a.html","width":1440,"height":900}]}]}"#;
const ARTBOARD: &str = r#"<!doctype html><html><body style="margin:0;background:#1d4ed8">
<div style="position:absolute;left:100px;top:100px;width:400px;height:300px;background:#f97316"></div>
<canvas id="c" width="300" height="200" style="position:absolute;left:800px;top:400px"></canvas>
<script>const x=document.getElementById('c').getContext('2d');x.fillStyle='#22c55e';x.fillRect(0,0,300,200);</script>
</body></html>"#;

fn png_size(png: &[u8]) -> (u32, u32) {
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"), "not a PNG");
    let number = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
    (number(16), number(20))
}

/// The page count and the first page's box of a PDF WebKit wrote.
fn pdf_pages(pdf: &[u8]) -> (usize, String) {
    let text = String::from_utf8_lossy(pdf);
    let pages = text
        .match_indices("/Type /Page")
        .filter(|(at, _)| !text[at + "/Type /Page".len()..].starts_with('s'))
        .count();
    let media_box = text
        .split("MediaBox")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .map(|inside| inside.trim_start_matches([' ', '[']).to_string())
        .unwrap_or_default();
    (pages, media_box)
}

fn fixture(folder: &Path) -> (Arc<Served>, String) {
    let work = folder.join("work");
    std::fs::create_dir_all(work.join("design")).expect("fixture folder");
    std::fs::write(work.join("design/canvas.json"), CANVAS_JSON).expect("canvas.json");
    std::fs::write(work.join("design/a.html"), ARTBOARD).expect("artboard");
    let work = std::fs::canonicalize(work).expect("canonical fixture");
    let store = Arc::new(ArtifactStore::new(folder.join("artifacts")));
    let read = show_canvas(
        &store,
        |_| true,
        SESSION,
        work.to_str().expect("utf-8"),
        "design",
        1,
    )
    .expect("show the fixture canvas");
    let served = Arc::new(Served {
        store,
        thumbs: folder.join("thumbs"),
        is_known: Arc::new(|_| true),
    });
    (served, canvas_file_url(SESSION, &read.entry.key, "a.html"))
}

fn check(app: &tauri::AppHandle, folder: &Path) {
    let (served, url) = fixture(folder);
    for (out_width, expected) in [(1440, (1440, 900)), (720, (720, 450))] {
        let png = snapshot_png(app, Arc::clone(&served), url.clone(), 1440, 900, out_width)
            .expect("draw the artboard");
        assert_eq!(png_size(&png), expected, "PNG at out_width {out_width}");
        println!(
            "png out_width={out_width}: {expected:?}, {} bytes",
            png.len()
        );
    }
    let pdf = render_pdf(app, Arc::clone(&served), url.clone(), 1440, 900).expect("make the PDF");
    let (pages, media_box) = pdf_pages(&pdf);
    assert_eq!(pages, 1, "PDF pages");
    assert_eq!(media_box, "0 0 1440 900", "PDF page box");
    println!(
        "pdf: {pages} page, MediaBox [{media_box}], {} bytes",
        pdf.len()
    );
    let sizes = [(1440, 900), (390, 844), (800, 600)];
    let pages = sizes
        .iter()
        .map(|&(width, height)| {
            render_pdf(app, Arc::clone(&served), url.clone(), width, height).expect("make a page")
        })
        .collect();
    let joined = join_pdfs(pages).expect("join the pages");
    let joined_sizes = pdf_page_sizes(&joined).expect("read the joined PDF");
    let expected: Vec<(f64, f64)> = sizes
        .iter()
        .map(|&(width, height)| (f64::from(width), f64::from(height)))
        .collect();
    assert_eq!(
        joined_sizes, expected,
        "joined pages, in order, at their sizes"
    );
    println!(
        "joined pdf: {} pages {joined_sizes:?}, {} bytes",
        joined_sizes.len(),
        joined.len()
    );
    // An inline visual: drawn through its own route, twice as many pixels wide as its block,
    // and painted on the theme's sheet colour (a visual's own background is transparent).
    let visual = served
        .store
        .put_visual(SESSION, "Flow", b"<svg viewBox=\"0 0 10 5\" width=\"600\"><rect width=\"10\" height=\"5\" fill=\"var(--chip)\"/></svg>", 1)
        .expect("keep the visual");
    let mut pictures = Vec::new();
    for (theme, name) in [(Theme::Dark, "dark"), (Theme::Light, "light")] {
        let png = snapshot_visual_png(
            app,
            Arc::clone(&served),
            SESSION,
            &visual.id,
            theme,
            600,
            300,
        )
        .expect("draw the visual");
        assert_eq!(png_size(&png), (1200, 600), "visual PNG, {name}");
        println!("visual png {name}: {} bytes", png.len());
        pictures.push(png);
    }
    assert_ne!(
        pictures[0], pictures[1],
        "the two themes draw different pictures"
    );
    let gone = snapshot_visual_png(
        app,
        Arc::clone(&served),
        SESSION,
        "v-0000000000000000",
        Theme::Dark,
        600,
        300,
    );
    assert_eq!(
        gone,
        Err(RENDER_FAILED.to_string()),
        "a visual that does not exist"
    );
    let refused = snapshot_png(app, served, "https://example.com/".into(), 1440, 900, 720);
    assert_eq!(
        refused,
        Err(RENDER_FAILED.to_string()),
        "a URL outside the canvas"
    );
    println!("a URL outside the canvas: refused");
}

const CANVAS_40: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/canvas-40");
/// The canvas view's box: the main window's own size, as the inspector would never give it, so
/// the focused artboard and its neighbour are both in view.
const CANVAS_BOUNDS: Bounds = Bounds {
    x: 0.0,
    y: 0.0,
    width: 1200.0,
    height: 800.0,
};
/// How long a message that must not arrive is waited for.
const QUIET: Duration = Duration::from_secs(2);

/// Added to `overview-1.html`: when the wrapper relays comment mode, it clicks a button. The
/// comment script's own relay listener, registered first, has turned its mode on by then, so the
/// comment script itself reports the pick.
const PICK_PROBE: &str = r#"<button id="probe-target" style="position:absolute;left:40px;top:40px">Probe</button>
<script>
window.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.zorvo !== "mode" || data.on !== true) return;
  document.getElementById("probe-target").click();
});
</script>"#;

/// Added to `overview-2.html`: when comment mode is relayed, it says what the wrapper says, as the
/// page itself, then moves its own URL to the wrapper's path and says it again, then clicks a
/// button named by whether that move happened, so the comment script reports from this frame.
const SHELL_PROBE: &str = r#"<button id="replaced" style="position:absolute;left:40px;top:40px">Replaced</button>
<button id="replace-refused" style="position:absolute;left:40px;top:80px">Refused</button>
<script>
window.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.zorvo !== "mode" || data.on !== true) return;
  var handler = window.webkit.messageHandlers.ipc;
  handler.postMessage(JSON.stringify({ kind: "canvas-select", artboardId: "from-board" }));
  var moved = true;
  try { history.replaceState(null, "", location.pathname.replace(/f\/.*$/, "")); } catch (e) { moved = false; }
  handler.postMessage(JSON.stringify({ kind: "canvas-select", artboardId: "from-replaced" }));
  window.__zorvoCommentMode(true);
  document.getElementById(moved ? "replaced" : "replace-refused").click();
});
</script>"#;

/// The fixture canvas copied into a scratch workspace, with the two probes added.
fn canvas_fixture(folder: &Path) -> (Arc<Served>, CanvasRead) {
    let work = folder.join("canvas-work");
    let design = work.join("design");
    std::fs::create_dir_all(&design).expect("canvas fixture folder");
    for entry in std::fs::read_dir(CANVAS_40).expect("the canvas-40 fixture") {
        let entry = entry.expect("a fixture file");
        let name = entry.file_name().into_string().expect("utf-8 name");
        let mut text = std::fs::read_to_string(entry.path()).expect("fixture text");
        let probe = match name.as_str() {
            "overview-1.html" => Some(PICK_PROBE),
            "overview-2.html" => Some(SHELL_PROBE),
            _ => None,
        };
        if let Some(probe) = probe {
            assert!(text.contains("</body>"), "{name} has a body");
            text = text.replace("</body>", &format!("{probe}\n</body>"));
        }
        std::fs::write(design.join(&name), text).expect("copy the fixture");
    }
    let work = std::fs::canonicalize(work).expect("canonical canvas fixture");
    let store = Arc::new(ArtifactStore::new(folder.join("canvas-artifacts")));
    let read = show_canvas(
        &store,
        |_| true,
        SESSION,
        work.to_str().expect("utf-8"),
        "design",
        2,
    )
    .expect("show the canvas-40 fixture");
    let served = Arc::new(Served {
        store,
        thumbs: folder.join("canvas-thumbs"),
        is_known: Arc::new(|_| true),
    });
    (served, read)
}

/// What the wrapper's `apply` takes, built as `canvasShellState` in `src/lib/canvas.ts` builds it.
fn shell_state(read: &CanvasRead) -> String {
    let canvas = read.canvas.as_ref().expect("the fixture reads");
    let sections: Vec<Value> = canvas
        .sections
        .iter()
        .map(|section| json!({ "id": section.id, "title": section.title }))
        .collect();
    let boards: Vec<Value> = canvas
        .sections
        .iter()
        .flat_map(|section| section.artboards.iter().map(move |board| (section, board)))
        .map(|(section, board)| {
            let sha256 = read
                .boards
                .iter()
                .find(|state| state.id == board.id)
                .and_then(|state| state.sha256.clone())
                .expect("every fixture artboard is servable");
            let url = canvas_file_url(SESSION, &read.entry.key, &board.file);
            json!({
                "id": board.id,
                "section": section.id,
                "group": board.group,
                "title": board.title,
                "width": board.width,
                "height": board.height,
                "url": format!("{url}?v={}&b={}", &sha256[..12], board.id),
            })
        })
        .collect();
    json!({ "sections": sections, "boards": boards, "selected": null }).to_string()
}

/// The canvas events, in the order the backend emitted them, as `(event, payload)`.
fn watch_canvas_events(app: &tauri::AppHandle) -> Receiver<(&'static str, Value)> {
    let (sent, received) = channel();
    for name in [CANVAS_PICK, CANVAS_VIEW] {
        let sent = sent.clone();
        app.listen_any(name, move |event| {
            let payload = serde_json::from_str(event.payload()).unwrap_or(Value::Null);
            let _ = sent.send((name, payload));
        });
    }
    received
}

/// Every event that arrives within `wait`, or up to the first that `done` accepts.
fn events_until(
    events: &Receiver<(&'static str, Value)>,
    wait: Duration,
    done: impl Fn(&str, &Value) -> bool,
) -> Vec<(&'static str, Value)> {
    let until = Instant::now() + wait;
    let mut seen = Vec::new();
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        let Ok((name, payload)) = events.recv_timeout(left) else {
            break;
        };
        let is_done = done(name, &payload);
        seen.push((name, payload));
        if is_done {
            break;
        }
    }
    seen
}

fn is_zoom(name: &str, payload: &Value) -> bool {
    name == CANVAS_VIEW && payload["kind"] == "zoom"
}

fn check_frames(app: &tauri::AppHandle, folder: &Path) {
    let (served, read) = canvas_fixture(folder);
    let canvas = ShownCanvas {
        session_id: SESSION.to_string(),
        key: read.entry.key.clone(),
    };
    let events = watch_canvas_events(app);
    view::show_canvas(app, served, canvas.clone(), CANVAS_BOUNDS).expect("show the canvas view");
    view::apply_canvas(app, canvas.clone(), read.canvas.clone(), shell_state(&read))
        .expect("apply the state");
    // The wrapper fits the canvas on its first state and reports the zoom: it has loaded.
    let loaded = events_until(&events, Duration::from_secs(20), is_zoom);
    assert!(
        loaded
            .last()
            .is_some_and(|(name, payload)| is_zoom(name, payload)),
        "the wrapper never reported its zoom: {loaded:?}"
    );
    // Overview 1 and Overview 2 side by side, at a zoom where artboards are live.
    for name in ["focus:overview-1", "out", "out", "out"] {
        view::canvas_command(app, canvas.clone(), name.to_string()).expect("a wrapper command");
    }
    // Let the live frames load before comment mode is relayed (a frame that loads later is sent
    // it on load, so this only keeps the order of events simple).
    let _ = events_until(&events, QUIET, |_, _| false);

    view::set_canvas_comment_mode(app, canvas.clone(), true);
    let picks = events_until(&events, Duration::from_secs(10), |_, _| false);
    println!(
        "after comment mode: {} events: {:?}",
        picks.len(),
        picks
            .iter()
            .map(|(n, p)| format!("{n} {} {}", p["artboardId"], p["message"]["elementId"]))
            .collect::<Vec<_>>()
    );
    let pick_of = |artboard: &str| {
        picks
            .iter()
            .find(|(name, payload)| *name == CANVAS_PICK && payload["artboardId"] == artboard)
            .map(|(_, payload)| payload["message"].clone())
    };
    let first = pick_of("overview-1").unwrap_or_else(|| {
        panic!(
            "BLOCKED: no canvas-pick from overview-1: the comment script did not run in the \
             artboard's frame, or its message did not reach the intake as that frame's ({picks:?})"
        )
    });
    assert_eq!(first["kind"], "pick-element", "overview-1's pick");
    assert_eq!(
        first["elementId"], "probe-target",
        "overview-1's picked element"
    );
    println!(
        "1. overview-1's own comment script: pick of #probe-target, read as Board(overview-1.html)"
    );

    assert!(
        picks.iter().all(|(name, _)| *name != CANVAS_VIEW),
        "an artboard's canvas-select was read as the wrapper's: {picks:?}"
    );
    println!("2. canvas-select posted by overview-2: refused (no canvas-view)");
    let second = pick_of("overview-2").unwrap_or_else(|| {
        panic!("BLOCKED: no canvas-pick from overview-2 after its replaceState ({picks:?})")
    });
    let moved = second["elementId"] == "replaced";
    println!(
        "3. overview-2 {} its URL to the wrapper's path; its canvas-select after that: refused, \
         and its pick still read as Board(overview-2.html)",
        if moved { "moved" } else { "could not move" }
    );

    // The same kind from the wrapper itself is read (Next selects the artboard in the middle).
    view::canvas_command(app, canvas.clone(), "next".to_string()).expect("Next");
    let from_shell = events_until(&events, Duration::from_secs(10), |name, payload| {
        name == CANVAS_VIEW && payload["kind"] == "select"
    });
    let selected = from_shell
        .iter()
        .find(|(name, payload)| *name == CANVAS_VIEW && payload["kind"] == "select")
        .map(|(_, payload)| payload["artboardId"].clone())
        .unwrap_or_else(|| panic!("the wrapper's canvas-select was not read: {from_shell:?}"));
    assert!(
        selected
            .as_str()
            .is_some_and(|id| id.starts_with("overview-")),
        "the wrapper's selection: {selected}"
    );
    println!("the wrapper's canvas-select: read ({selected})");
    view::close(app);
}

/// The colour of the centre pixel of a PNG.
fn centre(png: &[u8]) -> [u8; 3] {
    let image = image::load_from_memory(png)
        .expect("decode the PNG")
        .to_rgb8();
    let pixel = image.get_pixel(image.width() / 2, image.height() / 2);
    [pixel[0], pixel[1], pixel[2]]
}

fn near(actual: [u8; 3], expected: [u8; 3]) -> bool {
    actual
        .iter()
        .zip(expected)
        .all(|(a, e)| (i16::from(*a) - i16::from(e)).abs() <= 6)
}

/// A design system with two themes and a component, and a canvas that names it: the artboard
/// fills itself with `var(--accent)` from `_ds/tokens.css`, and the preview with the bundle's colour.
fn check_design_system(app: &tauri::AppHandle, folder: &Path) {
    let work = folder.join("ds-work");
    let ds = work.join("ds");
    std::fs::create_dir_all(ds.join("components/Swatch")).expect("system folder");
    std::fs::create_dir_all(work.join("design")).expect("canvas folder");
    std::fs::write(ds.join("design-system.json"), r#"{"title":"Probe"}"#).expect("index");
    std::fs::write(ds.join("README.md"), "# Probe").expect("readme");
    std::fs::write(
        ds.join("tokens.json"),
        r##"{"color":{"themes":[{"id":"dark","name":"Dark"},{"id":"light","name":"Light"}],
        "tokens":[{"name":"accent","value":{"dark":"#1d4ed8","light":"#f97316"},"usage":"Fill."}]}}"##,
    )
    .expect("tokens");
    std::fs::write(
        ds.join("components/bundle.css"),
        ".swatch{position:absolute;inset:0;background:#22c55e}",
    )
    .expect("bundle");
    std::fs::write(
        ds.join("components/Swatch/preview.html"),
        "<!-- @dsCard group=\"Probe\" height=200 -->\n<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0\"><div class=\"swatch\"></div></body></html>",
    )
    .expect("preview");
    std::fs::write(
        work.join("design/canvas.json"),
        r#"{"version":1,"title":"Probe","designSystem":"../ds","sections":[{"id":"s","title":"S","artboards":[{"id":"a","title":"A","file":"a.html","width":400,"height":300}]}]}"#,
    )
    .expect("canvas.json");
    std::fs::write(
        work.join("design/a.html"),
        r#"<!doctype html><html><head><link rel="stylesheet" href="_ds/tokens.css"></head><body style="margin:0;background:var(--accent)"></body></html>"#,
    )
    .expect("artboard");
    let work = std::fs::canonicalize(work).expect("canonical work");
    let cwd = work.to_str().expect("utf-8").to_string();
    let store = Arc::new(ArtifactStore::new(folder.join("ds-artifacts")));
    let canvas =
        show_canvas(&store, |_| true, SESSION, &cwd, "design", 3).expect("show the canvas");
    let system =
        show_design_system(&store, |_| true, SESSION, &cwd, "ds", 3).expect("show the system");
    let served = Arc::new(Served {
        store,
        thumbs: folder.join("ds-thumbs"),
        is_known: Arc::new(|_| true),
    });
    let draw = |url: String, width: u32, height: u32| {
        snapshot_png(app, Arc::clone(&served), url, width, height, width).expect("draw")
    };
    let key = &canvas.entry.key;
    let dark = centre(&draw(
        canvas_themed_file_url(SESSION, key, "dark", "a.html"),
        400,
        300,
    ));
    let light = centre(&draw(
        canvas_themed_file_url(SESSION, key, "light", "a.html"),
        400,
        300,
    ));
    println!("design system artboard: dark {dark:?}, light {light:?}");
    assert!(near(dark, [0x1d, 0x4e, 0xd8]), "dark artboard {dark:?}");
    assert!(near(light, [0xf9, 0x73, 0x16]), "light artboard {light:?}");
    // The system itself, through Zorvo's shell in the shared view: the live preview of its one
    // component loads, and the shell reports it from the iframe's own load event.
    let (sent, received) = channel();
    app.listen_any(DS_VIEW, move |event| {
        let payload = serde_json::from_str(event.payload()).unwrap_or(Value::Null);
        let _ = sent.send(payload);
    });
    let shown = ShownDesignSystem {
        session_id: SESSION.to_string(),
        key: system.entry.key.clone(),
    };
    let preview = ds_file_url(
        SESSION,
        &shown.key,
        "dark",
        "components/Swatch/preview.html",
    );
    let state = json!({
        "title": "Probe", "theme": "dark", "themes": [{"id": "dark", "name": "Dark"}, {"id": "light", "name": "Light"}],
        "sections": [], "sectionsCut": false, "colours": [{"name": "accent", "value": "#1d4ed8"}],
        "type": [], "spacing": [], "radius": [], "shadow": [],
        "components": [{"name": "Swatch", "group": "Probe", "height": 200, "url": format!("{preview}?v=1&d=2")}],
        "assets": [], "fonts": [], "fontCss": "", "googleFontsUrl": null, "notes": [],
        "ownMarks": {"tokens": {}, "components": {}, "sections": {}},
    });
    let script = ds_apply_script(&state.to_string()).expect("a state the shell takes");
    view::show_design_system(app, served, shown.clone(), CANVAS_BOUNDS).expect("show the system");
    view::apply_design_system(app, shown, vec!["Swatch".to_string()], script);
    let loaded = received
        .recv_timeout(Duration::from_secs(20))
        .expect("the shell never reported its preview as loaded");
    println!("design system shell: {loaded}");
    assert_eq!(loaded["kind"], "preview-loaded");
    assert_eq!(loaded["component"], "Swatch");
    view::close(app);
}

fn scratch_folder() -> PathBuf {
    let folder = std::env::temp_dir().join(format!("zorvo-canvas-render-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("scratch folder");
    std::fs::canonicalize(folder).expect("canonical scratch folder")
}

fn main() {
    if std::env::var("ZORVO_RENDER_TEST").as_deref() != Ok("1") {
        println!("canvas_render: skipped (needs a window server; set ZORVO_RENDER_TEST=1)");
        return;
    }
    let folder = scratch_folder();
    std::thread::spawn(|| {
        std::thread::sleep(DEADLINE);
        eprintln!("canvas_render: no result after {DEADLINE:?}");
        std::process::exit(1);
    });
    let checked = folder.clone();
    tauri::Builder::default()
        .setup(move |app| {
            // The app's own config makes the main window the drawing views are children of;
            // nothing needs to see it.
            if let Some(window) = app.get_webview_window("main") {
                window.hide()?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let passed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    check(&handle, &checked);
                    check_frames(&handle, &checked);
                    check_design_system(&handle, &checked);
                }))
                .is_ok();
                let _ = std::fs::remove_dir_all(&checked);
                println!("canvas_render: {}", if passed { "ok" } else { "FAILED" });
                // `exit` ends the process with this code once the event loop stops.
                handle.exit(if passed { 0 } else { 1 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run the test app");
}
