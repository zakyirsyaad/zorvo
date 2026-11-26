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
use objc2::rc::Retained;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSData, NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
use objc2_web_kit::{WKPDFConfiguration, WKSnapshotConfiguration};
use tauri::{AppHandle, Manager};

use super::protocol::{
    is_allowed_canvas_navigation, is_sha256, parse_canvas_url, parse_visual_url, respond,
    respond_visual, visual_url, CanvasUrl, Served, SCHEME,
};
use super::view::end;
use super::visual_wrapper::Theme;

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
    /// The design system theme the picture is drawn in, when the canvas names a system; `sha256`
    /// then holds the picture key (`ds_canvas::picture_key`), not the board key alone.
    pub theme: Option<String>,
    /// The linked system's folder, to work out the picture key again at the job's turn.
    pub system_root: Option<PathBuf>,
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

    /// The next job, counted as being drawn until `finish`: the worker checks its file's hash
    /// outside the lock. `None` ends the worker.
    pub fn pop(&mut self) -> Option<ThumbJob> {
        let Some(job) = self.jobs.pop_front() else {
            self.is_running = false;
            return None;
        };
        self.drawing = Some(job.sha256.clone());
        Some(job)
    }

    /// The job being drawn ended. A failed hash is not tried again this run; a stale one
    /// (its file changed, or its canvas was forgotten) may be queued again.
    pub fn finish(&mut self, sha256: &str, ended: Ended) {
        if self.drawing.as_deref() == Some(sha256) {
            self.drawing = None;
        }
        if ended == Ended::Failed {
            self.failed.insert(sha256.to_string());
        }
    }

    /// The worker stopped without emptying the queue (it panicked): the next push starts one.
    pub fn end_worker(&mut self) {
        self.is_running = false;
        self.drawing = None;
    }
}

/// How a job ended.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ended {
    Drawn,
    Failed,
    /// The file is not the one drawn any more, or its canvas is forgotten: dropped, not failed.
    Stale,
}

