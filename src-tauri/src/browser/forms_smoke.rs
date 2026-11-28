//! Opt-in native form checks using the real React fixture and nested open roots.
use super::{browser_bounds, close_session, execute, Bounds};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SESSION: &str = "native-browser-forms";

async fn call(app: &AppHandle, tab: &str, mut args: Value) -> Result<Value, String> {
    args["tabId"] = json!(tab);
    execute(app, SESSION.into(), args).await
}

async fn evaluate(app: &AppHandle, tab: &str, expression: &str) -> Result<Value, String> {
    call(
        app,
        tab,
        json!({"operation":"evaluate","expression":expression,"timeoutMs":1000}),
    )
    .await
}

async fn wait_value(app: &AppHandle, tab: &str, expression: &str) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if evaluate(app, tab, expression)
            .await
            .is_ok_and(|value| value == true)
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Err(format!("Form state did not settle: {expression}"))
}

fn reference(snapshot: &Value, name: &str) -> Result<String, String> {
    snapshot["controls"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["name"] == name))
        .and_then(|row| row["ref"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("Native snapshot did not expose {name}."))
}

async fn open(app: &AppHandle, url: &str) -> Result<String, String> {
    let opened = execute(
        app,
        SESSION.into(),
        json!({"operation":"tabs.open","url":url}),
    )
    .await?;
    opened["tabId"]
        .as_str()
        .map(str::to_owned)
        .ok_or("No forms tab was created.".into())
}

async fn strict_csp(app: &AppHandle, base: &url::Url) -> Result<Value, String> {
    let url = base.join("/csp").map_err(|error| error.to_string())?;
    let tab = open(app, url.as_str()).await?;
    call(
        app,
        &tab,
        json!({"operation":"wait","selector":"#strict-ready","timeoutMs":3000}),
    )
    .await?;
    let awaited = evaluate(app, &tab, "Promise.resolve().then(()=>{globalThis.strictMarker='native page world';globalThis.strictRuntimeCount=0;let blocked=false;try{eval('1')}catch{blocked=true}return {awaited:true,cspBlocksEval:blocked,marker:globalThis.strictMarker,bridge:typeof window.__TAURI_INTERNALS__,helper:typeof window.__zorvoBrowser}})").await?;
    if awaited
        != json!({"awaited":true,"cspBlocksEval":true,"marker":"native page world","bridge":"undefined","helper":"undefined"})
    {
        return Err(format!(
            "Native awaited expression bypassed page isolation or changed CSP: {awaited}"
        ));
    }
    let failure = evaluate(app, &tab, "(()=>{globalThis.strictRuntimeCount++;throw new SyntaxError('deliberate runtime syntax error')})()").await;
    if failure.is_ok() || evaluate(app, &tab, "globalThis.strictRuntimeCount").await? != 1 {
        return Err(
            "A native runtime SyntaxError succeeded or its side effect ran more than once.".into(),
        );
    }
    let program = call(app, &tab, json!({"operation":"evaluate","script":"globalThis.strictProgram=(globalThis.strictProgram||0)+1;globalThis.strictProgram"})).await?;
    if program != 1 || evaluate(app, &tab, "globalThis.strictProgram").await? != 1 {
        return Err("Legacy native script did not execute its program exactly once.".into());
    }
    let snapshot = call(app, &tab, json!({"operation":"snapshot"})).await?;
    let input = reference(&snapshot, "Strict input")?;
    call(
        app,
        &tab,
        json!({"operation":"fill","ref":input,"value":"strict CSP input"}),
    )
    .await?;
    if evaluate(app, &tab, "document.querySelector('#strict-input').value").await?
        != "strict CSP input"
    {
        return Err("The isolated helper could not fill the strict-CSP page.".into());
    }
    Ok(
        json!({"awaited":awaited,"runtimeSyntaxErrorExecutions":1,"legacyScriptExecutions":1,"isolatedInputFilled":true}),
    )
}

