//! WKUIDelegate replaces wry's permissive defaults. No page can request an OS grant.
use block2::{Block, RcBlock};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{Bool, NSObject},
    DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{NSModalResponse, NSModalResponseOK, NSOpenPanel};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSObjectProtocol, NSProcessInfo, NSString, NSURL,
};
use objc2_web_kit::{
    WKFrameInfo, WKMediaCaptureType, WKNavigationAction, WKNavigationType, WKOpenPanelParameters,
    WKPermissionDecision, WKPreferences, WKScriptMessage, WKScriptMessageHandler, WKSecurityOrigin,
    WKUIDelegate, WKUserContentController, WKWebView, WKWebViewConfiguration, WKWindowFeatures,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};
use wry::WebViewExtMacOS;
static NEXT_FRAME: AtomicU64 = AtomicU64::new(1);

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

pub fn check_inherited_authorization() -> Result<(), String> {
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 12
    {
        return Err("The embedded browser requires macOS 12 or later.".into());
    }
    // A plain child can inherit a launcher's TCC identity. If just one device
    // is authorized, requesting the other can terminate an app without usage
    // strings before its denial delegate runs. Refuse this unsafe launch shape.
    let class = objc2::runtime::AnyClass::get(c"AVCaptureDevice")
        .ok_or("Capture authorization could not be checked.")?;
    unsafe {
        let video: isize =
            msg_send![class, authorizationStatusForMediaType: &*NSString::from_str("vide")];
        let audio: isize =
            msg_send![class, authorizationStatusForMediaType: &*NSString::from_str("soun")];
        if (video == 3) != (audio == 3) {
            return Err("Open Zorvo from Finder or with open -a Zorvo before using its embedded browser. This shell launch inherits an unsafe partial capture authorization.".into());
        }
    }
    Ok(())
}

pub fn disable_screen_capture(preferences: &WKPreferences) -> Result<(), String> {
    // SAFETY: private selectors are guarded and read back before any WKWebView exists.
    unsafe {
        let set: bool =
            msg_send![preferences,respondsToSelector:objc2::sel!(_setScreenCaptureEnabled:)];
        let get: bool =
            msg_send![preferences,respondsToSelector:objc2::sel!(_screenCaptureEnabled)];
        if !set || !get {
            return Err("This WebKit cannot disable page screen capture safely.".into());
        }
        let _: () = msg_send![preferences,_setScreenCaptureEnabled:false];
        let enabled: bool = msg_send![preferences, _screenCaptureEnabled];
        if enabled {
            return Err("WebKit did not disable screen capture.".into());
        }
    }
    Ok(())
}

