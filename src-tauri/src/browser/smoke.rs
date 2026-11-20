//! Debug-only exercise of the real native views using a synthetic loopback page.
use super::{browser_bounds, execute, Bounds};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::AppHandle;

static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// Start after the real frontend's startup teardown, which otherwise races the harness.
pub fn frontend_ready(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| FRONTEND_READY.store(true, Ordering::Release));
}

pub(super) async fn wait_document(
    app: &AppHandle,
    session: &str,
    tab: &str,
    url: &str,
    previous: Option<&Value>,
) -> Result<Value, String> {
    let mut last = Value::Null;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Ok(value) = execute(app, session.into(), json!({"operation":"evaluate","tabId":tab,
            "timeoutMs":1000,"expression":"({url:location.href,ready:document.readyState,document:window.smokeDocument})"})).await {
            last = value;
            if last["url"] == url && last["ready"] == "complete"
                && last["document"].as_str().is_some()
                && previous.is_none_or(|old| old != &last["document"]) {
                return Ok(last);
            }
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    Err(format!(
        "Replacement document did not finish loading: {last}"
    ))
}

async fn chrome_smoke(app: &AppHandle, session: &str, url: &str) -> Result<Value, String> {
    let session = session.to_string();
    let blank = super::new_tab(app, session.clone()).await?;
    let tab = blank["tabId"]
        .as_str()
        .ok_or("No new native blank tab.")?
        .to_string();
    let tabs = blank["state"]["tabs"]
        .as_array()
        .ok_or("Missing native blank tab state.")?;
    if tabs.len() != 1
        || tabs[0]["url"] != "about:blank"
        || tabs[0]["loading"] != false
        || tabs[0]["zoomFactor"] != 1.
    {
        return Err(format!("Native new tab did not stay blank: {blank}"));
    }
    execute(
        app,
        session.clone(),
        json!({"operation":"navigate","tabId":tab,"url":url}),
    )
    .await?;
    execute(
        app,
        session.clone(),
        json!({"operation":"wait","selector":"#increment"}),
    )
    .await?;
    execute(
        app,
        session.clone(),
        json!({"operation":"fill","selector":"#input","value":"retained zoom state"}),
    )
    .await?;
    let zoomed = super::zoom(app, session.clone(), tab.clone(), "in".into()).await?;
    let first = execute(app, session.clone(), json!({"operation":"tabs.list"})).await?;
    if zoomed["zoomFactor"] != 1.1 || first["tabs"][0]["zoomFactor"] != 1.1 {
        return Err(format!(
            "Native page zoom was not applied: {zoomed}; {first}"
        ));
    }
    let second = super::new_tab(app, session.clone()).await?;
    let second_id = second["tabId"]
        .as_str()
        .ok_or("No second blank native tab.")?
        .to_string();
    let second_tab = second["state"]["tabs"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == second_id))
        .ok_or("Missing second native tab.")?;
    if second_tab["zoomFactor"] != 1. {
        return Err("Page zoom leaked to another tab.".into());
    }
    execute(
        app,
        session.clone(),
        json!({"operation":"tabs.close","tabId":second_id}),
    )
    .await?;
    let reset = super::zoom(app, session.clone(), tab.clone(), "reset".into()).await?;
    let input = execute(
        app,
        session.clone(),
        json!({"operation":"evaluate","expression":"document.querySelector('#input').value"}),
    )
    .await?;
    if reset["zoomFactor"] != 1. || input != "retained zoom state" {
        return Err("Reset zoom lost the open page or input state.".into());
    }
    if super::zoom(app, session.clone(), tab.clone(), "unknown".into())
        .await
        .is_ok()
    {
        return Err("Unknown native zoom action was accepted.".into());
    }
    execute(app, session, json!({"operation":"tabs.close","tabId":tab})).await?;
    Ok(
        json!({"name":"native blank tabs and per-tab zoom/reset preserve form state","pass":true,"zoomed":zoomed,"reset":reset}),
    )
}