pub(super) async fn smoke(app: &AppHandle, base: &url::Url) -> Result<Value, String> {
    let result = async {
        let tab = open(app, base.as_str()).await?;
        super::smoke::wait_document(app, SESSION, &tab, base.as_str(), None).await?;
        let snapshot = call(app, &tab, json!({"operation":"snapshot"})).await?;
        let button = reference(&snapshot, "Shadow increment")?;
        let input = reference(&snapshot, "Shadow input")?;
        call(app, &tab, json!({"operation":"click","ref":button})).await?;
        call(app, &tab, json!({"operation":"fill","ref":input,"value":"nested shadow value"})).await?;
        let shadow = evaluate(app, &tab, "(()=>{const root=document.querySelector('x-widget').shadowRoot.querySelector('x-inner').shadowRoot;return {count:root.querySelector('output').textContent,value:root.querySelector('input').value}})()").await?;
        if shadow != json!({"count":"1","value":"nested shadow value"}) {
            return Err(format!("Native nested open-shadow ref actions failed: {shadow}"));
        }
        let csp = strict_csp(app, base).await?;

        let react = base.join("/react").map_err(|error| error.to_string())?;
        let tab = open(app, react.as_str()).await?;
        wait_value(app, &tab, "location.pathname==='/react' && document.readyState==='complete' && document.querySelector('#forms-ready')?.dataset.ready==='true'").await?;
        browser_bounds(app.clone(), SESSION.into(), Some(tab.clone()), Some(Bounds{x:20.,y:100.,width:560.,height:600.}), true).await?;
        let snapshot = call(app, &tab, json!({"operation":"snapshot"})).await?;
        let text = reference(&snapshot, "Controlled input")?;
        let choice = reference(&snapshot, "Controlled choice")?;
        let checked = reference(&snapshot, "Controlled check")?;
        let last = reference(&snapshot, "Long field 39")?;
        let submit = reference(&snapshot, "Submit controlled form")?;
        call(app, &tab, json!({"operation":"fill","ref":text,"value":"controlled state changed"})).await?;
        call(app, &tab, json!({"operation":"select","ref":choice,"value":"b"})).await?;
        call(app, &tab, json!({"operation":"check","ref":checked,"checked":true})).await?;
        call(app, &tab, json!({"operation":"fill","ref":last,"value":"last controlled field"})).await?;
        wait_value(app, &tab, "document.querySelector('#react-state').textContent==='controlled state changed'").await?;
        call(app, &tab, json!({"operation":"scroll","y":5000})).await?;
        wait_value(app, &tab, "scrollY>1000").await?;
        call(app, &tab, json!({"operation":"click","ref":submit})).await?;
        wait_value(app, &tab, "!!window.smokeFormSubmitted").await?;
        let submitted = evaluate(app, &tab, "window.smokeFormSubmitted").await?;
        if submitted != json!({"text":"controlled state changed","choice":"b","checked":true,"last":"last controlled field"}) {
            return Err(format!("Controlled React state differed from native DOM edits: {submitted}"));
        }
        let isolation = evaluate(app, &tab, "({bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser,scrollY,controls:document.querySelectorAll('input,select,button').length})").await?;
        if isolation["bridge"] != "undefined" || isolation["isolated"] != "undefined" {
            return Err(format!("React fixture gained an application bridge: {isolation}"));
        }
        Ok(json!({"name":"native open-shadow refs, strict CSP evaluation and controlled React long-form state/submit/scroll","pass":true,"shadow":shadow,"strictCsp":csp,"submitted":submitted,"page":isolation,"trustedInput":false}))
    }.await;
    close_session(app, SESSION.into());
    // Queue a native barrier so the session is released before another case starts.
    let cleanup = execute(app, SESSION.into(), json!({"operation":"tabs.list"})).await?;
    if cleanup["tabs"]
        .as_array()
        .is_none_or(|tabs| !tabs.is_empty())
    {
        return Err("Native forms smoke did not release its session.".into());
    }
    result
}
