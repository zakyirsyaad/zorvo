//! All retained Objective-C objects and wry views stay on the main thread.
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyObject, MainThreadOnly};
use objc2_foundation::{
    MainThreadMarker, NSDictionary, NSError, NSJSONSerialization, NSJSONWritingOptions, NSString,
};
use objc2_web_kit::{
    WKContentWorld, WKFrameInfo, WKUserScript, WKUserScriptInjectionTime, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use wry::{WebViewBuilderExtMacos, WebViewExtMacOS};

use super::{navigation_url, Bounds};
#[path = "policy.rs"]
mod policy;
#[path = "site.rs"]
mod site;

const PAGE: &str = include_str!("page.js");
const CONSOLE: &str = include_str!("console.js");
// Preserve WebKit's native UA prefix while identifying a Safari-compatible
// browser. Raw WKWebView UAs make some sites serve a fixed-width fallback.
const APPLICATION_NAME: &str = concat!("Safari/605.1.15 Zorvo/", env!("CARGO_PKG_VERSION"));
const WORLD: &str = "xyz.zorvo.browser.operations";
const MAX_TABS: usize = 12;
const MAX_SESSIONS: usize = 8;
const RESULT_LIMIT: usize = 2 * 1024 * 1024;

type Response = Result<Value, String>;
type SharedReply = Rc<RefCell<Option<oneshot::Sender<Response>>>>;
type WeakReply = Weak<RefCell<Option<oneshot::Sender<Response>>>>;

struct Reply(SharedReply);
impl Reply {
    fn is_closed(&self) -> bool {
        self.0
            .borrow()
            .as_ref()
            .is_none_or(oneshot::Sender::is_closed)
    }
    fn send(self, value: Response) -> Result<(), Response> {
        match self.0.borrow_mut().take() {
            Some(sender) => sender.send(value),
            None => Err(value),
        }
    }
}

fn cancel_pending(pending: &mut Vec<WeakReply>) {
    for reply in pending.drain(..).filter_map(|reply| reply.upgrade()) {
        if let Some(sender) = reply.borrow_mut().take() {
            let _ = sender.send(Err(
                "WebKit could not complete the script (the page navigated or closed).".into(),
            ));
        }
    }
}

pub(super) struct Tab {
    view: wry::WebView,
    _delegate: Retained<policy::BrowserDelegate>,
    frames: Vec<(String, Retained<WKFrameInfo>)>,
    loading: bool,
    initial_url: String,
    dialog: Option<policy::Dialog>,
    document: Option<String>,
    picker: Option<Picker>,
    pending: Vec<WeakReply>,
}
pub(super) struct Picker {
    document: String,
    nonce: String,
    request_id: String,
}
struct Session {
    store: Retained<WKWebsiteDataStore>,
    tabs: Vec<(String, Tab)>,
    active: Option<String>,
}
thread_local! {
    static SESSIONS: RefCell<HashMap<String,Session>> = RefCell::new(HashMap::new());
}

pub(super) fn with_tab<R>(
    session: &str,
    tab: &str,
    apply: impl FnOnce(&mut Tab) -> R,
) -> Option<R> {
    SESSIONS.with(|sessions| {
        sessions
            .borrow_mut()
            .get_mut(session)?
            .tabs
            .iter_mut()
            .find(|(id, _)| id == tab)
            .map(|(_, tab)| apply(tab))
    })
}

fn metadata(id: &str, tab: &Tab) -> Value {
    let view = tab.view.webview();
    // SAFETY: called only on the main thread for a retained WKWebView.
    unsafe {
        json!({"id":id,"engine":"WebKit","url":view.URL().and_then(|u|u.absoluteString()).map(|s|s.to_string()).unwrap_or_else(||tab.initial_url.clone()),
        "title":view.title().map(|v|v.to_string()).unwrap_or_else(||"New tab".into()),"loading":tab.loading,
        "canGoBack":view.canGoBack(),"canGoForward":view.canGoForward(),"zoomFactor":view.pageZoom()})
    }
}
fn state(session_id: &str) -> Value {
    SESSIONS.with(|sessions| {
        let sessions=sessions.borrow();
        if let Some(session)=sessions.get(session_id) {
            let dialog=session.active.as_ref().and_then(|id|session.tabs.iter().find(|(tid,_)|tid==id)).and_then(|(_,tab)|tab.dialog.as_ref()).map(|d|d.info.clone());
            json!({"sessionId":session_id,"tabs":session.tabs.iter().map(|(id,t)|metadata(id,t)).collect::<Vec<_>>(),"activeTabId":session.active,"dialog":dialog})
        } else { json!({"sessionId":session_id,"tabs":[],"activeTabId":null}) }
    })
}
pub(super) fn changed(app: &AppHandle, session: &str) {
    let _ = app.emit("browser-state-changed", state(session));
}

#[cfg(debug_assertions)]
pub(super) fn smoke_process(pid: libc::pid_t) -> Value {
    // SAFETY: fixed-size read of a known process; this never requests a grant.
    unsafe {
        let mut info: libc::proc_taskinfo = std::mem::zeroed();
        let size = std::mem::size_of_val(&info) as libc::c_int;
        let written = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTASKINFO,
            0,
            (&mut info as *mut libc::proc_taskinfo).cast(),
            size,
        );
        let gone = libc::kill(pid, 0) == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
        let mut bsd: libc::proc_bsdinfo = std::mem::zeroed();
        let bsd_size = std::mem::size_of_val(&bsd) as libc::c_int;
        let bsd_written = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut bsd as *mut libc::proc_bsdinfo).cast(),
            bsd_size,
        );
        json!({"pid":pid,"gone":gone,"status":(bsd_written==bsd_size).then_some(bsd.pbi_status),
            "parentPid":(bsd_written==bsd_size).then_some(bsd.pbi_ppid),
            "residentBytes":(written==size).then_some(info.pti_resident_size),
            "cpuNanoseconds":(written==size).then_some(info.pti_total_user+info.pti_total_system)})
    }
}