/// How a job ends, from whether it was drawn, its file's hash now and whether its canvas is
/// still remembered. A picture is kept only for the file it shows.
pub fn outcome(is_drawn: bool, job: &ThumbJob, hash_now: Option<&str>, is_known: bool) -> Ended {
    if !is_known || hash_now != Some(job.sha256.as_str()) {
        Ended::Stale
    } else if is_drawn {
        Ended::Drawn
    } else {
        Ended::Failed
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
/// A link is never followed and only a regular file is touched; the file is opened to read.
pub fn touch(path: &Path, now: SystemTime) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::File::options()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    file.set_modified(now)
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
    let page = match parse_canvas_url(&url) {
        Some(CanvasUrl::File {
            session_id, key, ..
        }) => Page::Canvas { session_id, key },
        _ if parse_visual_url(&url).is_some() => Page::Visual,
        _ => return Err(failed()),
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
        if start(&handle, served, url, page, drawing).is_err() {
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

/// What a hidden view draws, which decides what it may load and go to.
#[derive(Clone)]
enum Page {
    /// One artboard of a canvas: the canvas's files, under its own rules.
    Canvas { session_id: String, key: String },
    /// One inline visual: its document and nothing else.
    Visual,
}

/// A PNG of an inline visual in `theme`, drawn at `width × height` and twice as many pixels wide.
pub fn snapshot_visual_png(
    app: &AppHandle,
    served: Arc<Served>,
    session_id: &str,
    id: &str,
    theme: Theme,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let url = visual_url(session_id, id, theme);
    draw(
        app,
        served,
        url,
        width,
        height,
        Output::Png {
            out_width: width * 2,
        },
    )
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
    page: Page,
    drawing: Drawing,
) -> Result<(), ()> {
    let window = app.get_webview_window(MAIN_WINDOW).ok_or(())?;
    let allowed = page.clone();
    let home = parse_visual_url(&url);
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
        .with_navigation_handler(move |to| match &allowed {
            Page::Canvas { session_id, key } => is_allowed_canvas_navigation(&to, session_id, key),
            // A visual's view goes to that visual and nowhere else.
            Page::Visual => parse_visual_url(&to).is_some_and(|there| Some(there) == home),
        })
        .with_custom_protocol(SCHEME.to_string(), move |_id, request| {
            let (method, uri) = (request.method().as_str(), request.uri().to_string());
            match &page {
                Page::Canvas { .. } => respond(&served, method, &uri),
                Page::Visual => respond_visual(&served.store, method, &uri),
            }
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

/// One PDF of `pages` (each the PDF of one artboard), the first page of each in order, at its
/// own size. Any page that PDFKit cannot read fails the whole PDF.
pub fn join_pdfs(pages: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
    let failed = || RENDER_FAILED.to_string();
    if pages.is_empty() {
        return Err(failed());
    }
    // SAFETY: PDFKit's documents and pages may be used on any thread when each stays on one;
    // every object here lives and dies in this call. The read documents are kept until the
    // joined one is written, since their pages are inserted, not copied.
    unsafe {
        let joined = PDFDocument::new();
        let mut sources = Vec::with_capacity(pages.len());
        for (index, bytes) in pages.iter().enumerate() {
            let source = read_pdf(bytes).ok_or_else(failed)?;
            let page = source.pageAtIndex(0).ok_or_else(failed)?;
            joined.insertPage_atIndex(&page, index);
            sources.push(source);
        }
        if joined.pageCount() != pages.len() {
            return Err(failed());
        }
        let data = joined.dataRepresentation().ok_or_else(failed)?;
        drop(sources);
        Ok(data.to_vec())
    }
}

/// The media box size of every page of a PDF, in points; `None` when PDFKit cannot read it.
pub fn pdf_page_sizes(pdf: &[u8]) -> Option<Vec<(f64, f64)>> {
    let document = read_pdf(pdf)?;
    // SAFETY: as in `join_pdfs`: one document, used and dropped on this thread.
    unsafe {
        (0..document.pageCount())
            .map(|index| {
                let bounds = document
                    .pageAtIndex(index)?
                    .boundsForBox(PDFDisplayBox::MediaBox);
                Some((bounds.size.width, bounds.size.height))
            })
            .collect()
    }
}

fn read_pdf(bytes: &[u8]) -> Option<Retained<PDFDocument>> {
    let data = NSData::with_bytes(bytes);
    // SAFETY: `initWithData:` copies what it needs from `data`, which outlives the call.
    let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }?;
    // SAFETY: a document just read, on this thread.
    (unsafe { document.pageCount() } > 0).then_some(document)
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
            theme: None,
            system_root: None,
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

        let first = queue.pop().expect("a job");
        assert_eq!(first.artboard_id, "cart");
        // Taken out to be checked and drawn counts as queued.
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Skipped);
        queue.finish(&first.sha256, Ended::Failed);
        // A failed hash waits for the file to change.
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Skipped);
        assert_eq!(queue.push(job("cart", 'c'), false), Pushed::Queued);

        assert_eq!(queue.pop().map(|j| j.artboard_id), Some("pay".into()));
        queue.finish(&"b".repeat(64), Ended::Drawn);
        assert_eq!(queue.pop().map(|j| j.sha256), Some("c".repeat(64)));
        queue.finish(&"c".repeat(64), Ended::Drawn);
        assert_eq!(queue.pop(), None);
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

        // By its turn, cart's file changed: it is dropped, not drawn, and not failed.
        let cart = queue.pop().expect("cart");
        let ended = outcome(true, &cart, Some(&"f".repeat(64)), true);
        assert_eq!(ended, Ended::Stale);
        queue.finish(&cart.sha256, ended);
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Queued);

        let pay = queue.pop().expect("pay");
        assert_eq!(
            (pay.artboard_id.as_str(), pay.sha256.as_str()),
            ("pay", "e".repeat(64).as_str())
        );
    }

    #[test]
    fn a_drawing_is_kept_only_for_an_unchanged_file_of_a_known_canvas() {
        let cart = job("cart", 'a');
        let same = Some(cart.sha256.as_str());
        assert_eq!(outcome(true, &cart, same, true), Ended::Drawn);
        assert_eq!(outcome(false, &cart, same, true), Ended::Failed);
        // Changed or gone while it was drawn, or the canvas forgotten: dropped, never failed.
        for (hash_now, is_known) in [(Some("f"), true), (None, true), (same, false)] {
            assert_eq!(outcome(true, &cart, hash_now, is_known), Ended::Stale);
            assert_eq!(outcome(false, &cart, hash_now, is_known), Ended::Stale);
        }
    }

    #[test]
    fn a_worker_that_ends_early_leaves_the_queue_able_to_start_another() {
        let mut queue = ThumbQueue::default();
        queue.push(job("cart", 'a'), false);
        queue.push(job("pay", 'b'), false);
        let _ = queue.pop();
        // The worker panicked mid-drawing: its guard ends it.
        queue.end_worker();
        assert_eq!(
            queue.push(job("menu", 'c'), false),
            Pushed::QueuedStartWorker
        );
        // The hash it was drawing is no longer counted as drawn.
        assert_eq!(queue.push(job("cart", 'a'), false), Pushed::Queued);
    }

    #[test]
    fn touch_never_follows_a_link_or_touches_a_folder() {
        let temp = Temp::new("touch");
        let target = temp.0.join("target.txt");
        std::fs::write(&target, b"x").unwrap();
        let before = std::fs::metadata(&target).unwrap().modified().unwrap();
        let link = thumb_path(&temp.0, &"a".repeat(64));
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let later = SystemTime::now() + Duration::from_secs(3600);

        assert!(touch(&link, later).is_err());
        assert_eq!(
            std::fs::metadata(&target).unwrap().modified().unwrap(),
            before
        );
        assert!(touch(&temp.0, later).is_err());
        touch(&target, later).unwrap();
        assert_eq!(
            std::fs::metadata(&target).unwrap().modified().unwrap(),
            later
        );
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

    /// A one-page PDF of `width × height` points, written by hand; PDFKit rebuilds its table.
    fn one_page_pdf(width: u32, height: u32) -> Vec<u8> {
        format!(
            "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n\
             2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n\
             3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] >> endobj\n\
             trailer << /Root 1 0 R >>\n%%EOF\n"
        )
        .into_bytes()
    }

    #[test]
    fn join_pdfs_puts_each_page_in_order_at_its_own_size() {
        let sizes = [(1440, 900), (390, 844), (800, 600)];
        let joined =
            join_pdfs(sizes.iter().map(|&(w, h)| one_page_pdf(w, h)).collect()).expect("joined");
        assert_eq!(
            pdf_page_sizes(&joined),
            Some(
                sizes
                    .iter()
                    .map(|&(w, h)| (f64::from(w), f64::from(h)))
                    .collect()
            )
        );
    }

    #[test]
    fn join_pdfs_refuses_nothing_and_what_is_not_a_pdf() {
        assert_eq!(join_pdfs(Vec::new()), Err(RENDER_FAILED.to_string()));
        assert_eq!(
            join_pdfs(vec![one_page_pdf(400, 300), b"not a pdf".to_vec()]),
            Err(RENDER_FAILED.to_string())
        );
    }

    #[test]
    fn thumb_width_is_at_most_720() {
        assert_eq!(thumb_width(1440), 720);
        assert_eq!(thumb_width(390), 390);
    }
}
