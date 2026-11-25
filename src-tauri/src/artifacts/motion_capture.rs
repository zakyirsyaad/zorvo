//! Frames of a motion page: a hidden child view of the main window at the format's size, under
//! the motion's navigation rule and with the motion runtime, seeked by Zorvo and snapshotted by
//! WebKit. WebKit is called on the main thread only; the render thread waits on channels.

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::NSImage;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
};
use objc2_foundation::{NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_web_kit::WKSnapshotConfiguration;
use tauri::{AppHandle, Manager};

use super::motion_protocol::{is_allowed_motion_navigation, MOTION_RUNTIME};
use super::protocol::{respond, Served, SCHEME};
use super::view::end;

const MAIN_WINDOW: &str = "main";
pub const CAPTURE_FAILED: &str = "Zorvo could not draw a frame of that motion.";
/// How long a page may take to load, and then to have its fonts and images ready.
const LOAD_TIMEOUT: Duration = Duration::from_secs(20);
const READY_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one seek and snapshot may take.
const FRAME_TIMEOUT: Duration = Duration::from_secs(10);

static NEXT_VIEW: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// The hidden views capturing now. `wry::WebView` is not `Send`: main thread only.
    static VIEWS: RefCell<HashMap<u64, wry::WebView>> = RefCell::new(HashMap::new());
}

fn failed() -> String {
    CAPTURE_FAILED.to_string()
}

/// A hidden view showing one format of a motion. Ended when dropped.
pub struct CaptureView {
    app: AppHandle,
    id: u64,
    width: u32,
    height: u32,
    scale: f64,
}

/// What the runtime says once a page has settled.
#[derive(serde::Deserialize, Default)]
pub struct Readiness {
    pub fonts: bool,
    pub images: bool,
    pub loaded: bool,
    pub animations: u32,
    pub handlers: u32,
}