/// Native observations for the opt-in integration harness, never an IPC command.
#[cfg(debug_assertions)]
pub(super) async fn smoke_state(app: &AppHandle) -> Result<Value, String> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let value = SESSIONS.with(|sessions| {
            let sessions = sessions.borrow();
            let rows: Vec<_> = sessions
                .iter()
                .map(|(id, session)| {
                    let tabs: Vec<_> = session
                        .tabs
                        .iter()
                        .map(|(id, tab)| {
                            // Retained native views are inspected on their main thread.
                            {
                                let view = tab.view.webview();
                                let frame = view.frame();
                                // SAFETY: optional debug observation, guarded on this retained main-thread view.
                                let process = unsafe {
                                    let supported: bool = msg_send![&*view, respondsToSelector:objc2::sel!(_webProcessIdentifier)];
                                    if supported {
                                        let pid: libc::pid_t = msg_send![&*view, _webProcessIdentifier];
                                        (pid > 0).then(|| smoke_process(pid))
                                    } else { None }
                                };
                                let network = unsafe {
                                    let store = view.configuration().websiteDataStore();
                                    let supported: bool = msg_send![&*store, respondsToSelector:objc2::sel!(_networkProcessIdentifier)];
                                    if supported {
                                        let pid: libc::pid_t = msg_send![&*store, _networkProcessIdentifier];
                                        (pid > 0).then(|| smoke_process(pid))
                                    } else { None }
                                };
                                let navigation = unsafe { json!({"url":view.URL().and_then(|u|u.absoluteString()).map(|u|u.to_string()),"loading":view.isLoading(),"progress":view.estimatedProgress()}) };
                                json!({"id":id,"hidden":view.isHidden(),"bounds":{
                            "x":frame.origin.x,"y":frame.origin.y,
                            "width":frame.size.width,"height":frame.size.height},"process":process,"networkProcess":network,"navigation":navigation})
                            }
                        })
                        .collect();
                    json!({"id":id,"tabs":tabs})
                })
                .collect();
            json!({"sessions":rows,"totalSessions":sessions.len(),"appProcess":smoke_process(std::process::id() as libc::pid_t),
                "totalTabs":sessions.values().map(|session| session.tabs.len()).sum::<usize>()})
        });
        let _ = send.send(value);
    })
    .map_err(|_| "The browser main thread is unavailable.")?;
    tokio::time::timeout(Duration::from_secs(3), receive)
        .await
        .map_err(|_| "Native browser inspection timed out.")?
        .map_err(|_| "Native browser inspection was cancelled.".into())
}

fn world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
    // SAFETY: named worlds separate script globals and are created on main.
    unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) }
}

