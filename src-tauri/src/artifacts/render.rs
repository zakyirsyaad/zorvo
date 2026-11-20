//! Pictures of canvas artboards: which to draw and in what order (`ThumbQueue`), the cache
//! folder's upkeep, and the drawing itself in a hidden webview.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime};

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSData, NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_web_kit::{WKPDFConfiguration, WKSnapshotConfiguration};
use tauri::{AppHandle, Manager};

use super::protocol::{
    is_allowed_canvas_navigation, is_sha256, parse_canvas_url, respond, CanvasUrl, Served, SCHEME,
};
use super::view::end;

/// The widest picture drawn for the canvas, in pixels.
pub const MAX_THUMB_WIDTH: u32 = 720;
/// A picture no shown canvas has listed for this long is removed at start.
pub const THUMB_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
pub const RENDER_FAILED: &str = "Zorvo could not draw that artboard.";

/// One artboard to draw.
#[derive(Clone, Debug, PartialEq)]
pub struct ThumbJob {
    pub session_id: String,
    pub key: String,
    pub artboard_id: String,
    pub sha256: String,
    /// The canvas folder and the artboard's file in it, to hash it again at its turn.
    pub root: PathBuf,
    pub file: String,
    pub width: u32,
    pub height: u32,
}

impl ThumbJob {
    fn is_same_artboard(&self, other: &ThumbJob) -> bool {
        self.session_id == other.session_id
            && self.key == other.key
            && self.artboard_id == other.artboard_id
    }
}

/// The artboards waiting for a picture, drawn one at a time.
#[derive(Debug, Default)]
pub struct ThumbQueue {
    jobs: VecDeque<ThumbJob>,
    /// The hash being drawn now.
    drawing: Option<String>,
    /// Hashes that could not be drawn this run: not tried again until the file changes.
    failed: HashSet<String>,
    /// A worker is draining the queue.
    is_running: bool,
}

/// What `push` did with a job.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Pushed {
    Skipped,
    Queued,
    /// Queued, and no worker drains the queue: the caller starts one.
    QueuedStartWorker,
}

impl ThumbQueue {
    /// Queues `job` unless its picture is cached, is queued or being drawn, or failed this run.
    /// A queued job for the same artboard with another hash is replaced.
    pub fn push(&mut self, job: ThumbJob, is_cached: bool) -> Pushed {
        let is_known = is_cached
            || self.failed.contains(&job.sha256)
            || self.drawing.as_ref() == Some(&job.sha256)
            || self.jobs.iter().any(|queued| queued.sha256 == job.sha256);
        if is_known {
            return Pushed::Skipped;
        }
        self.jobs.retain(|queued| !queued.is_same_artboard(&job));
        self.jobs.push_back(job);
        if self.is_running {
            Pushed::Queued
        } else {
            self.is_running = true;
            Pushed::QueuedStartWorker
        }
    }

    /// The next job whose artboard still has its hash (`current_hash`, read now); jobs whose
    /// file changed or is gone are dropped. `None` ends the worker.
    pub fn next(&mut self, current_hash: impl Fn(&ThumbJob) -> Option<String>) -> Option<ThumbJob> {
        while let Some(job) = self.jobs.pop_front() {
            if current_hash(&job).as_ref() == Some(&job.sha256) {
                self.drawing = Some(job.sha256.clone());
                return Some(job);
            }
        }
        self.is_running = false;
        None
    }

    /// The job being drawn ended; a failed hash is not tried again this run.
    pub fn finish(&mut self, sha256: &str, is_drawn: bool) {
        if self.drawing.as_deref() == Some(sha256) {
            self.drawing = None;
        }
        if !is_drawn {
            self.failed.insert(sha256.to_string());
        }
    }
}

/// Where the picture of a file with this hash is kept.
pub fn thumb_path(dir: &Path, sha256: &str) -> PathBuf {
    dir.join(format!("{sha256}.png"))
}

/// Removes pictures (`<sha256>.png` regular files) not listed for `THUMB_MAX_AGE`; anything
/// else in the folder stays. Returns how many went.
pub fn sweep_thumbs(dir: &Path, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".png"))
                .is_some_and(is_sha256)
        })
        .filter(|entry| {
            // `symlink_metadata`: a link is never followed, so nothing outside goes.
            std::fs::symlink_metadata(entry.path()).is_ok_and(|meta| {
                meta.is_file()
                    && meta
                        .modified()
                        .ok()
                        .and_then(|modified| now.duration_since(modified).ok())
                        .is_some_and(|age| age > THUMB_MAX_AGE)
            })
        })
        .filter(|entry| std::fs::remove_file(entry.path()).is_ok())
        .count()
}

