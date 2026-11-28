//! Opt-in integration of the actual artifact and browser child views.
use super::{browser_bounds, close_session, execute, Bounds};
use crate::artifacts::{
    protocol::{page_url, Served},
    store::ArtifactStore,
    view,
};
use serde_json::{json, Value};
use std::os::unix::fs::DirBuilderExt;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const SESSION: &str = "native-browser-placement";

async fn evaluate(app: &AppHandle, tab: &str, expression: &str) -> Result<Value, String> {
    execute(
        app,
        SESSION.into(),
        json!({"operation":"evaluate","tabId":tab,"expression":expression}),
    )
    .await
}

async fn assert_visible(
    app: &AppHandle,
    tab: &str,
    browser_visible: bool,
    artifact_visible: bool,
) -> Result<Value, String> {
    let browser = super::native::smoke_state(app).await?;
    let artifact = view::smoke_state(app).await?;
    let visible: Vec<_> = browser["sessions"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|session| session["tabs"].as_array().into_iter().flatten())
        .filter(|tab| tab["hidden"] == false)
        .collect();
    if visible.len() != usize::from(browser_visible)
        || (browser_visible && visible[0]["id"] != tab)
        || artifact["exists"] != true
        || artifact["hidden"] != !artifact_visible
    {
        return Err(format!(
            "Artifact/browser placement exposed the wrong child views: {browser}; {artifact}"
        ));
    }
    Ok(json!({"browser":browser,"artifact":artifact}))
}

async fn run(app: &AppHandle, url: &str, served: Arc<Served>) -> Result<Value, String> {
    let store = Arc::clone(&served.store);
    let opened = execute(
        app,
        SESSION.into(),
        json!({"operation":"tabs.open","url":url}),
    )
    .await?;
    let tab = opened["tabId"]
        .as_str()
        .ok_or("Placement browser tab missing.")?
        .to_string();
    super::smoke::wait_document(app, SESSION, &tab, url, None).await?;
    execute(app, SESSION.into(), json!({"operation":"fill","tabId":tab,"selector":"#input","value":"retained while showing artifact"})).await?;
    let before = evaluate(app, &tab, "window.smokeDocument").await?;
    let shown = store.show(SESSION, "/placement.html", Some("Placement integration"),
        b"<!doctype html><meta charset=utf-8><title>Placement integration</title><h1>Actual artifact child view</h1><input value=artifact>", 1)?;
    let artifact_url = page_url(SESSION, &shown.artifact.id, shown.version);
    view::show(
        app,
        served,
        view::ShownPage {
            session_id: SESSION.into(),
            artifact_id: shown.artifact.id,
            version: shown.version,
        },
        artifact_url.clone(),
        view::Bounds {
            x: 20.,
            y: 100.,
            width: 560.,
            height: 400.,
        },
    )?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let state = view::smoke_state(app).await?;
        if state["loaded"] == true && state["loading"] == false && state["url"] == artifact_url {
            break;
        }
        if Instant::now() >= deadline {
            return Err(format!("Actual artifact did not finish loading: {state}"));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let mut cycles = vec![];
    for width in [360., 560., 800.] {
        browser_bounds(app.clone(), SESSION.into(), Some(tab.clone()), None, false).await?;
        view::set_bounds(
            app,
            Some(view::Bounds {
                x: 20.,
                y: 100.,
                width,
                height: 400.,
            }),
        );
        view::set_hidden(app, false);
        let artifact = assert_visible(app, &tab, false, true).await?;
        if artifact["artifact"]["bounds"]["width"] != width {
            return Err(format!("Artifact native bounds did not resize: {artifact}"));
        }
        view::set_hidden(app, true);
        browser_bounds(
            app.clone(),
            SESSION.into(),
            Some(tab.clone()),
            Some(Bounds {
                x: 20.,
                y: 100.,
                width,
                height: 400.,
            }),
            true,
        )
        .await?;
        let browser = assert_visible(app, &tab, true, false).await?;
        let capture = execute(
            app,
            SESSION.into(),
            json!({"operation":"screenshot","tabId":tab}),
        )
        .await?;
        let image_bytes = capture["base64"].as_str().map(str::len).unwrap_or(0);
        if image_bytes < 100 {
            return Err("Native menu cover capture was empty.".into());
        }
        browser_bounds(app.clone(), SESSION.into(), Some(tab.clone()), None, false).await?;
        let covered = assert_visible(app, &tab, false, false).await?;
        browser_bounds(
            app.clone(),
            SESSION.into(),
            Some(tab.clone()),
            Some(Bounds {
                x: 20.,
                y: 100.,
                width,
                height: 400.,
            }),
            true,
        )
        .await?;
        let restored = assert_visible(app, &tab, true, false).await?;
        let retained = evaluate(
            app,
            &tab,
            "({document:window.smokeDocument,input:document.querySelector('#input').value})",
        )
        .await?;
        if retained["document"] != before || retained["input"] != "retained while showing artifact"
        {
            return Err(format!(
                "Artifact/menu transitions replaced the browser document: {retained}"
            ));
        }
        cycles.push(
            json!({"width":width,"artifact":artifact,"browser":browser,"covered":covered,
            "restored":restored,"captureBase64Length":image_bytes,"retained":retained}),
        );
    }
    Ok(
        json!({"name":"real artifact/browser children alternate, resize and retain browser state through menu cover","pass":true,"cycles":cycles}),
    )
}

pub(super) async fn smoke(app: &AppHandle, url: &str) -> Result<Value, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "zorvo-browser-placement-{}-{nanos}",
        std::process::id()
    ));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .map_err(|error| error.to_string())?;
    // Only an artifact page is shown, so no canvas folder is ever known.
    let served = Arc::new(Served {
        store: Arc::new(ArtifactStore::new(root.clone())),
        thumbs: root.join("canvas-thumbs"),
        is_known: Arc::new(|_| false),
    });
    let result = run(app, url, served).await;
    view::close(app);
    close_session(app, SESSION.into());
    let artifact = view::smoke_state(app).await;
    let browser = super::native::smoke_state(app).await;
    let removed = std::fs::remove_dir_all(&root);
    let mut result = result?;
    if artifact?["exists"] != false || browser?["totalTabs"] != 0 {
        return Err("Placement integration left retained child views after close.".into());
    }
    removed.map_err(|error| error.to_string())?;
    result["closedAllViews"] = json!(true);
    Ok(result)
}