fn create(app: &AppHandle, sid: &str, url: &str) -> Result<String, String> {
    let mtm = MainThreadMarker::new().ok_or("Browser view must be created on the main thread.")?;
    policy::check_inherited_authorization()?;
    let window = app
        .get_webview_window("main")
        .ok_or("The main window is unavailable.")?;
    let id = format!("tab_{}", NEXT.fetch_add(1, Ordering::Relaxed));
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        if !sessions.contains_key(sid) && sessions.len() >= MAX_SESSIONS {
            return Err("Close a browser session before opening another.".into());
        }
        let session = sessions.entry(sid.into()).or_insert_with(|| Session {
            // SAFETY: each app session owns one non-persistent store; per-tab configurations are separate.
            store: unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) },
            tabs: vec![],
            active: None,
        });
        if session.tabs.len() >= MAX_TABS {
            return Err("This session has reached its browser tab limit.".into());
        }
        // SAFETY: configuration, preferences, content controller and scripts are retained native objects on main.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let delegate = policy::BrowserDelegate::new(mtm, app.clone(), sid.into(), id.clone());
        unsafe {
            config.setWebsiteDataStore(&session.store);
            config.setApplicationNameForUserAgent(Some(&NSString::from_str(APPLICATION_NAME)));
            config
                .preferences()
                .setJavaScriptCanOpenWindowsAutomatically(true);
            policy::disable_screen_capture(&config.preferences())?;
            let controller = config.userContentController();
            controller.addScriptMessageHandler_contentWorld_name(
                objc2::runtime::ProtocolObject::from_ref(&*delegate),
                &world(mtm),
                &NSString::from_str("zorvoBrowserFrame"),
            );
            let isolated =
                WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                    WKUserScript::alloc(mtm),
                    &NSString::from_str(PAGE),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    false,
                    &world(mtm),
                );
            controller.addUserScript(&isolated);
            let console = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                WKUserScript::alloc(mtm),
                &NSString::from_str(CONSOLE),
                WKUserScriptInjectionTime::AtDocumentStart,
                false,
            );
            controller.addUserScript(&console);
        }
        let loaded_app = app.clone();
        let loaded_sid = sid.to_string();
        let loaded_id = id.clone();
        let popup_app = app.clone();
        let popup_sid = sid.to_string();
        let view = wry::WebViewBuilder::new()
            .with_webview_configuration(config)
            .with_visible(false)
            .with_bounds(rect(Bounds {
                x: 0.,
                y: 0.,
                width: 800.,
                height: 600.,
            }))
            .with_navigation_handler(|raw| navigation_url(&raw).is_ok())
            .with_new_window_req_handler(move |raw, _| {
                if navigation_url(&raw).is_ok() {
                    let app = popup_app.clone();
                    let session = popup_sid.clone();
                    let _ = popup_app.run_on_main_thread(move || {
                        if create(&app, &session, &raw).is_ok() {
                            changed(&app, &session);
                        }
                    });
                }
                wry::NewWindowResponse::Deny
            })
            .with_permission_handler(|_| wry::PermissionResponse::Deny)
            .with_download_started_handler(|_, _| false)
            .with_on_page_load_handler(move |event, _| {
                let app = loaded_app.clone();
                let sid = loaded_sid.clone();
                let tid = loaded_id.clone();
                let _ = loaded_app.run_on_main_thread(move || {
                    with_tab(&sid, &tid, |tab| {
                        tab.loading = matches!(event, wry::PageLoadEvent::Started);
                        if tab.loading {
                            cancel_pending(&mut tab.pending);
                            tab.frames.clear();
                            tab.document = None;
                            if let Some(picker) = tab.picker.take() {
                                let _ = app.emit("browser-element-picked", json!({"sessionId":sid,"tabId":tid,"requestId":picker.request_id,"cancelled":true}));
                            }
                            if let Some(d) = tab.dialog.take() {
                                d.dismiss();
                            }
                        } else {
                            let meta = metadata(&tid, tab);
                            if let (Some(url), Some(title)) = (meta["url"].as_str(), meta["title"].as_str()) {
                                super::history::record(&app, url.into(), title.into());
                            }
                        }
                    });
                    changed(&app, &sid);
                });
            })
            .build_as_child(&window)
            .map_err(|e| format!("Could not create the browser view: {e}"))?;
        unsafe {
            view.webview()
                .setUIDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));
        }
        // First untrusted load starts only after capture denial and the isolated
        // data handler are installed. wry's default delegate never sees a page.
        if url != "about:blank" {
            view.load_url(url)
                .map_err(|e| format!("Could not load the browser page: {e}"))?;
        }
        // No app initialization script or invoke key exists in this view. Only our isolated data handler is installed.
        for (_, tab) in &session.tabs {
            let _ = tab.view.set_visible(false);
        }
        session.tabs.push((
            id.clone(),
            Tab {
                view,
                _delegate: delegate,
                frames: vec![],
                loading: url != "about:blank",
                initial_url: url.into(),
                dialog: None,
                document: None,
                picker: None,
                pending: vec![],
            },
        ));
        session.active = Some(id.clone());
        Ok(id)
    })
}
static NEXT: AtomicU64 = AtomicU64::new(1);
fn rect(b: Bounds) -> wry::Rect {
    wry::Rect {
        position: wry::dpi::LogicalPosition::new(b.x, b.y).into(),
        size: wry::dpi::LogicalSize::new(b.width, b.height).into(),
    }
}

