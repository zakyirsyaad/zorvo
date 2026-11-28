//! Opt-in native check of agent uploads in WebKit: an armed upload answers the page's own file
//! chooser after the helper clicks the input, a click that opens no chooser leaves it armed until it
//! is withdrawn, and an upload is never armed for another origin than the page's.
use super::{close_session, execute};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SESSION: &str = "native-browser-upload";

async fn evaluate(app: &AppHandle, tab: &str, expression: &str) -> Result<Value, String> {
    execute(
        app,
        SESSION.into(),
        json!({"operation":"evaluate","tabId":tab,"expression":expression,"timeoutMs":1000}),
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
    Err(format!("Upload state did not settle: {expression}"))
}

fn reference(snapshot: &Value, name: &str) -> Result<String, String> {
    snapshot["controls"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["name"] == name))
        .and_then(|row| row["ref"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("Native snapshot did not expose {name}."))
}

async fn state(app: &AppHandle, args: &Value) -> Result<String, String> {
    super::upload_state(app, SESSION.into(), args).await
}

async fn wait_state(app: &AppHandle, args: &Value, wanted: &str) -> Result<(), String> {
    let deadline = Instant::now() + crate::browser_upload::ARM_TTL + Duration::from_secs(2);
    while Instant::now() < deadline {
        let now = state(app, args).await?;
        if now == wanted {
            return Ok(());
        }
        if now != "waiting" {
            return Err(format!("The upload ended {now}, not {wanted}."));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(format!("The upload never became {wanted}."))
}

/// The system open panels on screen, read on the main thread; with `cancel`, each is cancelled.
async fn open_panels(app: &AppHandle, cancel: bool) -> Result<usize, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
            let _ = send.send(0);
            return;
        };
        let mut count = 0;
        for window in objc2_app_kit::NSApplication::sharedApplication(mtm)
            .windows()
            .iter()
        {
            let Ok(panel) = window.downcast::<objc2_app_kit::NSOpenPanel>() else {
                continue;
            };
            if panel.isVisible() {
                count += 1;
                if cancel {
                    // SAFETY: the panel's own cancel action, sent on the main thread.
                    unsafe { panel.cancel(None) };
                }
            }
        }
        let _ = send.send(count);
    })
    .map_err(|_| "The main thread is unavailable.")?;
    receive
        .await
        .map_err(|_| "The panel check was cancelled.".to_string())
}

async fn wait_panels(app: &AppHandle, wanted: impl Fn(usize) -> bool) -> Result<usize, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let count = open_panels(app, false).await?;
        if wanted(count) {
            return Ok(count);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("The system open panel did not appear or close in time.".into())
}

