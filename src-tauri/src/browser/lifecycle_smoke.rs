//! Opt-in debug exercise of retained native tabs, placement and teardown.
use super::{browser_bounds, close_session, execute, Bounds};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SESSION: &str = "native-browser-lifecycle-a";
const OTHER: &str = "native-browser-lifecycle-b";

struct Page {
    tab: String,
    document: Value,
    input: String,
    reference: String,
}

async fn call(app: &AppHandle, session: &str, tab: &str, mut args: Value) -> Result<Value, String> {
    args["tabId"] = json!(tab);
    execute(app, session.into(), args).await
}

async fn evaluate(
    app: &AppHandle,
    session: &str,
    tab: &str,
    expression: &str,
) -> Result<Value, String> {
    call(
        app,
        session,
        tab,
        json!({"operation":"evaluate","expression":expression,"timeoutMs":1000}),
    )
    .await
}

async fn open(app: &AppHandle, session: &str, url: &str) -> Result<String, String> {
    let opened = execute(
        app,
        session.into(),
        json!({"operation":"tabs.open","url":url}),
    )
    .await?;
    let tab = opened["tabId"]
        .as_str()
        .ok_or("No lifecycle tab was created.")?
        .to_string();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if evaluate(
            app,
            session,
            &tab,
            "document.readyState==='complete' && typeof window.smokeDocument==='string' && !!document.querySelector('#nested-scroll')",
        )
        .await
        .is_ok_and(|value| value == true)
        {
            return Ok(tab);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Err(format!("Lifecycle document did not become ready: {tab}"))
}

async fn document(app: &AppHandle, session: &str, tab: &str) -> Result<Value, String> {
    evaluate(app, session, tab, "window.smokeDocument").await
}

async fn check_page(app: &AppHandle, page: &Page) -> Result<Value, String> {
    let value = evaluate(app, SESSION, &page.tab, "({document:window.smokeDocument,input:document.querySelector('#input').value,nested:document.querySelector('#nested-scroll').scrollTop,bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser})").await?;
    if value["document"] != page.document
        || value["input"] != page.input
        || value["bridge"] != "undefined"
        || value["isolated"] != "undefined"
    {
        return Err(format!(
            "Retained native tab lost its document or form state: {value}"
        ));
    }
    Ok(value)
}

fn tabs(state: &Value) -> impl Iterator<Item = &Value> {
    state["sessions"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|session| session["tabs"].as_array().into_iter().flatten())
}

fn process_sample(state: &Value, owned: &mut BTreeSet<i32>) -> Value {
    let mut processes = BTreeMap::new();
    let mut unavailable_views = 0;
    for session in state["sessions"].as_array().into_iter().flatten() {
        if session["id"] != SESSION && session["id"] != OTHER {
            continue;
        }
        for tab in session["tabs"].as_array().into_iter().flatten() {
            if let Some(pid) = tab["process"]["pid"]
                .as_i64()
                .and_then(|pid| i32::try_from(pid).ok())
                .filter(|pid| *pid > 0)
            {
                owned.insert(pid);
                processes.insert(pid, tab["process"].clone());
            } else {
                unavailable_views += 1;
            }
        }
    }
    let resident_bytes: Option<u64> = processes
        .values()
        .map(|process| process["residentBytes"].as_u64())
        .sum();
    let cpu_nanoseconds: Option<u64> = processes
        .values()
        .map(|process| process["cpuNanoseconds"].as_u64())
        .sum();
    let available = unavailable_views == 0
        && !processes.is_empty()
        && resident_bytes.is_some()
        && cpu_nanoseconds.is_some();
    json!({
        "measurementAvailable":available,"unavailableViews":unavailable_views,
        "uniqueProcesses":processes.into_values().collect::<Vec<_>>(),
        "totalResidentBytes":available.then_some(resident_bytes).flatten(),
        "totalCpuNanoseconds":available.then_some(cpu_nanoseconds).flatten(),
        "appProcess":state["appProcess"],
        "note":(!available).then_some("WebKit process identity or task metrics are unavailable for one or more views; no zero-memory measurement is inferred.")
    })
}

async fn wait_processes_gone(owned: &BTreeSet<i32>) -> Result<Value, String> {
    if owned.is_empty() {
        return Ok(json!({"measurementAvailable":false,"processes":[],
            "note":"WebKit did not expose an owned process identifier; process-exit measurement is unavailable."}));
    }
    let started = Instant::now();
    loop {
        let observed: Vec<_> = owned
            .iter()
            .map(|pid| super::native::smoke_process(*pid))
            .collect();
        if observed.iter().all(|process| process["gone"] == true) {
            return Ok(
                json!({"measurementAvailable":true,"processes":observed,"elapsedMs":started.elapsed().as_millis()}),
            );
        }
        if started.elapsed() >= Duration::from_secs(10) {
            return Err(format!(
                "An owned WebKit process remained after native teardown: {observed:?}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn check_placement(app: &AppHandle, expected_tab: Option<&str>) -> Result<Value, String> {
    let state = super::native::smoke_state(app).await?;
    let visible: Vec<_> = tabs(&state).filter(|tab| tab["hidden"] == false).collect();
    if let Some(expected) = expected_tab {
        if visible.len() != 1 || visible[0]["id"] != expected {
            return Err(format!("Native placement exposed the wrong tabs: {state}"));
        }
        if visible[0]["bounds"]["width"].as_f64().unwrap_or(0.) <= 0.
            || visible[0]["bounds"]["height"].as_f64().unwrap_or(0.) <= 0.
        {
            return Err(format!("Visible native tab has no native bounds: {state}"));
        }
    } else if !visible.is_empty() {
        return Err(format!(
            "Hiding the panel left a visible native tab: {state}"
        ));
    }
    Ok(state)
}

async fn run(app: &AppHandle, url: &str, owned: &mut BTreeSet<i32>) -> Result<Value, String> {
    let started = Instant::now();
    let mut pages = Vec::new();
    for index in 0..5 {
        let tab = open(app, SESSION, url).await?;
        let input = format!("lifecycle retained tab {index}");
        call(
            app,
            SESSION,
            &tab,
            json!({"operation":"fill","selector":"#input","value":input}),
        )
        .await?;
        let snapshot = call(app, SESSION, &tab, json!({"operation":"snapshot"})).await?;
        let reference = snapshot["controls"]
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["name"] == "Increment"))
            .and_then(|row| row["ref"].as_str())
            .ok_or("Lifecycle snapshot did not identify Increment.")?
            .to_string();
        pages.push(Page {
            document: document(app, SESSION, &tab).await?,
            tab,
            input,
            reference,
        });
    }
    let before_cycles = process_sample(&super::native::smoke_state(app).await?, owned);
    let mut placements = Vec::new();
    let mut scroll_ms = Vec::new();
    for cycle in 0..3 {
        for (index, page) in pages.iter().enumerate() {
            call(app, SESSION, &page.tab, json!({"operation":"tabs.focus"})).await?;
            browser_bounds(
                app.clone(),
                SESSION.into(),
                Some(page.tab.clone()),
                Some(Bounds {
                    x: 20. + index as f64 * 3.,
                    y: 100.,
                    width: [360., 560., 800.][cycle],
                    height: 500.,
                }),
                true,
            )
            .await?;
            let placement = check_placement(app, Some(&page.tab)).await?;
            let actual = tabs(&placement)
                .find(|tab| tab["id"] == page.tab)
                .ok_or("Native placement omitted its active tab.")?;
            for (key, expected) in [
                ("x", 20. + index as f64 * 3.),
                ("width", [360., 560., 800.][cycle]),
                ("height", 500.),
            ] {
                if actual["bounds"][key]
                    .as_f64()
                    .is_none_or(|value| (value - expected).abs() > 1.)
                {
                    return Err(format!(
                        "Native {key} did not follow its requested panel bounds: {placement}"
                    ));
                }
            }
            let scroll_start = Instant::now();
            call(
                app,
                SESSION,
                &page.tab,
                json!({"operation":"scroll","selector":"#nested-scroll","y":40,"timeoutMs":1000}),
            )
            .await?;
            let sample = check_page(app, page).await?;
            scroll_ms.push(scroll_start.elapsed().as_millis());
            if sample["nested"].as_f64().unwrap_or(0.) <= 0. {
                return Err(format!(
                    "Nested native scrolling did not move its target: {sample}"
                ));
            }
            browser_bounds(
                app.clone(),
                SESSION.into(),
                Some(page.tab.clone()),
                None,
                false,
            )
            .await?;
            check_placement(app, None).await?;
            placements.push(json!({"cycle":cycle,"tab":page.tab,"state":placement}));
        }
    }
    let after_cycles = process_sample(&super::native::smoke_state(app).await?, owned);
    evaluate(
        app,
        SESSION,
        &pages[0].tab,
        "(()=>{document.cookie='lifecycle_shared=alpha; SameSite=Lax';return true})()",
    )
    .await?;
    let shared = evaluate(app, SESSION, &pages[1].tab, "document.cookie").await?;
    // Ending an agent revokes its browser grant, but the session's manual
    // pages, in-memory login store and unfinished form remain until deletion.
    crate::browser_commands::forget(app, SESSION);
    for page in &pages {
        check_page(app, page).await?;
    }
    if evaluate(app, SESSION, &pages[0].tab, "document.cookie").await? != shared {
        return Err(
            "Revoking an ended agent's browser grant discarded manual page cookies.".into(),
        );
    }
    let other = open(app, OTHER, url).await?;
    process_sample(&super::native::smoke_state(app).await?, owned);
    let separate = evaluate(app, OTHER, &other, "document.cookie").await?;
    if !shared
        .as_str()
        .is_some_and(|value| value.contains("lifecycle_shared=alpha"))
        || separate
            .as_str()
            .is_some_and(|value| value.contains("lifecycle_shared=alpha"))
    {
        return Err("Lifecycle sessions did not isolate their cookie stores.".into());
    }
    browser_bounds(
        app.clone(),
        OTHER.into(),
        Some(other.clone()),
        Some(Bounds {
            x: 20.,
            y: 100.,
            width: 560.,
            height: 500.,
        }),
        true,
    )
    .await?;
    check_placement(app, Some(&other)).await?;
    call(
        app,
        SESSION,
        &pages[4].tab,
        json!({"operation":"tabs.close"}),
    )
    .await?;
    for page in &pages[..4] {
        check_page(app, page).await?;
    }
    let after_one_close = super::native::smoke_state(app).await?;
    if tabs(&after_one_close).count() != 5 {
        return Err(format!(
            "Closing one tab retained an unexpected native tab count: {after_one_close}"
        ));
    }

    close_session(app, SESSION.into());
    let closed = execute(app, SESSION.into(), json!({"operation":"tabs.list"})).await?;
    if closed["tabs"]
        .as_array()
        .is_none_or(|rows| !rows.is_empty())
    {
        return Err(format!(
            "Closing a session retained its native tabs: {closed}"
        ));
    }
    let recreated = open(app, SESSION, url).await?;
    process_sample(&super::native::smoke_state(app).await?, owned);
    let fresh = evaluate(app, SESSION, &recreated, "({document:window.smokeDocument,input:document.querySelector('#input').value,cookies:document.cookie})").await?;
    if fresh["document"] == pages[0].document
        || fresh["input"] != "original"
        || fresh["cookies"] != ""
    {
        return Err(format!(
            "Recreating a session reused its prior native state: {fresh}"
        ));
    }
    if call(
        app,
        SESSION,
        &recreated,
        json!({"operation":"click","ref":pages[0].reference}),
    )
    .await
    .is_ok()
    {
        return Err("A recreated session accepted a stale reference from a closed view.".into());
    }
    close_session(app, OTHER.into());
    execute(app, OTHER.into(), json!({"operation":"tabs.list"})).await?;

    let loop_tab = open(app, OTHER, url).await?;
    let loop_native_state = super::native::smoke_state(app).await?;
    let loop_process = tabs(&loop_native_state)
        .find(|tab| tab["id"] == loop_tab)
        .map(|tab| tab["process"].clone())
        .unwrap_or(Value::Null);
    process_sample(&loop_native_state, owned);
    let loop_task = {
        let app = app.clone();
        let tab = loop_tab.clone();
        tauri::async_runtime::spawn(async move {
            call(
                &app,
                OTHER,
                &tab,
                json!({"operation":"evaluate","script":"while(true){}","timeoutMs":100}),
            )
            .await
        })
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    let list_start = Instant::now();
    let loop_state = execute(app, OTHER.into(), json!({"operation":"tabs.list"})).await?;
    let list_ms = list_start.elapsed().as_millis();
    if list_ms >= 2000 || loop_state["tabs"].as_array().is_none_or(Vec::is_empty) {
        return Err(format!(
            "A looping page blocked native tab commands: {list_ms}ms; {loop_state}"
        ));
    }
    let close_start = Instant::now();
    call(app, OTHER, &loop_tab, json!({"operation":"tabs.close"})).await?;
    let close_ms = close_start.elapsed().as_millis();
    let loop_result = loop_task.await.map_err(|error| error.to_string())?;
    if loop_result.is_ok() || close_ms >= 2000 {
        return Err(format!(
            "Looping native page did not close within the bound: {close_ms}ms; {loop_result:?}"
        ));
    }
    let loop_pids: BTreeSet<_> = loop_process["pid"]
        .as_i64()
        .and_then(|pid| i32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .into_iter()
        .collect();
    let loop_exit = wait_processes_gone(&loop_pids).await?;
    let healthy_after_loop = evaluate(
        app,
        SESSION,
        &recreated,
        "document.querySelector('#input').value",
    )
    .await;
    let state_after_loop = super::native::smoke_state(app).await?;
    Ok(json!({
        "name":"five retained tabs survive placement cycles and teardown remains bounded",
        "pass":true,"tabs":5,"cycles":3,"placements":placements,"nestedScrollMs":scroll_ms,
        "resources":{"beforeCycles":before_cycles,"afterCycles":after_cycles,"scope":"deduplicated owned WebKit process RSS/CPU snapshots; app process reported separately; no sustained-performance or leak-free claim"},
        "sessionCookieIsolation":true,"remainingTabsAfterClosingOne":tabs(&after_one_close).count(),
        "freshSession":fresh,"staleReferenceRejected":true,
        "loopingPage":{"nativeListMs":list_ms,"nativeCloseMs":close_ms,"processBeforeLoop":loop_process,"processExit":loop_exit,"pendingOperationError":loop_result.err(),"healthyJsResponsive":healthy_after_loop.is_ok(),"healthyJsResult":healthy_after_loop.ok(),"state":state_after_loop},
        "elapsedMs":started.elapsed().as_millis()
    }))
}

pub(super) async fn smoke(app: &AppHandle, url: &str) -> Result<Value, String> {
    let mut owned = BTreeSet::new();
    let result = run(app, url, &mut owned).await;
    let before_cleanup = process_sample(&super::native::smoke_state(app).await?, &mut owned);
    close_session(app, SESSION.into());
    close_session(app, OTHER.into());
    // These queued reads form a main-thread barrier after both native teardowns.
    execute(app, SESSION.into(), json!({"operation":"tabs.list"})).await?;
    execute(app, OTHER.into(), json!({"operation":"tabs.list"})).await?;
    let after = super::native::smoke_state(app).await?;
    if tabs(&after).count() != 0 {
        return Err(format!("Lifecycle cleanup retained native tabs: {after}"));
    }
    let process_exit = wait_processes_gone(&owned).await?;
    result.map(|mut value| {
        value["cleanup"] = after;
        value["cleanupResources"] =
            json!({"beforeCleanup":before_cleanup,"ownedProcessExit":process_exit});
        value
    })
}