/// Keeps `png` as the picture of the file with this hash: written aside, then renamed, so a
/// half-written picture is never served.
pub fn save_thumb(dir: &Path, sha256: &str, png: &[u8]) -> Result<(), String> {
    let failed = |_| RENDER_FAILED.to_string();
    if !is_sha256(sha256) {
        return Err(RENDER_FAILED.to_string());
    }
    std::fs::create_dir_all(dir).map_err(failed)?;
    let aside = dir.join(format!(".{sha256}.png.part"));
    std::fs::write(&aside, png).map_err(failed)?;
    std::fs::rename(&aside, thumb_path(dir, sha256)).map_err(|error| {
        let _ = std::fs::remove_file(&aside);
        failed(error)
    })
}

/// Marks a picture as listed now, so the sweep keeps it.
pub fn touch(path: &Path, now: SystemTime) -> std::io::Result<()> {
    std::fs::File::options()
        .write(true)
        .open(path)?
        .set_modified(now)
}

/// How wide an artboard's picture is drawn.
pub fn thumb_width(width: u32) -> u32 {
    width.min(MAX_THUMB_WIDTH)
}

// The drawing itself. Everything WebKit is called on the main thread; the caller waits on a
// channel, never the main thread.

/// How long one picture or PDF may take, load included.
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(15);
/// Time for the page's scripts and fonts to settle once it has loaded.
const SETTLE: Duration = Duration::from_millis(300);
const MAIN_WINDOW: &str = "main";

#[derive(Clone, Copy, Debug)]
enum Output {
    Png { out_width: u32 },
    Pdf,
}

type Drawn = Result<Vec<u8>, ()>;

static NEXT_DRAWING: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// The hidden views drawing now, by drawing. `wry::WebView` is not `Send`: main thread only.
    static DRAWINGS: RefCell<HashMap<u64, wry::WebView>> = RefCell::new(HashMap::new());
}

/// A PNG of the artboard at `url` (one of a canvas's files), drawn whole at `width × height`
/// and `out_width` pixels wide.
pub fn snapshot_png(
    app: &AppHandle,
    served: Arc<Served>,
    url: String,
    width: u32,
    height: u32,
    out_width: u32,
) -> Result<Vec<u8>, String> {
    if !(1..=MAX_DRAWN_SIDE).contains(&out_width) {
        return Err(RENDER_FAILED.to_string());
    }
    draw(app, served, url, width, height, Output::Png { out_width })
}

/// A one-page PDF of the artboard at `url`, `width × height` points.
pub fn render_pdf(
    app: &AppHandle,
    served: Arc<Served>,
    url: String,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    draw(app, served, url, width, height, Output::Pdf)
}

/// Twice `canvas.rs`'s largest side, so an export at scale 2 fits.
const MAX_DRAWN_SIDE: u32 = 16_000;

fn draw(
    app: &AppHandle,
    served: Arc<Served>,
    url: String,
    width: u32,
    height: u32,
    output: Output,
) -> Result<Vec<u8>, String> {
    let failed = || RENDER_FAILED.to_string();
    let Some(CanvasUrl::File {
        session_id, key, ..
    }) = parse_canvas_url(&url)
    else {
        return Err(failed());
    };
    let is_drawable = |side: u32| (1..=MAX_DRAWN_SIDE).contains(&side);
    if !is_drawable(width) || !is_drawable(height) {
        return Err(failed());
    }
    // Pictures are counted in pixels; WebKit's snapshot width is in points.
    let scale = app
        .get_webview_window(MAIN_WINDOW)
        .and_then(|window| window.scale_factor().ok())
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .unwrap_or(1.0);
    let id = NEXT_DRAWING.fetch_add(1, Ordering::Relaxed);
    let (sent, received) = mpsc::channel::<Drawn>();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let drawing = Drawing {
            id,
            width,
            height,
            output,
            scale,
            sent: sent.clone(),
        };
        if start(&handle, served, url, session_id, key, drawing).is_err() {
            let _ = sent.send(Err(()));
        }
    })
    .map_err(|_| failed())?;
    let result = received.recv_timeout(RENDER_TIMEOUT);
    // Ended whatever happened: done, refused or still loading after 15 s.
    let _ = app.run_on_main_thread(move || end_drawing(id));
    match result {
        Ok(Ok(bytes)) if !bytes.is_empty() => Ok(bytes),
        _ => Err(failed()),
    }
}