fn end(mut tab: Tab) {
    cancel_pending(&mut tab.pending);
    if let Some(dialog) = tab.dialog.take() {
        dialog.dismiss();
    }
    let view = tab.view.webview();
    // SAFETY: this retained WKWebView stays on its main thread. Each private
    // termination/reset/close selector is checked before a no-argument void
    // call. Reset ends provisional process state too; close releases the page
    // state which wry's intentionally retained native wrapper can keep alive.
    unsafe {
        view.stopLoading();
        let controller = view.configuration().userContentController();
        let mtm = MainThreadMarker::new().expect("browser close on main");
        controller.removeScriptMessageHandlerForName_contentWorld(
            &NSString::from_str("zorvoBrowserFrame"),
            &world(mtm),
        );
        view.setUIDelegate(None);
        let responds: bool =
            msg_send![&*view,respondsToSelector:objc2::sel!(_killWebContentProcess)];
        let reset: bool =
            msg_send![&*view,respondsToSelector:objc2::sel!(_killWebContentProcessAndResetState)];
        if reset {
            let _: () = msg_send![&*view, _killWebContentProcessAndResetState];
        } else if responds {
            let _: () = msg_send![&*view, _killWebContentProcess];
        }
        let close: bool = msg_send![&*view,respondsToSelector:objc2::sel!(_close)];
        if close {
            let _: () = msg_send![&*view, _close];
        }
    }
    drop(tab);
}

pub async fn execute(app: &AppHandle, sid: String, args: Value) -> Result<Value, String> {
    let (send, receive) = oneshot::channel();
    let handle = app.clone();
    let timeout = args
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(10000)
        .clamp(100, 30000)
        + 2000;
    app.run_on_main_thread(move || {
        dispatch(
            &handle,
            &sid,
            args,
            Reply(Rc::new(RefCell::new(Some(send)))),
        )
    })
    .map_err(|_| "The browser main thread is unavailable.")?;
    tokio::time::timeout(Duration::from_millis(timeout), receive)
        .await
        .map_err(|_| "The browser operation timed out.")?
        .map_err(|_| "The browser operation was cancelled.")?
}

