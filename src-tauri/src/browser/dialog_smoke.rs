//! Opt-in native dialog checks, bound to a completed document and explicit tab.
use super::{browser_bounds, execute, Bounds};
use serde_json::{json, Value};
use std::time::Instant;
use tauri::AppHandle;
use tokio::time::{sleep, Duration};

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
        sleep(Duration::from_millis(30)).await;
    }
    Err(format!(
        "Replacement document did not finish loading: {last}"
    ))
}

fn pending_confirm(
    app: &AppHandle,
    session: &str,
    tab: &str,
) -> tauri::async_runtime::JoinHandle<Result<Value, String>> {
    let (app, session, tab) = (app.clone(), session.to_owned(), tab.to_owned());
    tauri::async_runtime::spawn(async move {
        execute(
            &app,
            session,
            json!({"operation":"evaluate","tabId":tab,"timeoutMs":5000,
                "expression":"confirm('pending during native teardown')"}),
        )
        .await
    })
}

async fn dismissed_result(
    evaluation: tauri::async_runtime::JoinHandle<Result<Value, String>>,
) -> Result<Value, String> {
    let result = tokio::time::timeout(Duration::from_secs(3), evaluation)
        .await
        .map_err(|_| "A removed page retained its pending dialog evaluation.")?
        .map_err(|error| error.to_string())?;
    match result {
        Ok(returned) if returned == false || returned.is_null() => Ok(json!({"returned":returned})),
        Err(error) => Ok(json!({"error":error})),
        Ok(returned) => Err(format!(
            "Page teardown unexpectedly accepted a dialog: {returned}"
        )),
    }
}

async fn teardown_smoke(
    app: &AppHandle,
    session: &str,
    tab: &str,
    previous_document: &Value,
) -> Result<Value, String> {
    let current_url = execute(
        app,
        session.into(),
        json!({"operation":"evaluate","tabId":tab,"expression":"location.href"}),
    )
    .await?;
    let mut destination = url::Url::parse(current_url.as_str().ok_or("No dialog document URL.")?)
        .map_err(|_| "Invalid dialog document URL.")?;
    destination.set_query(Some("dialog-lifecycle=navigation"));

    let navigation_evaluation = pending_confirm(app, session, tab);
    let navigation_dialog = inspect(app, session, tab).await?;
    let navigation_started = Instant::now();
    execute(
        app,
        session.into(),
        json!({"operation":"navigate","tabId":tab,"url":destination.as_str()}),
    )
    .await?;
    let navigation_result = dismissed_result(navigation_evaluation).await?;
    let replaced = wait_document(
        app,
        session,
        tab,
        destination.as_str(),
        Some(previous_document),
    )
    .await?;
    let after_navigation = execute(
        app,
        session.into(),
        json!({"operation":"dialog","tabId":tab,"action":"inspect"}),
    )
    .await?;
    if !after_navigation["dialog"].is_null() {
        return Err(format!(
            "Navigation retained its old native dialog: {after_navigation}"
        ));
    }
    let navigation_ms = navigation_started.elapsed().as_millis();

    let opened = execute(
        app,
        session.into(),
        json!({"operation":"tabs.open","url":destination.as_str()}),
    )
    .await?;
    let extra = opened["tabId"]
        .as_str()
        .ok_or("No dialog teardown tab.")?
        .to_owned();
    let extra_document = wait_document(app, session, &extra, destination.as_str(), None).await?;
    browser_bounds(
        app.clone(),
        session.into(),
        Some(extra.clone()),
        Some(Bounds {
            x: 20.,
            y: 100.,
            width: 800.,
            height: 500.,
        }),
        true,
    )
    .await?;
    let closing_evaluation = pending_confirm(app, session, &extra);
    let closing_dialog = inspect(app, session, &extra).await?;
    let closing_started = Instant::now();
    let closed = execute(
        app,
        session.into(),
        json!({"operation":"tabs.close","tabId":extra}),
    )
    .await?;
    let closing_result = dismissed_result(closing_evaluation).await?;
    let closing_ms = closing_started.elapsed().as_millis();
    if closed["tabs"]
        .as_array()
        .is_none_or(|tabs| tabs.iter().any(|entry| entry["id"] == extra))
    {
        return Err(format!(
            "Closing a tab retained its dialog-owning view: {closed}"
        ));
    }
    let retained = execute(
        app,
        session.into(),
        json!({"operation":"evaluate","tabId":tab,"timeoutMs":1000,
        "expression":"({document:window.smokeDocument,ready:document.readyState})"}),
    )
    .await?;
    if retained["document"] != replaced["document"] || retained["ready"] != "complete" {
        return Err(format!(
            "Closing a dialog tab damaged a retained sibling document: {retained}"
        ));
    }
    execute(
        app,
        session.into(),
        json!({"operation":"tabs.focus","tabId":tab}),
    )
    .await?;
    browser_bounds(
        app.clone(),
        session.into(),
        Some(tab.into()),
        Some(Bounds {
            x: 20.,
            y: 100.,
            width: 800.,
            height: 500.,
        }),
        true,
    )
    .await?;
    Ok(json!({
        "navigation":{"dialog":navigation_dialog,"evaluation":navigation_result,"newDocument":replaced,"elapsedMs":navigation_ms},
        "tabClose":{"dialog":closing_dialog,"evaluation":closing_result,"closedDocument":extra_document,"sibling":retained,"elapsedMs":closing_ms},
        "pass":true
    }))
}

