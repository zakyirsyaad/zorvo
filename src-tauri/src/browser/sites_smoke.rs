//! Opt-in public navigation observations under the app's unchanged ATS policy.
use super::{browser_bounds, close_session, execute, Bounds};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SESSION: &str = "native-browser-public-sites";

async fn call(app: &AppHandle, tab: &str, mut args: Value) -> Result<Value, String> {
    args["tabId"] = json!(tab);
    args["timeoutMs"] = json!(1000);
    execute(app, SESSION.into(), args).await
}

async fn read(app: &AppHandle, tab: &str) -> Result<Value, String> {
    call(app, tab, json!({"operation":"evaluate","expression":
        "({origin:location.origin,path:location.pathname,ready:document.readyState,titleLength:document.title.length,ua:navigator.userAgent,width:innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser})"
    })).await
}

async fn observe(app: &AppHandle, requested: &str, required: bool) -> Result<Value, String> {
    let opened = execute(
        app,
        SESSION.into(),
        json!({"operation":"tabs.open","url":requested}),
    )
    .await?;
    let tab = opened["tabId"]
        .as_str()
        .ok_or("No public-site tab was created.")?;
    browser_bounds(
        app.clone(),
        SESSION.into(),
        Some(tab.into()),
        Some(Bounds {
            x: 20.,
            y: 100.,
            width: 560.,
            height: 600.,
        }),
        true,
    )
    .await?;
    let target = url::Url::parse(requested).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(25);
    let mut page = Value::Null;
    let mut last_error = None;
    while Instant::now() < deadline {
        let state = execute(app, SESSION.into(), json!({"operation":"tabs.list"})).await?;
        if state["tabs"].as_array().is_some_and(|rows| {
            rows.iter()
                .any(|row| row["id"] == tab && row["loading"] == true)
        }) {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        match read(app, tab).await {
            Ok(value) => {
                page = value;
                if page["ready"] == "complete"
                    && page["titleLength"].as_u64().is_some_and(|n| n > 0)
                    && page["origin"]
                        .as_str()
                        .and_then(|origin| url::Url::parse(origin).ok())
                        .is_some_and(|origin| origin.host_str() == target.host_str())
                {
                    break;
                }
            }
            Err(error) => {
                let transient = error.contains("navigated or closed");
                last_error = Some(error);
                if !transient {
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let loaded = page["ready"] == "complete"
        && page["titleLength"].as_u64().is_some_and(|n| n > 0)
        && page["origin"]
            .as_str()
            .and_then(|origin| url::Url::parse(origin).ok())
            .is_some_and(|origin| origin.host_str() == target.host_str());
    if !loaded {
        if required {
            return Err(format!(
                "Public HTTPS page did not finish at the requested origin: {requested}; {page}; script error: {last_error:?}; native: {}",
                super::native::smoke_state(app).await?
            ));
        }
        call(app, tab, json!({"operation":"tabs.close"})).await?;
        return Ok(
            json!({"requested":requested,"outcome":"blocked-or-unavailable","atsPolicyChanged":false}),
        );
    }
    let snapshot = call(app, tab, json!({"operation":"snapshot"})).await?;
    let controls = snapshot["controls"].as_array().map_or(0, Vec::len);
    let expected_title = match target.host_str() {
        Some("github.com") => "github",
        Some("example.com") => "example",
        _ => "javascript",
    };
    if required
        && (controls == 0
            || snapshot["title"]
                .as_str()
                .is_none_or(|title| !title.to_lowercase().contains(expected_title)))
    {
        return Err(format!(
            "Public HTTPS snapshot lacked a title or controls: {requested}"
        ));
    }
    let mut samples = vec![];
    for width in [360., 560., 900.] {
        browser_bounds(
            app.clone(),
            SESSION.into(),
            Some(tab.into()),
            Some(Bounds {
                x: 20.,
                y: 100.,
                width,
                height: 600.,
            }),
            true,
        )
        .await?;
        // Observe the real layout after the native placement; overflow is data,
        // not a reason to rewrite an arbitrary site's CSS or viewport metadata.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let sample = read(app, tab).await?;
        if sample["bridge"] != "undefined" || sample["isolated"] != "undefined" {
            return Err("A public page gained the application or isolated helper global.".into());
        }
        samples.push(json!({"requestedWidth":width,"page":sample}));
    }
    let site = super::site_info(app, SESSION.into(), tab.into()).await?;
    call(app, tab, json!({"operation":"tabs.close"})).await?;
    Ok(
        json!({"requested":requested,"outcome":"loaded","controlCount":controls,
        "connectionSecurity":site["security"],"samples":samples,"atsPolicyChanged":false}),
    )
}

pub(super) async fn smoke(app: &AppHandle) -> Result<Value, String> {
    let result = async {
        let mut sites = vec![];
        for (url, required) in [
            ("https://example.com/", true),
            ("https://github.com/", true),
            ("https://developer.mozilla.org/en-US/docs/Web/JavaScript", true),
            ("http://example.com/", false),
        ] {
            sites.push(observe(app, url, required).await?);
        }
        Ok(json!({"name":"public HTTPS/docs and HTTP native navigation, layout and TLS observations","pass":true,"sites":sites}))
    }.await;
    close_session(app, SESSION.into());
    let cleanup = execute(app, SESSION.into(), json!({"operation":"tabs.list"})).await?;
    if cleanup["tabs"]
        .as_array()
        .is_none_or(|tabs| !tabs.is_empty())
    {
        return Err("Public-site smoke did not release its session.".into());
    }
    result
}