fn dispatch(app: &AppHandle, sid: &str, args: Value, reply: Reply) {
    if reply.is_closed() {
        return;
    }
    if let Err(error) = crate::browser_commands::check_authorization(app, sid, &args) {
        let _ = reply.send(Err(error));
        return;
    }
    let operation = args.get("operation").and_then(Value::as_str).unwrap_or("");
    if operation == "tabs.list" {
        let _ = reply.send(Ok(state(sid)));
        return;
    }
    if operation == "__manual_tabs_new_blank" {
        let answer = create(app, sid, "about:blank");
        if answer.is_ok() {
            changed(app, sid);
        }
        let _ = reply.send(answer.map(|id| json!({"tabId":id,"state":state(sid)})));
        return;
    }
    if operation == "tabs.open" {
        let answer = args
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Provide a URL.".into())
            .and_then(navigation_url)
            .and_then(|url| create(app, sid, &url));
        if answer.is_ok() {
            changed(app, sid);
        }
        let _ = reply.send(answer.map(|id| json!({"tabId":id,"state":state(sid)})));
        return;
    }
    let tid = args
        .get("tabId")
        .or_else(|| args.get("tabID"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| SESSIONS.with(|s| s.borrow().get(sid).and_then(|s| s.active.clone())));
    let Some(tid) = tid else {
        let _ = reply.send(Err("Open a browser tab first.".into()));
        return;
    };
    if operation == "tabs.close" {
        let result = SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let session = sessions
                .get_mut(sid)
                .ok_or("The browser session is closed.")?;
            let index = session
                .tabs
                .iter()
                .position(|(id, _)| id == &tid)
                .ok_or("The browser tab is closed.")?;
            let (_, tab) = session.tabs.remove(index);
            end(tab);
            if session.active.as_deref() == Some(&tid) {
                session.active = session.tabs.first().map(|(id, _)| id.clone());
            }
            if session.tabs.is_empty() {
                sessions.remove(sid);
            }
            Ok(())
        });
        changed(app, sid);
        let _ = reply.send(result.map(|_| state(sid)));
        return;
    }
    if operation == "tabs.focus" {
        let result = SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let s = sessions
                .get_mut(sid)
                .ok_or("The browser session is closed.")?;
            if !s.tabs.iter().any(|(id, _)| id == &tid) {
                return Err("The browser tab is closed.");
            }
            s.active = Some(tid.clone());
            for (_, t) in &s.tabs {
                let _ = t.view.set_visible(false);
            }
            Ok(())
        });
        changed(app, sid);
        let _ = reply.send(result.map(|_| state(sid)).map_err(str::to_string));
        return;
    }
    let mut reply = Some(reply);
    let found = with_tab(sid, &tid, |tab| {
        let reply = reply.take().expect("one native operation");
        tab.pending.retain(|reply| {
            reply
                .upgrade()
                .is_some_and(|reply| !Reply(reply).is_closed())
        });
        if !matches!(
            operation,
            "navigate"
                | "back"
                | "forward"
                | "reload"
                | "stop"
                | "dialog"
                | "frames"
                | "__manual_zoom"
        ) {
            if tab.pending.len() >= 64 {
                let _ = reply.send(Err(
                    "Too many pending operations in this browser tab.".into()
                ));
                return;
            }
            tab.pending.push(Rc::downgrade(&reply.0));
        }
        match operation {
            "__manual_zoom" => {
                // SAFETY: this public WebKit property belongs to the retained
                // session-owned view on its main thread, not to page script.
                let result = unsafe {
                    let view = tab.view.webview();
                    super::next_zoom(view.pageZoom(), args["action"].as_str().unwrap_or_default())
                        .map(|factor| {
                            view.setPageZoom(factor);
                            json!({"zoomFactor":view.pageZoom()})
                        })
                };
                let _ = reply.send(result);
            }
            "__manual_site_info" => {
                site::read(Retained::into_super(tab.view.webview()), sid, &tid, reply)
            }
            "__manual_site_cookies_clear" => {
                let expected = args["expectedUrl"].as_str().unwrap_or_default();
                site::clear_cookies(
                    Retained::into_super(tab.view.webview()),
                    sid,
                    &tid,
                    expected,
                    reply,
                );
            }
            "__manual_site_clear" => {
                let expected = args["expectedUrl"].as_str().unwrap_or_default();
                let view = tab.view.webview();
                // SAFETY: dispatch runs on the main thread and retains this tab's view.
                let current = unsafe {
                    view.URL()
                        .and_then(|url| url.absoluteString())
                        .map(|url| url.to_string())
                };
                if current.as_deref() != Some(expected) {
                    let _ = reply.send(Err(
                        "The page changed. Open site information again before clearing its data."
                            .into(),
                    ));
                } else {
                    helper(&view, None, &tab.frames, &args, reply);
                }
            }
            "__manual_pick" => {
                let enabled = args["enabled"] == true;
                let request_id = args["requestId"].as_str().unwrap_or_default();
                if !enabled {
                    if tab
                        .picker
                        .as_ref()
                        .is_none_or(|picker| picker.request_id != request_id)
                    {
                        let _ = reply.send(Ok(json!({"active":false})));
                        return;
                    }
                    tab.picker = None;
                    helper(&tab.view.webview(), None, &tab.frames, &args, reply);
                    return;
                }
                if tab.loading {
                    let _ = reply.send(Err(
                        "Wait for the page to finish loading before selecting an element.".into(),
                    ));
                    return;
                }
                let Some(document) = tab.document.clone() else {
                    let _ = reply.send(Err("Reload this page before selecting an element.".into()));
                    return;
                };
                let mut nonce = [0u8; 16];
                if getrandom::fill(&mut nonce).is_err() {
                    let _ = reply.send(Err("The browser picker could not be started.".into()));
                    return;
                }
                let nonce = nonce
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                tab.picker = Some(Picker {
                    document: document.clone(),
                    nonce: nonce.clone(),
                    request_id: request_id.into(),
                });
                let mut args = args.clone();
                args["document"] = json!(document);
                args["nonce"] = json!(nonce);
                helper(&tab.view.webview(), None, &tab.frames, &args, reply);
            }
            "navigate" => {
                let result = args
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Provide a URL.".into())
                    .and_then(navigation_url)
                    .and_then(|u| {
                        cancel_pending(&mut tab.pending);
                        // A dialog can prevent navigation from starting, so the
                        // load-start callback is too late to dismiss it.
                        if let Some(dialog) = tab.dialog.take() {
                            dialog.dismiss();
                        }
                        tab.view.load_url(&u).map_err(|e| e.to_string())
                    })
                    .map(|_| json!({"navigating":true}));
                let _ = reply.send(result);
            }
            "back" | "forward" | "reload" | "stop" => {
                if operation != "stop" {
                    cancel_pending(&mut tab.pending);
                    if let Some(dialog) = tab.dialog.take() {
                        dialog.dismiss();
                    }
                }
                unsafe {
                    let v = tab.view.webview();
                    match operation {
                        "back" => {
                            v.goBack();
                        }
                        "forward" => {
                            v.goForward();
                        }
                        "reload" => {
                            v.reload();
                        }
                        _ => v.stopLoading(),
                    }
                }
                let _ = reply.send(Ok(json!({"accepted":true})));
            }
            "frames" => {
                let values=tab.frames.iter().map(|(id,f)|unsafe{json!({"id":id,"isMainFrame":f.isMainFrame(),"url":f.request().URL().and_then(|u|u.absoluteString()).map(|s|s.to_string())})}).collect::<Vec<_>>();
                let _ = reply.send(Ok(json!({"frames":values})));
            }
            "dialog" => {
                let action = args.get("action").and_then(Value::as_str).unwrap_or(
                    if args.get("accept").is_some() {
                        "answer"
                    } else {
                        "inspect"
                    },
                );
                if action == "inspect" {
                    let _ = reply.send(Ok(
                        json!({"dialog":tab.dialog.as_ref().map(|d|d.info.clone())}),
                    ));
                    return;
                }
                if !matches!(action, "accept" | "dismiss" | "answer") {
                    let _ = reply.send(Err(
                        "Dialog action must be inspect, accept or dismiss.".into()
                    ));
                    return;
                }
                if let Some(dialog) = tab.dialog.take() {
                    dialog.answer(
                        action == "accept"
                            || (action == "answer"
                                && args.get("accept").and_then(Value::as_bool).unwrap_or(false)),
                        args.get("text").and_then(Value::as_str),
                    );
                    let _ = reply.send(Ok(json!({"answered":true})));
                } else {
                    let _ = reply.send(Err("There is no pending page dialog.".into()));
                }
            }
            "screenshot" => screenshot(&tab.view.webview(), reply),
            "evaluate" | "console" => {
                let code = if operation == "console" {
                    "JSON.stringify({pageControlled:true,lines:globalThis.__zorvoConsole||[]})"
                        .to_owned()
                } else {
                    args.get("expression")
                        .or_else(|| args.get("script"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned()
                };
                if code.len() > 100000 {
                    let _ = reply.send(Err("The expression is too large.".into()));
                    return;
                }
                evaluate(
                    &tab.view.webview(),
                    &code,
                    args.get("frameId"),
                    &tab.frames,
                    reply,
                    operation == "console",
                    operation == "evaluate"
                        && args.get("expression").is_none()
                        && args.get("script").is_some(),
                );
            }
            "snapshot" | "find" | "wait" | "click" | "hover" | "drag" | "fill" | "fill_form"
            | "select" | "check" | "press" | "scroll" => {
                helper(
                    &tab.view.webview(),
                    args.get("frameId"),
                    &tab.frames,
                    &args,
                    reply,
                );
            }
            _ => {
                let _ = reply.send(Err(
                    "This operation requires the Chromium debug engine. Set engine to chromium."
                        .into(),
                ));
            }
        }
    });
    if found.is_none() {
        if let Some(reply) = reply {
            let _ = reply.send(Err(
                "The browser tab is closed or belongs to another session.".into(),
            ));
        }
    }
    if matches!(
        operation,
        "dialog" | "navigate" | "back" | "forward" | "reload" | "stop" | "__manual_zoom"
    ) {
        changed(app, sid);
    }
}

fn frame<'a>(
    id: Option<&Value>,
    frames: &'a [(String, Retained<WKFrameInfo>)],
) -> Result<Option<&'a WKFrameInfo>, String> {
    let Some(id) = id.and_then(Value::as_str) else {
        return Ok(None);
    };
    frames
        .iter()
        .find(|(fid, _)| fid == id)
        .map(|(_, f)| Some(&**f))
        .ok_or_else(|| "The frame reference is stale. Read frames again.".into())
}
fn callback(
    reply: Reply,
    parse: bool,
    helper: bool,
) -> RcBlock<dyn Fn(*mut AnyObject, *mut NSError)> {
    let reply = Rc::new(RefCell::new(Some(reply)));
    RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        let Some(reply) = reply.borrow_mut().take() else {
            return;
        };
        let result = if !error.is_null() {
            // SAFETY: WebKit retains the callback's error. Its message is bounded,
            // page-controlled diagnostic data, never a command or HTML.
            let message = unsafe {
                (&*error)
                    .userInfo()
                    .objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
                    .and_then(|value| {
                        value
                            .downcast_ref::<NSString>()
                            .map(|value| value.to_string())
                    })
                    .unwrap_or_else(|| (&*error).localizedDescription().to_string())
            };
            Err(format!(
                "WebKit could not complete the script: {}",
                message.chars().take(2000).collect::<String>()
            ))
        } else if value.is_null() {
            Ok(Value::Null)
        } else {
            // SAFETY: WebKit owns callback arguments for the callback's duration.
            let text = unsafe { (&*value).downcast_ref::<NSString>().map(|s| s.to_string()) };
            if let Some(text) = text {
                if text.len() > RESULT_LIMIT {
                    Err("The browser result exceeds 2 MiB.".into())
                } else if parse {
                    serde_json::from_str::<Value>(&text)
                        .map_err(|_| "WebKit returned invalid structured data.".to_string())
                        .and_then(|data| {
                            if helper {
                                if data.get("ok") == Some(&Value::Bool(true)) {
                                    Ok(data.get("value").cloned().unwrap_or(Value::Null))
                                } else {
                                    Err(data
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Browser helper failed.")
                                        .to_owned())
                                }
                            } else {
                                Ok(data)
                            }
                        })
                } else {
                    Ok(json!(text))
                }
            } else {
                unsafe {
                    NSJSONSerialization::dataWithJSONObject_options_error(
                        &*value,
                        NSJSONWritingOptions::FragmentsAllowed,
                    )
                }
                .map_err(|_| {
                    "The page returned a value that cannot be represented as JSON.".to_string()
                })
                .and_then(|data| {
                    if data.len() > RESULT_LIMIT {
                        Err("The browser result exceeds 2 MiB.".into())
                    } else {
                        serde_json::from_slice(&data.to_vec())
                            .map_err(|_| "WebKit returned invalid JSON.".to_string())
                    }
                })
            }
        };
        let _ = reply.send(result);
    })
}
fn helper(
    view: &WKWebView,
    id: Option<&Value>,
    frames: &[(String, Retained<WKFrameInfo>)],
    args: &Value,
    reply: Reply,
) {
    let selected = match frame(id, frames) {
        Ok(v) => v,
        Err(e) => {
            let _ = reply.send(Err(e));
            return;
        }
    };
    let mtm = MainThreadMarker::new().expect("browser helper main");
    let key = NSString::from_str("encoded");
    let data = NSString::from_str(&args.to_string());
    let arguments: Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[&*data]);
    let cb = callback(reply, true, true);
    // SAFETY: fixed helper body with typed JSON argument in a named world; never string interpolation.
    unsafe {
        view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str("return await globalThis.__zorvoBrowser.dispatch(encoded)"),
            Some(&arguments),
            selected,
            &world(mtm),
            Some(&cb),
        );
    }
}
fn evaluate(
    view: &WKWebView,
    source: &str,
    id: Option<&Value>,
    frames: &[(String, Retained<WKFrameInfo>)],
    reply: Reply,
    parse: bool,
    script: bool,
) {
    let selected = match frame(id, frames) {
        Ok(v) => v,
        Err(e) => {
            let _ = reply.send(Err(e));
            return;
        }
    };
    let mtm = MainThreadMarker::new().expect("browser evaluate main");
    let cb = callback(reply, parse, false);
    // SAFETY: caller-provided code is intentionally compiled by WebKit only in
    // the page world. It never enters our isolated helper or an IPC handler.
    // Avoid indirect eval: a site's CSP may deny eval while native execution is
    // available. Expression mode awaits promises; the script alias preserves
    // ordinary program completion values through WebKit's script API.
    unsafe {
        if script {
            view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(source),
                selected,
                &WKContentWorld::pageWorld(mtm),
                Some(&cb),
            );
        } else {
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&format!("return await (\n{source}\n)")),
                None,
                selected,
                &WKContentWorld::pageWorld(mtm),
                Some(&cb),
            );
        }
    }
}
fn screenshot(view: &WKWebView, reply: Reply) {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    let reply = Rc::new(RefCell::new(Some(reply)));
    let cb = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let Some(reply) = reply.borrow_mut().take() else {
            return;
        };
        let result = (|| {
            if image.is_null() || !error.is_null() {
                return Err("WebKit could not capture this page.".into());
            }
            // SAFETY: callback image is valid for the callback; conversion stays on main.
            let png = unsafe {
                let data = (&*image)
                    .TIFFRepresentation()
                    .ok_or("The snapshot is empty.")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&data)
                    .ok_or("The snapshot could not be decoded.")?;
                bitmap
                    .representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                    .ok_or("The snapshot could not be encoded.")?
            };
            let bytes = png.to_vec();
            if bytes.len() > 5 * 1024 * 1024 {
                return Err("The screenshot exceeds 5 MiB.".into());
            }
            Ok(
                json!({"engine":"WebKit","mimeType":"image/png","base64":base64::engine::general_purpose::STANDARD.encode(bytes)}),
            )
        })();
        let _ = reply.send(result);
    });
    unsafe {
        view.takeSnapshotWithConfiguration_completionHandler(None, &cb);
    }
}