async fn responsive_smoke(
    app: &AppHandle,
    session: &str,
    base: &url::Url,
) -> Result<Value, String> {
    let session = session.to_string();
    let url = base
        .join("/responsive")
        .map_err(|_| "Invalid responsive fixture URL.")?;
    execute(
        app,
        session.clone(),
        json!({"operation":"tabs.open","url":url.as_str()}),
    )
    .await?;
    execute(
        app,
        session.clone(),
        json!({"operation":"wait","selector":"#responsive-ready"}),
    )
    .await?;
    let state = execute(app, session.clone(), json!({"operation":"tabs.list"})).await?;
    let tab = state["activeTabId"]
        .as_str()
        .ok_or("No responsive native tab.")?
        .to_string();
    execute(app, session.clone(), json!({"operation":"fill","selector":"#responsive-input","value":"preserved across resize"})).await?;
    let mut samples = vec![];
    let mut document = None;
    for width in [360., 560., 900.] {
        browser_bounds(
            app.clone(),
            session.clone(),
            Some(tab.clone()),
            Some(Bounds {
                x: 20.,
                y: 100.,
                width,
                height: 600.,
            }),
            true,
        )
        .await?;
        // WebKit applies native bounds asynchronously. Wait for layout in this
        // document rather than assuming the next IPC has already seen the resize.
        let mut sample = Value::Null;
        for _ in 0..20 {
            sample = execute(app, session.clone(), json!({"operation":"evaluate","expression":"({ua:navigator.userAgent,requestUa:window.responsiveRequest.ua,document:window.responsiveRequest.document,loads:Number(sessionStorage.getItem('responsive-loads')),width:innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,layout:getComputedStyle(document.body).getPropertyValue('--layout').trim(),input:document.querySelector('#responsive-input').value,bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser})"})).await?;
            if sample["width"]
                .as_f64()
                .is_some_and(|actual| (actual - width).abs() <= 1.)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let ua = sample["ua"]
            .as_str()
            .ok_or("Native user agent is missing.")?;
        if sample["requestUa"] != sample["ua"]
            || !ua.contains("AppleWebKit/")
            || !ua.contains("Safari/605.1.15")
            || !ua.contains(concat!("Zorvo/", env!("CARGO_PKG_VERSION")))
        {
            return Err(format!(
                "Native first-request browser identity mismatch: {sample}"
            ));
        }
        let actual_width = sample["width"]
            .as_f64()
            .ok_or("Native viewport width is missing.")?;
        let client = sample["clientWidth"]
            .as_f64()
            .ok_or("Native client width is missing.")?;
        let scroll = sample["scrollWidth"]
            .as_f64()
            .ok_or("Native document width is missing.")?;
        if (actual_width - width).abs() > 1.
            || client <= 0.
            || client > actual_width
            || scroll > client + 1.
        {
            return Err(format!(
                "Native viewport did not follow {width}px bounds without overflow: {sample}"
            ));
        }
        let expected_layout = if width <= 600. { "narrow" } else { "wide" };
        if sample["layout"] != expected_layout
            || sample["loads"] != 1
            || sample["input"] != "preserved across resize"
            || sample["bridge"] != "undefined"
            || sample["isolated"] != "undefined"
        {
            return Err(format!(
                "Native responsive layout or retained state failed: {sample}"
            ));
        }
        let current_document = sample["document"]
            .as_str()
            .ok_or("Responsive document identity is missing.")?;
        if document
            .as_deref()
            .is_some_and(|initial| initial != current_document)
        {
            return Err("Native resize reloaded the responsive document.".into());
        }
        document = Some(current_document.to_string());
        samples.push(sample);
    }
    execute(app, session, json!({"operation":"tabs.close","tabID":tab})).await?;
    Ok(
        json!({"name":"first-request browser identity and native responsive resizing preserve document state","pass":true,"samples":samples}),
    )
}

pub async fn smoke(app: &AppHandle) -> Result<Value, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while !FRONTEND_READY.load(Ordering::Acquire) {
        if std::time::Instant::now() >= deadline {
            return Err("The embedded frontend did not finish startup before native smoke.".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let url = std::env::var("ZORVO_BROWSER_SMOKE_URL").map_err(|_| "Smoke URL is missing.")?;
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid smoke URL.")?;
    if parsed.scheme() != "http" || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("Smoke testing requires a loopback HTTP fixture.".into());
    }
    let a = "native-browser-smoke-a".to_string();
    let b = "native-browser-smoke-b".to_string();
    let mut steps = vec![];
    let result=async{
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("popup") {
            let opened=execute(app,a.clone(),json!({"operation":"tabs.open","url":url})).await?;
            let tab=opened["tabId"].as_str().ok_or("No trusted-popup tab.")?.to_owned();
            wait_document(app,&a,&tab,&url,None).await?;
            browser_bounds(app.clone(),a.clone(),Some(tab.clone()),Some(Bounds{x:20.,y:100.,width:800.,height:600.}),true).await?;
            let deadline=Instant::now()+Duration::from_secs(90);
            loop {
                let state=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
                if state["tabs"].as_array().is_some_and(|tabs|tabs.len()>1) {
                    if state["activeTabId"]!=tab {return Err("A trusted popup replaced the selected tab.".into());}
                    steps.push(json!({"name":"trusted native link opens a background popup without changing the active tab","pass":true,"state":state}));
                    return Ok::<_,String>(());
                }
                if Instant::now()>=deadline {return Err("No trusted popup link click reached WebKit.".into());}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("lifecycle") {
            steps.push(super::lifecycle_smoke::smoke(app, &url).await?);
            return Ok::<_,String>(());
        }
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("forms") {
            steps.push(super::forms_smoke::smoke(app, &parsed).await?);
            return Ok::<_,String>(());
        }
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("placement") {
            steps.push(super::placement_smoke::smoke(app, &url).await?);
            return Ok::<_,String>(());
        }
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("sites") {
            steps.push(super::sites_smoke::smoke(app).await?);
            return Ok::<_,String>(());
        }
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("chrome") {
            steps.push(chrome_smoke(app, &a, &url).await?);
            return Ok::<_,String>(());
        }
        let delayed = parsed.join("/delayed").map_err(|_| "Invalid delayed fixture URL.")?;
        let opened=execute(app,a.clone(),json!({"operation":"tabs.open","url":delayed.as_str()})).await?;
        let delayed_tab=opened["tabId"].as_str().ok_or("No delayed native tab.")?.to_owned();
        execute(app,a.clone(),json!({"operation":"wait","tabId":delayed_tab,"selector":"#delayed-ready"})).await?;
        execute(app,a.clone(),json!({"operation":"click","tabId":delayed_tab,"selector":"#delayed-ready"})).await?;
        let count=execute(app,a.clone(),json!({"operation":"evaluate","tabId":delayed_tab,"expression":"document.querySelector('#delayed-ready').textContent"})).await?;
        if count!="1" {return Err("A deferred native interaction did not execute exactly once.".into());}
        execute(app,a.clone(),json!({"operation":"tabs.close","tabId":delayed_tab})).await?;
        steps.push(json!({"name":"immediate wait on a delayed first document reaches the helper and clicks once","pass":true}));
        let loading = parsed.join("/loading").map_err(|_| "Invalid loading fixture URL.")?;
        let opened=execute(app,a.clone(),json!({"operation":"tabs.open","url":loading.as_str()})).await?;
        let loading_tab=opened["tabId"].as_str().ok_or("No loading native tab.")?.to_owned();
        execute(app,a.clone(),json!({"operation":"wait","tabId":loading_tab,"selector":"#loading-ready"})).await?;
        execute(app,a.clone(),json!({"operation":"click","tabId":loading_tab,"selector":"#loading-ready"})).await?;
        let pending=execute(app,a.clone(),json!({"operation":"evaluate","tabId":loading_tab,"expression":"({count:document.querySelector('#loading-ready').textContent,ready:document.readyState})"})).await?;
        if pending["count"]!="1" || pending["ready"]=="complete" {return Err(format!("A pending image blocked usable DOM interactions: {pending}"));}
        execute(app,a.clone(),json!({"operation":"tabs.close","tabId":loading_tab})).await?;
        steps.push(json!({"name":"a stalled image does not block helper-ready DOM interactions","pass":true,"page":pending}));
        steps.push(responsive_smoke(app, &a, &parsed).await?);
        if std::env::var("ZORVO_BROWSER_SMOKE_CASE").as_deref() == Ok("responsive") {
            return Ok::<_,String>(());
        }
        steps.push(chrome_smoke(app, &a, &url).await?);
        execute(app,a.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,a.clone(),json!({"operation":"wait","selector":"#increment"})).await?;
        let state=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        let tid=state["activeTabId"].as_str().ok_or("No native active tab.")?.to_string();
        browser_bounds(app.clone(),a.clone(),Some(tid.clone()),Some(Bounds{x:20.,y:100.,width:800.,height:600.}),true).await?;
        let snapshot=execute(app,a.clone(),json!({"operation":"snapshot"})).await?;
        if snapshot.to_string().contains("synthetic-password-secret") || snapshot.to_string().contains("synthetic-code-secret") || snapshot.to_string().contains("synthetic-card-secret") || snapshot.to_string().contains("synthetic-unlabeled-card-secret") || snapshot.to_string().contains("synthetic-wrapped-card-secret") {
            return Err("A default native snapshot exposed a sensitive form value.".into());
        }
        let button=snapshot["controls"].as_array().and_then(|rows|rows.iter().find(|r|r["name"]=="Increment")).and_then(|r|r["ref"].as_str()).ok_or("Snapshot did not name the button.")?.to_owned();
        steps.push(json!({"name":"native view and isolated snapshot","pass":true}));
        execute(app,a.clone(),json!({"operation":"fill","selector":"#input","value":"changed"})).await?;
        execute(app,a.clone(),json!({"operation":"click","ref":button})).await?;
        execute(app,a.clone(),json!({"operation":"select","selector":"#choice","value":"b"})).await?;
        execute(app,a.clone(),json!({"operation":"check","selector":"#check","checked":true})).await?;
        let values=execute(app,a.clone(),json!({"operation":"evaluate","expression":"({input:document.querySelector('#input').value,count:document.querySelector('#count').textContent,choice:document.querySelector('#choice').value,checked:document.querySelector('#check').checked,inputEvents:document.body.dataset.inputEvents,bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser})"})).await?;
        if values["input"]!="changed"||values["count"]!="1"||values["choice"]!="b"||values["checked"]!=true||values["bridge"]!="undefined"||values["isolated"]!="undefined"{return Err(format!("Native form/isolation failed: {values}"));}
        steps.push(json!({"name":"ref click, controlled input, select, check, no app bridge","pass":true,"values":values}));
        let screenshot=execute(app,a.clone(),json!({"operation":"screenshot"})).await?;
        if screenshot["base64"].as_str().is_none_or(|s|s.len()<100){return Err("Native screenshot was empty.".into());}
        steps.push(json!({"name":"native PNG screenshot","pass":true,"base64Length":screenshot["base64"].as_str().map(str::len)}));
        browser_bounds(app.clone(),a.clone(),Some(tid),None,false).await?;
        let start=std::time::Instant::now();
        execute(app,a.clone(),json!({"operation":"click","ref":button})).await?;
        let hidden=execute(app,a.clone(),json!({"operation":"evaluate","expression":"({hidden:document.hidden,count:document.querySelector('#count').textContent})"})).await?;
        execute(app,a.clone(),json!({"operation":"screenshot"})).await?;
        if hidden["hidden"]!=true||hidden["count"]!="2"{return Err(format!("Hidden native interaction failed: {hidden}"));}
        steps.push(json!({"name":"hidden view click/state/native snapshot","pass":true,"elapsedMs":start.elapsed().as_millis(),"values":hidden}));
        execute(app,a.clone(),json!({"operation":"evaluate","expression":"(()=>{document.cookie='native_smoke=alpha; SameSite=Lax';return document.cookie})()"})).await?;
        execute(app,a.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,a.clone(),json!({"operation":"wait","selector":"#input"})).await?;
        let shared=execute(app,a.clone(),json!({"operation":"evaluate","expression":"document.cookie"})).await?;
        execute(app,b.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,b.clone(),json!({"operation":"wait","selector":"#input"})).await?;
        let separate=execute(app,b.clone(),json!({"operation":"evaluate","expression":"document.cookie"})).await?;
        if !shared.as_str().is_some_and(|s|s.contains("native_smoke=alpha"))||separate.as_str().is_some_and(|s|s.contains("native_smoke=alpha")){return Err("Session cookie isolation failed.".into());}
        steps.push(json!({"name":"shared store within session, separate store across sessions","pass":true}));
        let site_tab=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?["activeTabId"].as_str().ok_or("No site-controls tab.")?.to_owned();
        let other_tab=execute(app,b.clone(),json!({"operation":"tabs.list"})).await?["activeTabId"].as_str().ok_or("No independent site-controls tab.")?.to_owned();
        execute(app,a.clone(),json!({"operation":"evaluate","expression":"(()=>{localStorage.setItem('site_smoke','alpha');sessionStorage.setItem('site_smoke','alpha');document.cookie='path_smoke=alpha; Path=/private; SameSite=Lax';return true})()"})).await?;
        execute(app,b.clone(),json!({"operation":"evaluate","expression":"(()=>{document.cookie='other_smoke=beta; SameSite=Lax';return true})()"})).await?;
        let info=super::site_info(app,a.clone(),site_tab.clone()).await?;
        if info["cookieCount"]!=1 || info["security"]!="local" {return Err(format!("Native site metadata did not describe applicable cookies: {info}"));}
        let expected=info["url"].as_str().ok_or("Site URL missing.")?.to_owned();
        if super::site_clear(app,a.clone(),site_tab.clone(),format!("{expected}changed")).await.is_ok(){return Err("Site clear accepted a stale expected URL.".into());}
        let cleared=super::site_clear(app,a.clone(),site_tab.clone(),expected).await?;
        let storage=execute(app,a.clone(),json!({"operation":"evaluate","expression":"[localStorage.getItem('site_smoke'),sessionStorage.getItem('site_smoke'),document.cookie]"})).await?;
        let other=super::site_info(app,b.clone(),other_tab).await?;
        if cleared["cookieCount"]!=0 || storage!=json!([null,null,""]) || other["cookieCount"]!=1 {return Err(format!("Site clear escaped its session or kept origin data: {cleared}; {storage}; {other}"));}
        steps.push(json!({"name":"native site metadata and origin clear preserve other sessions and reject stale URLs","pass":true,"siteDataCleared":cleared["siteDataCleared"]}));
        let before=execute(app,a.clone(),json!({"operation":"evaluate","tabId":site_tab,"expression":"window.smokeDocument"})).await?;
        let same_tab_snapshot=execute(app,a.clone(),json!({"operation":"snapshot","tabId":site_tab})).await?;
        let same_tab_ref=same_tab_snapshot["controls"].as_array().and_then(|rows|rows.iter().find(|row|row["name"]=="Increment")).and_then(|row|row["ref"].as_str()).ok_or("No same-tab reference before navigation.")?;
        let mut destination=parsed.clone();destination.set_query(Some("navigation=smoke"));
        execute(app,a.clone(),json!({"operation":"navigate","tabId":site_tab,"url":destination.as_str()})).await?;
        let ready=wait_document(app,&a,&site_tab,destination.as_str(),Some(&before)).await?;
        if execute(app,a.clone(),json!({"operation":"click","tabId":site_tab,"ref":same_tab_ref})).await.is_ok(){return Err("A same-tab reference survived document replacement.".into());}
        steps.push(json!({"name":"navigation observes a new complete document and rejects its old same-tab ref","pass":true,"document":ready}));
        browser_bounds(app.clone(),a.clone(),Some(site_tab.clone()),Some(Bounds{x:20.,y:100.,width:800.,height:600.}),true).await?;
        let dialogs=execute(app,a.clone(),json!({"operation":"evaluate","tabId":site_tab,"expression":"(alert('Ignored alert'),{confirm:confirm('Ignored confirm'),prompt:prompt('Ignored prompt')})"})).await?;
        if dialogs!=json!({"confirm":false,"prompt":null}) {return Err(format!("Page dialogs did not return their denied defaults: {dialogs}"));}
        steps.push(json!({"name":"page dialogs return denied defaults without a UI or pending callback","pass":true}));
        let before=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        let selected=before["activeTabId"].as_str().ok_or("No active popup source tab.")?.to_owned();
        let popup=execute(app,a.clone(),json!({"operation":"evaluate","tabId":selected,"expression":"new Promise(resolve=>setTimeout(()=>resolve({blocked:window.open(location.href)===null}),50))"})).await?;
        let after=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        if popup["blocked"]!=true || before["tabs"].as_array().map(Vec::len)!=after["tabs"].as_array().map(Vec::len) || after["activeTabId"]!=selected {
            return Err(format!("An unprompted page popup changed native tabs: {popup}; {before}; {after}"));
        }
        execute(app,a.clone(),json!({"operation":"evaluate","tabId":selected,"expression":"(document.querySelector('#popup-link').click(),true)"})).await?;
        tokio::time::sleep(Duration::from_millis(100)).await;
        let scripted_link=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        if scripted_link["tabs"].as_array().map(Vec::len)!=after["tabs"].as_array().map(Vec::len) {return Err("A script-generated hyperlink click opened a popup without a trusted event.".into());}
        let (send,receive)=tokio::sync::oneshot::channel();
        let (handle,session,target)=(app.clone(),a.clone(),url.clone());
        app.run_on_main_thread(move||{let _=send.send(super::native::create_background(&handle,&session,&target));}).map_err(|_|"Popup background test could not reach main.")?;
        let background=receive.await.map_err(|_|"Popup background creation was cancelled.")??;
        let background_state=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        if background_state["activeTabId"]!=selected || background_state["tabs"].as_array().map(Vec::len)!=before["tabs"].as_array().map(|tabs|tabs.len()+1) {
            return Err(format!("A page-created tab took over the selected tab: {background_state}"));
        }
        execute(app,a.clone(),json!({"operation":"tabs.close","tabId":background})).await?;
        steps.push(json!({"name":"automatic popup is blocked and page-created background tab preserves selection","pass":true,"automaticPopupBlocked":true,"activeTabPreserved":true}));
        Ok::<_,String>(())
    }.await;
    super::close_session(app, a);
    super::close_session(app, b);
    if let Err(error) = result {
        return Ok(json!({"status":"fail","steps":steps,"error":error}));
    }
    Ok(json!({"status":"pass","steps":steps}))
}