impl CaptureView {
    /// Opens `url` (a page of the motion `session_id`/`key`) at `width × height` and waits until
    /// it has loaded.
    pub fn open(
        app: &AppHandle,
        served: Arc<Served>,
        url: String,
        session_id: String,
        key: String,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let scale = app
            .get_webview_window(MAIN_WINDOW)
            .and_then(|window| window.scale_factor().ok())
            .filter(|scale| scale.is_finite() && *scale > 0.0)
            .unwrap_or(1.0);
        let id = NEXT_VIEW.fetch_add(1, Ordering::Relaxed);
        let (sent, received) = mpsc::channel::<Result<(), ()>>();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let loaded = sent.clone();
            let built = handle
                .get_webview_window(MAIN_WINDOW)
                .ok_or(())
                .and_then(|window| {
                    let bounds = wry::Rect {
                        position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                        size: wry::dpi::LogicalSize::new(f64::from(width), f64::from(height))
                            .into(),
                    };
                    wry::WebViewBuilder::new()
                        .with_incognito(true)
                        .with_visible(false)
                        .with_bounds(bounds)
                        .with_initialization_script(MOTION_RUNTIME)
                        .with_navigation_handler(move |to| {
                            is_allowed_motion_navigation(&to, &session_id, &key)
                        })
                        .with_custom_protocol(SCHEME.to_string(), move |_id, request| {
                            respond(
                                &served,
                                request.method().as_str(),
                                &request.uri().to_string(),
                            )
                            .map(Cow::from)
                        })
                        .with_on_page_load_handler(move |event, _url| {
                            if matches!(event, wry::PageLoadEvent::Finished) {
                                let _ = loaded.send(Ok(()));
                            }
                        })
                        .with_url(url)
                        .build_as_child(&window)
                        .map_err(|_| ())
                });
            match built {
                Ok(view) => VIEWS.with(|views| {
                    views.borrow_mut().insert(id, view);
                }),
                Err(()) => {
                    let _ = sent.send(Err(()));
                }
            }
        })
        .map_err(|_| failed())?;
        let view = Self {
            app: app.clone(),
            id,
            width,
            height,
            scale,
        };
        match received.recv_timeout(LOAD_TIMEOUT) {
            Ok(Ok(())) => Ok(view),
            _ => Err(failed()),
        }
    }

    fn evaluate(&self, script: String) -> Result<String, String> {
        let (sent, received) = mpsc::channel::<String>();
        let id = self.id;
        self.app
            .run_on_main_thread(move || {
                VIEWS.with(|views| {
                    if let Some(view) = views.borrow().get(&id) {
                        let sent = sent.clone();
                        let _ = view.evaluate_script_with_callback(&script, move |result| {
                            let _ = sent.send(result);
                        });
                    }
                });
            })
            .map_err(|_| failed())?;
        received.recv_timeout(FRAME_TIMEOUT).map_err(|_| failed())
    }

    /// Waits until the page's fonts and images have loaded, and says what moves on it.
    pub fn wait_ready(&self) -> Readiness {
        let started = Instant::now();
        loop {
            let ready = self
                .evaluate("window.__zorvoMotionReady ? window.__zorvoMotionReady() : '{}'".into())
                .ok()
                .and_then(|text| serde_json::from_str::<String>(&text).ok())
                .and_then(|json| serde_json::from_str::<Readiness>(&json).ok())
                .unwrap_or_default();
            if (ready.fonts && ready.images && ready.loaded) || started.elapsed() > READY_TIMEOUT {
                return ready;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Seeks the page to `seconds` and takes it as RGBA, `width × height` pixels.
    pub fn frame_at(&self, seconds: f64) -> Result<Vec<u8>, String> {
        if !seconds.is_finite() {
            return Err(failed());
        }
        let (sent, received) = mpsc::channel::<Result<Vec<u8>, ()>>();
        let (id, width, height, scale) = (self.id, self.width, self.height, self.scale);
        let script = format!("window.__zorvoMotionSeek && window.__zorvoMotionSeek({seconds})");
        self.app
            .run_on_main_thread(move || {
                VIEWS.with(|views| {
                    let views = views.borrow();
                    let Some(view) = views.get(&id) else {
                        let _ = sent.send(Err(()));
                        return;
                    };
                    let snap = sent.clone();
                    let seeked = view.evaluate_script_with_callback(&script, move |_| {
                        snapshot(id, width, height, scale, snap.clone());
                    });
                    if seeked.is_err() {
                        let _ = sent.send(Err(()));
                    }
                });
            })
            .map_err(|_| failed())?;
        match received.recv_timeout(FRAME_TIMEOUT) {
            Ok(Ok(rgba)) => Ok(rgba),
            _ => Err(failed()),
        }
    }
}

impl Drop for CaptureView {
    fn drop(&mut self) {
        let id = self.id;
        let _ = self.app.run_on_main_thread(move || {
            if let Some(view) = VIEWS.with(|views| views.borrow_mut().remove(&id)) {
                end(view);
            }
        });
    }
}

/// Asks WebKit for the view's picture and sends it as RGBA. Main thread only.
fn snapshot(id: u64, width: u32, height: u32, scale: f64, sent: mpsc::Sender<Result<Vec<u8>, ()>>) {
    let webview = VIEWS.with(|views| views.borrow().get(&id).map(wry::WebViewExtMacOS::webview));
    let (Some(webview), Some(mtm)) = (webview, MainThreadMarker::new()) else {
        let _ = sent.send(Err(()));
        return;
    };
    let done = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
        // SAFETY: WebKit passes the snapshot, or null with an error.
        let rgba = unsafe { image.as_ref() }.and_then(|image| rgba_of(image, width, height));
        let _ = sent.send(rgba.ok_or(()));
    });
    // SAFETY: on the main thread, with a live WKWebView; the configuration is fully set before the
    // call, and WebKit copies the block.
    unsafe {
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(f64::from(width), f64::from(height)),
        ));
        config.setAfterScreenUpdates(true);
        config.setSnapshotWidth(Some(&NSNumber::new_f64(f64::from(width) / scale)));
        webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &done);
    }
}

/// The image drawn into an sRGB RGBA buffer of exactly `width × height` pixels.
fn rgba_of(image: &NSImage, width: u32, height: u32) -> Option<Vec<u8>> {
    let (w, h) = (width as usize, height as usize);
    let mut rgba = vec![0u8; w * h * 4];
    // SAFETY: the context draws into `rgba`, which is `w * h * 4` bytes with rows of `w * 4`, and
    // outlives the context; the image and colour space are live CoreGraphics objects.
    unsafe {
        let cg: objc2::rc::Retained<CGImage> =
            image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None)?;
        let space = CGColorSpace::with_name(Some(kCGColorSpaceSRGB))?;
        let context = CGBitmapContextCreate(
            rgba.as_mut_ptr().cast::<c_void>(),
            w,
            h,
            8,
            w * 4,
            Some(&space),
            CGImageAlphaInfo::PremultipliedLast.0,
        )?;
        let rect = CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(f64::from(width), f64::from(height)),
        );
        CGContext::draw_image(Some(&context), rect, Some(&cg));
    }
    Some(rgba)
}