async fn inspect(app: &AppHandle, session: &str, tab: &str) -> Result<Value, String> {
    for _ in 0..60 {
        let state = execute(
            app,
            session.into(),
            json!({"operation":"dialog","tabId":tab,"action":"inspect"}),
        )
        .await?;
        if !state["dialog"].is_null() {
            return Ok(state["dialog"].clone());
        }
        sleep(Duration::from_millis(25)).await;
    }
    Err("Page dialog did not reach the native delegate.".into())
}

pub(super) async fn smoke(app: &AppHandle, session: &str, tab: &str) -> Result<Value, String> {
    let document = execute(
        app,
        session.into(),
        json!({"operation":"evaluate","tabId":tab,"expression":"window.smokeDocument"}),
    )
    .await?;
    let cases = [
        (
            "alert",
            "accept",
            "(alert('alert accept'), 'alert returned')",
            json!("alert returned"),
            None,
        ),
        (
            "alert",
            "dismiss",
            "(alert('alert dismiss'), 'alert returned')",
            json!("alert returned"),
            None,
        ),
        (
            "confirm",
            "accept",
            "confirm('confirm accept')",
            json!(true),
            None,
        ),
        (
            "confirm",
            "dismiss",
            "confirm('confirm dismiss')",
            json!(false),
            None,
        ),
        (
            "prompt",
            "accept",
            "prompt('prompt accept','default')",
            json!("filled by smoke"),
            Some("filled by smoke"),
        ),
        (
            "prompt",
            "accept",
            "prompt('prompt empty','default')",
            json!(""),
            Some(""),
        ),
        (
            "prompt",
            "dismiss",
            "prompt('prompt dismiss','default')",
            Value::Null,
            None,
        ),
    ];
    let mut results = vec![];
    for (kind, action, expression, expected, text) in cases {
        let evaluation = {
            let (app, session, tab) = (app.clone(), session.to_owned(), tab.to_owned());
            let expression = format!("(globalThis.smokeDialog={expression})");
            tauri::async_runtime::spawn(async move {
                execute(
                    &app,
                    session,
                    json!({"operation":"evaluate","tabId":tab,"expression":expression}),
                )
                .await
            })
        };
        let dialog = inspect(app, session, tab).await?;
        let again = inspect(app, session, tab).await?;
        if dialog["type"] != kind || again["id"] != dialog["id"] {
            return Err(format!(
                "Inspection consumed or replaced a {kind} dialog: {dialog}; {again}"
            ));
        }
        execute(
            app,
            session.into(),
            json!({"operation":"dialog","tabId":tab,"action":action,"text":text}),
        )
        .await?;
        let returned = evaluation.await.map_err(|error| error.to_string())??;
        if returned != expected {
            return Err(format!(
                "Native {kind} {action} returned {returned}, expected {expected}."
            ));
        }
        let retained = execute(
            app,
            session.into(),
            json!({"operation":"evaluate","tabId":tab,
            "expression":"({document:window.smokeDocument,result:globalThis.smokeDialog})"}),
        )
        .await?;
        if retained["document"] != document || retained["result"] != expected {
            return Err(format!(
                "Dialog result moved to a different document: {retained}"
            ));
        }
        results.push(json!({"type":kind,"action":action,"returned":returned,"document":document}));
    }
    let teardown = teardown_smoke(app, session, tab, &document).await?;
    Ok(
        json!({"name":"native alert/confirm/prompt results and pending-dialog teardown remain document-bound","pass":true,"cases":results,"teardown":teardown}),
    )
}
