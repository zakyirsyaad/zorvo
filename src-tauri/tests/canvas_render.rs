//! Draws a fixture artboard through `artifacts::render` in a real Tauri app and checks the
//! pictures and the PDF. `harness = false`: libtest runs every test on a thread of its own, and
//! Tauri's event loop can only be made on the process's main thread, which `main` is here.
//!
//! It needs a window server, so it skips unless `ZORVO_RENDER_TEST=1`:
//! `ZORVO_RENDER_TEST=1 cargo test --test canvas_render`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use zorvo_lib::artifacts::commands::show_canvas;
use zorvo_lib::artifacts::protocol::{canvas_file_url, Served};
use zorvo_lib::artifacts::render::{render_pdf, snapshot_png, RENDER_FAILED};
use zorvo_lib::artifacts::store::ArtifactStore;

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
    let pdf = render_pdf(app, Arc::clone(&served), url, 1440, 900).expect("make the PDF");
    let (pages, media_box) = pdf_pages(&pdf);
    assert_eq!(pages, 1, "PDF pages");
    assert_eq!(media_box, "0 0 1440 900", "PDF page box");
    println!(
        "pdf: {pages} page, MediaBox [{media_box}], {} bytes",
        pdf.len()
    );
    let refused = snapshot_png(app, served, "https://example.com/".into(), 1440, 900, 720);
    assert_eq!(
        refused,
        Err(RENDER_FAILED.to_string()),
        "a URL outside the canvas"
    );
    println!("a URL outside the canvas: refused");
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
                    check(&handle, &checked)
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