pub struct DelegateData {
    app: AppHandle,
    session: String,
    tab: String,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind=MainThreadOnly]
    #[ivars=DelegateData]
    pub struct BrowserDelegate;

    unsafe impl NSObjectProtocol for BrowserDelegate {}

    unsafe impl WKScriptMessageHandler for BrowserDelegate {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn frame(&self,_controller:&WKUserContentController,message:&WKScriptMessage){
            // SAFETY: WebKit supplies this live message on the main-thread delegate callback.
            // Only a fixed isolated-world handler reaches here, never a page-world IPC command.
            let frame=unsafe{message.frameInfo()};
            let body=unsafe{message.body()};
            let Some(raw)=body.downcast_ref::<NSString>().map(|text|text.to_string()) else{return;};
            if raw.len()>40*1024{return;}
            let Ok(data)=serde_json::from_str::<Value>(&raw) else{return;};
            // SAFETY: the live message retains its world for this callback.
            // Native sender identity and the named world remain mandatory even for data messages.
            let valid_world=unsafe{message.world().name().is_some_and(|name|name.to_string()==super::WORLD)};
            if !valid_world{return;}
            let sid=&self.ivars().session;let tid=&self.ivars().tab;
            // SAFETY: with_tab keeps the native view alive on this main-thread callback.
            let picked=super::with_tab(sid,tid,|tab|unsafe{
                let sender=message.webView();
                if sender.as_ref().is_none_or(|view|!std::ptr::eq(&**view,&**tab.view.webview())){return None;}
                if data["kind"]=="frame" {
                    let document=data["document"].as_str().filter(|value|document_token(value))?;
                    if frame.isMainFrame(){tab.document=Some(document.into());}
                    if tab.frames.len()<100 && !tab.frames.iter().any(|(_,f)|std::ptr::eq(&**f,&*frame)){tab.frames.push((format!("frame_{}",NEXT_FRAME.fetch_add(1,Ordering::Relaxed)),frame));}
                    return None;
                }
                if !frame.isMainFrame() || tab.loading{return None;}
                if data["kind"]=="popup-link" {
                    if data["document"].as_str()!=tab.document.as_deref(){return None;}
                    let url=super::navigation_url(data["url"].as_str()?).ok()?;
                    tab.popup_link=Some(super::PopupLink{url,document:tab.document.clone()?,at:std::time::Instant::now()});
                    return None;
                }
                let arm=tab.picker.as_ref()?;
                if tab.document.as_deref()!=Some(&arm.document){return None;}
                let mut payload=picker_message(&data,&arm.document,&arm.nonce)?;
                let url=tab.view.webview().URL().and_then(|url|url.absoluteString()).map(|url|url.to_string())?;
                if super::navigation_url(&url).is_err(){return None;}
                payload["sessionId"]=json!(sid);payload["tabId"]=json!(tid);payload["requestId"]=json!(arm.request_id);payload["url"]=json!(url);
                tab.picker=None;
                Some(payload)
            }).flatten();
            if let Some(picked)=picked{let _=self.ivars().app.emit("browser-element-picked",picked);}
        }
    }
    unsafe impl WKUIDelegate for BrowserDelegate {
        #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn popup(&self,_view:&WKWebView,_configuration:&WKWebViewConfiguration,action:&WKNavigationAction,_features:&WKWindowFeatures)->*mut WKWebView {
            // WebKit can ask this delegate about a blocked window.open even
            // with automatic windows disabled. Navigation type alone also accepts
            // synthetic clicks, so require the isolated world's trusted link event.
            let raw_url=unsafe{action.request().URL().and_then(|u|u.absoluteString()).map(|s|s.to_string())};
            let app=self.ivars().app.clone(); let session=self.ivars().session.clone(); let tab=self.ivars().tab.clone();
            if unsafe { action.navigationType() } != WKNavigationType::LinkActivated {
                let app2=app.clone();
                let _=app.run_on_main_thread(move||{
                    super::record_blocked_popup(&app2,&session,&tab,raw_url.as_deref());
                });
                return std::ptr::null_mut();
            }
            // The click's address was stored in this normal form; compare like with like.
            if let Some(url)=raw_url.as_deref().and_then(|url|super::navigation_url(url).ok()) {
                let app2=app.clone();
                let _=app.run_on_main_thread(move||{
                    let allowed=super::with_tab(&session,&tab,|tab|tab.popup_link.take().is_some_and(|click|click.url==url && tab.document.as_ref()==Some(&click.document) && click.at.elapsed()<std::time::Duration::from_secs(2))).unwrap_or(false);
                    if allowed {
                        if super::create_background(&app2,&session,&url).is_ok(){super::changed(&app2,&session);}
                    } else {
                        super::record_blocked_popup(&app2,&session,&tab,Some(&url));
                    }
                });
            } else {
                let app2=app.clone();
                let _=app.run_on_main_thread(move||{
                    super::record_blocked_popup(&app2,&session,&tab,raw_url.as_deref());
                });
            }
            std::ptr::null_mut()
        }
        // Without this method a page's file input does nothing: WKWebView asks the app for files here.
        #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
        fn open_panel(&self,_view:&WKWebView,parameters:&WKOpenPanelParameters,frame:&WKFrameInfo,completion:&Block<dyn Fn(*mut NSArray<NSURL>)>){
            self.choose_files(parameters,frame,completion.copy());
        }
        #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
        fn media(&self,_view:&WKWebView,_origin:&WKSecurityOrigin,_frame:&WKFrameInfo,_kind:WKMediaCaptureType,decision:&Block<dyn Fn(WKPermissionDecision)>){decision.call((WKPermissionDecision::Deny,));}

        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn alert(&self,_view:&WKWebView,_message:&NSString,_frame:&WKFrameInfo,completion:&Block<dyn Fn()>){completion.call(());}
        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn confirm(&self,_view:&WKWebView,_message:&NSString,_frame:&WKFrameInfo,completion:&Block<dyn Fn(Bool)>){completion.call((Bool::new(false),));}
        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn prompt(&self,_view:&WKWebView,_message:&NSString,_default_text:Option<&NSString>,_frame:&WKFrameInfo,completion:&Block<dyn Fn(*mut NSString)>){completion.call((std::ptr::null_mut(),));}
    }
    impl BrowserDelegate {
        // The SDK-generated objc2 bindings predate this public macOS 27 callback.
        #[unsafe(method(webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:))]
        fn location(&self,_view:&WKWebView,_origin:&WKSecurityOrigin,_frame:&WKFrameInfo,decision:&Block<dyn Fn(WKPermissionDecision)>){decision.call((WKPermissionDecision::Deny,));}
    }
);

fn document_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn picker_message(data: &Value, document: &str, nonce: &str) -> Option<Value> {
    if data["document"] != document || data["nonce"] != nonce {
        return None;
    }
    if data["kind"] == "picker-cancelled" {
        return Some(json!({"cancelled":true}));
    }
    if data["kind"] != "picker-selected" {
        return None;
    }
    let selector = data["selector"].as_str()?;
    let text = data["text"].as_str()?;
    let title = data["title"].as_str()?;
    if selector.is_empty()
        || selector.chars().count() > 2048
        || text.chars().count() > 4096
        || title.chars().count() > 512
    {
        return None;
    }
    Some(json!({"selector":selector,"text":text,"title":title}))
}