/// One drawing's settings, carried to the main thread.
#[derive(Clone)]
struct Drawing {
    id: u64,
    width: u32,
    height: u32,
    output: Output,
    scale: f64,
    sent: mpsc::Sender<Drawn>,
}

/// Makes the hidden view, at the artboard's size, under the canvas's CSP and navigation rule.
/// Main thread only.
fn start(
    app: &AppHandle,
    served: Arc<Served>,
    url: String,
    session_id: String,
    key: String,
    drawing: Drawing,
) -> Result<(), ()> {
    let window = app.get_webview_window(MAIN_WINDOW).ok_or(())?;
    let id = drawing.id;
    let loaded = app.clone();
    let has_loaded = Cell::new(false);
    let bounds = wry::Rect {
        position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
        size: wry::dpi::LogicalSize::new(f64::from(drawing.width), f64::from(drawing.height))
            .into(),
    };
    let view = wry::WebViewBuilder::new()
        .with_incognito(true)
        .with_visible(false)
        .with_bounds(bounds)
        .with_navigation_handler(move |url| is_allowed_canvas_navigation(&url, &session_id, &key))
        .with_custom_protocol(SCHEME.to_string(), move |_id, request| {
            respond(
                &served,
                request.method().as_str(),
                &request.uri().to_string(),
            )
            .map(Cow::from)
        })
        .with_on_page_load_handler(move |event, _url| {
            if !matches!(event, wry::PageLoadEvent::Finished) || has_loaded.replace(true) {
                return;
            }
            let later = loaded.clone();
            let drawing = drawing.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SETTLE);
                let _ = later.run_on_main_thread(move || capture(drawing));
            });
        })
        .with_url(url)
        .build_as_child(&window)
        .map_err(|_| ())?;
    DRAWINGS.with(|drawings| drawings.borrow_mut().insert(id, view));
    Ok(())
}

/// Asks WebKit for the picture or PDF of a loaded drawing. Main thread only.
fn capture(drawing: Drawing) {
    let webview = DRAWINGS.with(|drawings| {
        drawings
            .borrow()
            .get(&drawing.id)
            .map(wry::WebViewExtMacOS::webview)
    });
    let (Some(webview), Some(mtm)) = (webview, MainThreadMarker::new()) else {
        let _ = drawing.sent.send(Err(()));
        return;
    };
    let rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(f64::from(drawing.width), f64::from(drawing.height)),
    );
    let sent = drawing.sent;
    match drawing.output {
        Output::Png { out_width } => {
            let done = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                // SAFETY: WebKit passes the snapshot, or null with an error.
                let png = unsafe { image.as_ref() }.and_then(png_bytes);
                let _ = sent.send(png.ok_or(()));
            });
            // SAFETY: on the main thread, with a live WKWebView; the configuration is fully set
            // before the call, and WebKit copies the block.
            unsafe {
                let config = WKSnapshotConfiguration::new(mtm);
                config.setRect(rect);
                config.setAfterScreenUpdates(true);
                let points = f64::from(out_width) / drawing.scale;
                config.setSnapshotWidth(Some(&NSNumber::new_f64(points)));
                webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &done);
            }
        }
        Output::Pdf => {
            let done = RcBlock::new(move |data: *mut NSData, _error: *mut NSError| {
                // SAFETY: WebKit passes the PDF's data, or null with an error.
                let pdf = unsafe { data.as_ref() }.map(NSData::to_vec);
                let _ = sent.send(pdf.ok_or(()));
            });
            // SAFETY: as above.
            unsafe {
                let config = WKPDFConfiguration::new(mtm);
                config.setRect(rect);
                webview.createPDFWithConfiguration_completionHandler(Some(&config), &done);
            }
        }
    }
}