pub(super) async fn smoke(app: &AppHandle, base: &url::Url) -> Result<Value, String> {
    let scratch = std::env::temp_dir().join(format!("zorvo-upload-smoke-{}", std::process::id()));
    let result = async {
        let url = base.join("/upload").map_err(|error| error.to_string())?;
        let opened = execute(
            app,
            SESSION.into(),
            json!({"operation":"tabs.open","url":url.as_str()}),
        )
        .await?;
        let tab = opened["tabId"]
            .as_str()
            .map(str::to_owned)
            .ok_or("No upload tab was created.")?;
        wait_value(
            app,
            &tab,
            "document.readyState==='complete' && !!document.querySelector('#upload-ready')",
        )
        .await?;
        let snapshot = execute(
            app,
            SESSION.into(),
            json!({"operation":"snapshot","tabId":tab}),
        )
        .await?;
        let input = reference(&snapshot, "Statement file")?;
        let plain = reference(&snapshot, "Plain button")?;

        std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
        let first = scratch.join("statement.csv");
        let second = scratch.join("notes.txt");
        std::fs::write(&first, "account,value\nUFE03,17.10\n").map_err(|e| e.to_string())?;
        std::fs::write(&second, "second file").map_err(|e| e.to_string())?;
        let staged = crate::browser_upload::stage(&scratch.join("staged"), &[first, second])?;
        let (origin, pinned_tab) =
            super::upload_page(app, SESSION.into(), &json!({"tabId":tab})).await?;
        if origin != crate::browser_upload::origin_of(url.as_str())? || pinned_tab != tab {
            return Err(format!("The upload page read {origin} on {pinned_tab}."));
        }
        if !super::upload_check(app, SESSION.into(), &json!({"tabId":tab,"ref":input})).await?
            || super::upload_check(app, SESSION.into(), &json!({"tabId":tab,"ref":plain})).await?
        {
            return Err("The ref check did not tell the file input from the button.".into());
        }

        let args = json!({"tabId":tab,"ref":input,"uploadId":1});
        super::upload_arm(app, SESSION.into(), &args, &origin, &staged).await?;
        wait_state(app, &args, "taken").await?;
        wait_value(
            app,
            &tab,
            "Array.isArray(window.uploaded) && window.uploaded.length===2",
        )
        .await?;
        let uploaded = evaluate(app, &tab, "window.uploaded").await?;
        let names: Vec<&str> = uploaded
            .as_array()
            .map(|files| files.iter().filter_map(|f| f["name"].as_str()).collect())
            .unwrap_or_default();
        if names != ["statement.csv", "notes.txt"]
            || uploaded[0]["text"] != "account,value\nUFE03,17.10\n"
        {
            return Err(format!(
                "The page received other files than the armed ones: {uploaded}"
            ));
        }

        // A click that opens no chooser waits, then ends expired, never taken.
        let plain_args = json!({"tabId":tab,"ref":plain,"uploadId":2});
        super::upload_arm(app, SESSION.into(), &plain_args, &origin, &staged).await?;
        tokio::time::sleep(Duration::from_millis(300)).await;
        if state(app, &plain_args).await? != "waiting" {
            return Err("A click that opened no chooser did not leave the upload waiting.".into());
        }
        wait_state(app, &plain_args, "expired").await?;

        // Withdrawing works with no call grant.
        let withdrawn = json!({"tabId":tab,"ref":plain,"uploadId":3});
        super::upload_arm(app, SESSION.into(), &withdrawn, &origin, &staged).await?;
        super::upload_disarm(app, SESSION.into(), &withdrawn).await?;
        if state(app, &withdrawn).await? != "expired" {
            return Err("Withdrawing an armed upload left it armed.".into());
        }

        let foreign_args = json!({"tabId":tab,"ref":input,"uploadId":4});
        let foreign = super::upload_arm(
            app,
            SESSION.into(),
            &foreign_args,
            "http://example.invalid/",
            &staged,
        )
        .await;
        if foreign.is_ok() || state(app, &foreign_args).await? != "expired" {
            return Err("An upload was armed for another origin than the page's.".into());
        }

        // Nothing armed: the click is answered as a person's, with the system open panel. It shows,
        // and cancelling it leaves the input as it was, with no change event.
        let before = open_panels(app, false).await?;
        execute(
            app,
            SESSION.into(),
            json!({"operation":"click","tabId":tab,"ref":input}),
        )
        .await?;
        let shown = wait_panels(app, |count| count > before).await?;
        tokio::time::sleep(Duration::from_millis(1500)).await;
        open_panels(app, true).await?;
        wait_panels(app, |count| count == before).await?;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let after = evaluate(
            app,
            &tab,
            "({changes: window.changes, files: document.querySelector('input[type=file]').files.length})",
        )
        .await?;
        if after != json!({"changes":1,"files":2}) {
            return Err(format!("Cancelling the open panel changed the input: {after}"));
        }

        Ok::<_, String>(json!({
            "received": names,
            "refChecked": true,
            "plainClickExpired": true,
            "disarmed": true,
            "otherOriginRefused": true,
            "systemPanelShown": shown > before,
            "panelCancelLeftInput": true,
        }))
    }
    .await;
    close_session(app, SESSION.into());
    let _ = std::fs::remove_dir_all(&scratch);
    result
}