impl BrowserDelegate {
    pub fn new(
        mtm: MainThreadMarker,
        app: AppHandle,
        session: String,
        tab: String,
    ) -> Retained<Self> {
        let object = mtm
            .alloc::<Self>()
            .set_ivars(DelegateData { app, session, tab });
        unsafe { msg_send![super(object), init] }
    }
    /// Answers a page's file chooser: with the files an approved agent upload armed on this tab,
    /// when the asking frame is the approved origin, else with the system's open panel for the
    /// person at the keyboard. The completion runs exactly once on every path.
    fn choose_files(
        &self,
        parameters: &WKOpenPanelParameters,
        frame: &WKFrameInfo,
        completion: RcBlock<dyn Fn(*mut NSArray<NSURL>)>,
    ) {
        // SAFETY: WebKit calls the UI delegate on the main thread with a live frame.
        let origin = unsafe {
            let origin = frame.securityOrigin();
            crate::browser_upload::frame_origin(
                &origin.protocol().to_string(),
                &origin.host().to_string(),
                origin.port() as i64,
            )
        };
        let sid = &self.ivars().session;
        let tid = &self.ivars().tab;
        // An armed upload answers only a chooser from its own origin, and only once. A stale one is
        // dropped; one from another frame stays armed for the input the agent clicks.
        let armed = super::with_tab(sid, tid, |tab| {
            if tab.upload.as_ref().is_some_and(|upload| !upload.is_fresh()) {
                tab.upload = None;
            }
            match &tab.upload {
                Some(upload) if upload.origin == origin => {
                    let taken = tab.upload.take();
                    tab.upload_taken = taken.as_ref().map(|upload| upload.id);
                    taken.map(Some)
                }
                Some(_) => Some(None),
                None => None,
            }
        })
        .flatten();
        match armed {
            Some(Some(upload)) => {
                let urls: Vec<Retained<NSURL>> = upload
                    .paths
                    .iter()
                    .map(|path| {
                        NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
                    })
                    .collect();
                let array = NSArray::from_retained_slice(&urls);
                completion.call((Retained::as_ptr(&array) as *mut NSArray<NSURL>,));
            }
            // Another origin asked while an upload waits: it gets nothing, and no panel opens.
            Some(None) => completion.call((std::ptr::null_mut(),)),
            None => {
                let Some(mtm) = MainThreadMarker::new() else {
                    completion.call((std::ptr::null_mut(),));
                    return;
                };
                let panel = NSOpenPanel::openPanel(mtm);
                panel.setCanChooseFiles(true);
                // SAFETY: plain property reads of the parameters WebKit handed this call.
                let (directories, multiple) = unsafe {
                    (
                        parameters.allowsDirectories(),
                        parameters.allowsMultipleSelection(),
                    )
                };
                panel.setCanChooseDirectories(directories);
                panel.setAllowsMultipleSelection(multiple);
                let chosen = panel.clone();
                let handler = RcBlock::new(move |response: NSModalResponse| {
                    if response == NSModalResponseOK {
                        let urls = chosen.URLs();
                        completion.call((Retained::as_ptr(&urls) as *mut NSArray<NSURL>,));
                    } else {
                        completion.call((std::ptr::null_mut(),));
                    }
                });
                panel.beginWithCompletionHandler(&handler);
            }
        }
    }
}

#[cfg(test)]
mod picker_tests {
    use super::*;

    #[test]
    fn selection_requires_the_armed_document_and_nonce() {
        let value = json!({"kind":"picker-selected","document":"doc-a","nonce":"arm-a","selector":"button","text":"Selected","title":"Fixture"});
        assert!(picker_message(&value, "doc-a", "arm-a").is_some());
        assert!(picker_message(&value, "doc-b", "arm-a").is_none());
        assert!(picker_message(&value, "doc-a", "arm-b").is_none());
        assert!(picker_message(
            &json!({"kind":"picker-cancelled","document":"doc-a","nonce":"arm-a"}),
            "doc-a",
            "arm-a"
        )
        .is_some());
        assert!(picker_message(
            &json!({"kind":"picker-cancelled","document":"doc-b","nonce":"arm-a"}),
            "doc-a",
            "arm-a"
        )
        .is_none());
    }

    #[test]
    fn selected_page_data_is_bounded_and_not_an_action() {
        let mut value = json!({"kind":"picker-selected","document":"doc","nonce":"arm","selector":"#target","text":"literal \"page text\"","title":"Fixture","operation":"shell"});
        let normalized = picker_message(&value, "doc", "arm").unwrap();
        assert!(normalized.get("operation").is_none());
        value["selector"] = json!("x".repeat(2049));
        assert!(picker_message(&value, "doc", "arm").is_none());
        value["selector"] = json!("#target");
        value["text"] = json!("x".repeat(4097));
        assert!(picker_message(&value, "doc", "arm").is_none());
        assert!(!document_token("invalid\n"));
    }
}