pub async fn bounds(
    app: &AppHandle,
    sid: String,
    tid: Option<String>,
    bounds: Option<Bounds>,
    visible: bool,
) -> Result<(), String> {
    if visible {
        crate::artifacts::view::set_hidden(app, true);
    }
    let handle = app.clone();
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let bounds = handle.get_webview_window("main").and_then(|window| {
            let scale = window.scale_factor().ok()?;
            let size = window.inner_size().ok()?.to_logical::<f64>(scale);
            bounds
                .and_then(|b| {
                    crate::artifacts::view::checked_bounds(
                        crate::artifacts::view::Bounds {
                            x: b.x,
                            y: b.y,
                            width: b.width,
                            height: b.height,
                        },
                        size.width,
                        size.height,
                    )
                })
                .map(|b| Bounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
        });
        let result = SESSIONS.with(|sessions| {
            for (session_id, s) in sessions.borrow_mut().iter_mut() {
                for (id, tab) in &mut s.tabs {
                    let show = visible
                        && session_id == &sid
                        && Some(id.as_str()) == tid.as_deref()
                        && bounds.is_some();
                    if show {
                        tab.view
                            .set_bounds(rect(bounds.expect("checked bounds")))
                            .map_err(|e| e.to_string())?;
                    }
                    tab.view.set_visible(show).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        });
        let _ = send.send(result);
    })
    .map_err(|_| "The browser main thread is unavailable.")?;
    tokio::time::timeout(Duration::from_secs(5), receive)
        .await
        .map_err(|_| "Browser placement timed out.")?
        .map_err(|_| "Browser placement was cancelled.")?
}
pub fn close_session(app: &AppHandle, sid: String) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(s) = SESSIONS.with(|sessions| sessions.borrow_mut().remove(&sid)) {
            for (_, tab) in s.tabs {
                end(tab);
            }
        }
        changed(&app2, &sid);
    });
}
pub fn close_all(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        let sessions = SESSIONS.with(|sessions| std::mem::take(&mut *sessions.borrow_mut()));
        for (_, s) in sessions {
            for (_, tab) in s.tabs {
                end(tab);
            }
        }
    });
}

#[cfg(test)]
mod reply_tests {
    use super::*;

    #[test]
    fn navigation_cancels_a_pending_reply_before_a_late_webkit_completion() {
        let (send, mut receive) = oneshot::channel();
        let reply = Reply(Rc::new(RefCell::new(Some(send))));
        let late_callback = Reply(Rc::clone(&reply.0));
        let mut pending = vec![Rc::downgrade(&reply.0)];
        cancel_pending(&mut pending);
        assert!(pending.is_empty());
        assert!(receive
            .try_recv()
            .unwrap()
            .unwrap_err()
            .contains("navigated or closed"));
        assert!(late_callback.send(Ok(json!("outgoing document"))).is_err());
        assert!(reply.is_closed());
    }
}