/// The snapshot as PNG bytes, at its pixel size.
fn png_bytes(image: &NSImage) -> Option<Vec<u8>> {
    let tiff = image.TIFFRepresentation()?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // SAFETY: an empty dictionary of the type the method takes.
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

/// Ends a drawing's view and its page's process, if it is still there. Main thread only.
fn end_drawing(id: u64) {
    if let Some(view) = DRAWINGS.with(|drawings| drawings.borrow_mut().remove(&id)) {
        end(view);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    fn job(artboard: &str, sha: char) -> ThumbJob {
        ThumbJob {
            session_id: "session-1".into(),
            key: "c-0123456789abcdef".into(),
            artboard_id: artboard.into(),
            sha256: sha.to_string().repeat(64),
            root: PathBuf::from("/w/d"),
            file: format!("{artboard}.html"),
            width: 1440,
            height: 900,
        }
    }

    #[test]
    fn queue_skips_cached_and_queued_hashes() {
        let mut queue = ThumbQueue::default();
        assert_eq!(queue.push(job("cart", 'a'), true), Pushed::Skipped);
        assert_eq!(
            queue.push(job("cart", 'a'), false),
            Pushed::QueuedStartWorker
        );
        // The same file under another artboard (a copy) is the same picture.
        assert_eq!(queue.push(job("copy", 'a'), false), Pushed::Skipped);
        assert_eq!(queue.push(job("pay", 'b'), false), Pushed::Queued);

        let same = |job: &ThumbJob| Some(job.sha256.clone());
        let first = queue.next(same).expect("a job");
        assert_eq!(first.artboard_id, "cart");
        // Being drawn counts as queued.
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Skipped);
        queue.finish(&first.sha256, false);
        // A failed hash waits for the file to change.
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Skipped);
        assert_eq!(queue.push(job("cart", 'c'), false), Pushed::Queued);

        assert_eq!(queue.next(same).map(|j| j.artboard_id), Some("pay".into()));
        queue.finish(&"b".repeat(64), true);
        assert_eq!(queue.next(same).map(|j| j.sha256), Some("c".repeat(64)));
        queue.finish(&"c".repeat(64), true);
        assert_eq!(queue.next(same), None);
        // The worker stopped with the empty queue, so the next push starts one.
        assert_eq!(
            queue.push(job("menu", 'd'), false),
            Pushed::QueuedStartWorker
        );
    }

    #[test]
    fn queue_drops_a_job_whose_hash_changed() {
        let mut queue = ThumbQueue::default();
        queue.push(job("cart", 'a'), false);
        queue.push(job("pay", 'b'), false);
        // A newer list for the same artboard replaces its waiting job.
        queue.push(job("pay", 'e'), false);

        // By its turn, cart's file changed: it is dropped, not drawn.
        let now = |job: &ThumbJob| {
            Some(if job.artboard_id == "cart" {
                "f".repeat(64)
            } else {
                job.sha256.clone()
            })
        };
        let next = queue.next(now).expect("pay");
        assert_eq!(
            (next.artboard_id.as_str(), next.sha256),
            ("pay", "e".repeat(64))
        );
        queue.finish(&"e".repeat(64), true);
        // A file that is gone is dropped too.
        queue.push(job("menu", 'd'), false);
        assert_eq!(queue.next(|_| None), None);
    }

    #[test]
    fn sweep_removes_only_old_pngs_named_by_a_hash() {
        let temp = Temp::new("thumbs");
        let old = thumb_path(&temp.0, &"a".repeat(64));
        let fresh = thumb_path(&temp.0, &"b".repeat(64));
        let notes = temp.0.join("notes.txt");
        let odd = temp.0.join("short.png");
        let folder = thumb_path(&temp.0, &"c".repeat(64));
        for path in [&old, &fresh, &notes, &odd] {
            std::fs::write(path, b"png").unwrap();
        }
        std::fs::create_dir(&folder).unwrap();

        let now = SystemTime::now() + THUMB_MAX_AGE + Duration::from_secs(60);
        // `fresh` was listed just now.
        touch(&fresh, now).unwrap();
        assert_eq!(sweep_thumbs(&temp.0, now), 1);
        assert!(!old.exists());
        for kept in [&fresh, &notes, &odd, &folder] {
            assert!(kept.exists(), "{}", kept.display());
        }
        // A folder that does not exist sweeps nothing.
        assert_eq!(sweep_thumbs(&temp.0.join("none"), now), 0);
    }

    #[test]
    fn save_writes_the_picture_by_its_hash_only() {
        let temp = Temp::new("save");
        let dir = temp.0.join("canvas-thumbs");
        let hash = "a".repeat(64);
        save_thumb(&dir, &hash, b"png").unwrap();
        assert_eq!(std::fs::read(thumb_path(&dir, &hash)).unwrap(), b"png");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        for bad in ["../x", "A".repeat(64).as_str(), ""] {
            assert_eq!(
                save_thumb(&dir, bad, b"png"),
                Err(RENDER_FAILED.to_string())
            );
        }
    }

    #[test]
    fn thumb_width_is_at_most_720() {
        assert_eq!(thumb_width(1440), 720);
        assert_eq!(thumb_width(390), 390);
    }
}
