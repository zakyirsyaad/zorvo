//! `request_access`: the agent names apps, the user ticks which it may use.
//!
//! The agent's text never reaches the card as an app's name: each bundle id
//! is resolved to an app on this Mac, and the row shows what that app's
//! bundle and signature say. The resolved rows stay here with the waiting
//! call, so an answer can only grant rows of the card it answers.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use super::apps::{self, AppIdentity};
use super::grants::AppGrant;
use super::tiers::{self, Tier};

pub const MAX_APPS: usize = 10;
pub const MAX_REASON_CHARS: usize = 500;
const MAX_BUNDLE_ID_CHARS: usize = 255;

const APPS_RULE: &str = "apps must be a list of 1 to 10 bundle ids, like \"com.apple.Notes\".";
const REASON_RULE: &str = "reason must be 1 to 500 characters saying why you need the apps.";
const FIELDS_RULE: &str = "Unknown argument. request_access takes: apps, reason.";

/// One app on the card.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AppRow {
    /// What the webview sends back for a ticked row.
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    pub signer: Option<String>,
    pub tier: Tier,
    pub label: &'static str,
    pub warning: Option<&'static str>,
    pub installed: bool,
    pub icon: Option<String>,
    #[serde(skip)]
    pub app: Option<AppIdentity>,
}

/// The card's payload, sent as `computer-use-request`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub call_id: String,
    pub session_id: String,
    pub kind: &'static str,
    pub reason: String,
    pub apps: Vec<AppRow>,
}

/// The bundle ids and the reason of a `request_access` call, or a sentence
/// for the agent. A bundle id asked twice is kept once.
pub fn validate(args: &Value) -> Result<(Vec<String>, String), String> {
    let object = args
        .as_object()
        .ok_or_else(|| "The arguments must be a JSON object.".to_string())?;
    if object.keys().any(|key| key != "apps" && key != "reason") {
        return Err(FIELDS_RULE.to_string());
    }
    let listed = object
        .get("apps")
        .and_then(Value::as_array)
        .ok_or(APPS_RULE)?;
    let mut ids: Vec<String> = Vec::new();
    for item in listed {
        let id = item.as_str().map(str::trim).ok_or(APPS_RULE)?;
        let is_bundle_id = !id.is_empty()
            && id.len() <= MAX_BUNDLE_ID_CHARS
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
        if !is_bundle_id {
            return Err(APPS_RULE.to_string());
        }
        if !ids.iter().any(|seen| seen.eq_ignore_ascii_case(id)) {
            ids.push(id.to_string());
        }
    }
    if ids.is_empty() || ids.len() > MAX_APPS {
        return Err(APPS_RULE.to_string());
    }
    let reason = object
        .get("reason")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|reason| !reason.is_empty() && reason.chars().count() <= MAX_REASON_CHARS)
        .ok_or(REASON_RULE)?;
    Ok((ids, reason.to_string()))
}

/// The card's rows for `bundle_ids`, each resolved with `resolve`.
pub fn rows_for(
    bundle_ids: &[String],
    resolve: impl Fn(&str) -> Option<AppIdentity> + Sync,
    icon: impl Fn(&AppIdentity) -> Option<String> + Sync,
) -> Vec<AppRow> {
    // Reading an app runs `codesign` a few times: every app at once, each on
    // a thread of its own, in the order asked.
    let found: Vec<Option<(AppIdentity, Option<String>)>> = std::thread::scope(|scope| {
        let reads: Vec<_> = bundle_ids
            .iter()
            .map(|bundle_id| {
                let (resolve, icon) = (&resolve, &icon);
                scope.spawn(move || {
                    resolve(bundle_id).map(|app| {
                        let icon = icon(&app);
                        (app, icon)
                    })
                })
            })
            .collect();
        reads
            .into_iter()
            .map(|read| read.join().ok().flatten())
            .collect()
    });
    bundle_ids
        .iter()
        .zip(found)
        .enumerate()
        .map(|(index, (bundle_id, found))| {
            let key = format!("app-{}", index + 1);
            match found {
                Some((app, icon)) => {
                    let tier = tiers::tier_of(Some(&app));
                    AppRow {
                        key,
                        name: app.name.clone(),
                        path: Some(app.path.to_string_lossy().into_owned()),
                        signer: Some(apps::signer_label(&app)),
                        tier,
                        label: tiers::row_label(tier),
                        warning: (tier != Tier::Never)
                            .then(|| tiers::warning_of(&app))
                            .flatten(),
                        installed: true,
                        icon,
                        app: Some(app),
                    }
                }
                None => AppRow {
                    key,
                    name: bundle_id.clone(),
                    path: None,
                    signer: None,
                    tier: Tier::Never,
                    label: "Not on this Mac",
                    warning: None,
                    installed: false,
                    icon: None,
                    app: None,
                },
            }
        })
        .collect()
}

struct Waiting {
    call_id: String,
    reason: String,
    rows: Vec<AppRow>,
}

#[derive(Default)]
struct SessionCards {
    /// The card on screen.
    open: Option<Waiting>,
    /// Requests that arrived while it was, oldest first.
    queued: VecDeque<Waiting>,
}

/// What an answer did.
#[derive(Debug, PartialEq, Eq)]
pub struct Answered {
    pub session: String,
    pub grants: Vec<AppGrant>,
    /// What the agent is told.
    pub text: String,
    /// The session's next card, to show now.
    pub next: Option<RequestView>,
}

/// What ending a request without an answer did.
#[derive(Debug, PartialEq, Eq)]
pub struct Ended {
    /// It was on screen, so the webview has a card to settle.
    pub was_open: bool,
    pub next: Option<RequestView>,
}

/// The cards that wait, one on screen per session.
#[derive(Default)]
pub struct Requests {
    by_session: Mutex<HashMap<String, SessionCards>>,
}

fn view(session: &str, waiting: &Waiting) -> RequestView {
    RequestView {
        call_id: waiting.call_id.clone(),
        session_id: session.to_string(),
        kind: "apps",
        reason: waiting.reason.clone(),
        apps: waiting.rows.clone(),
    }
}

/// A tier as an agent reads it.
pub(crate) fn tier_words(tier: Tier) -> &'static str {
    match tier {
        Tier::Full => "full use",
        Tier::ClickOnly => "click only",
        Tier::ViewOnly => "view only",
        Tier::Never => "never",
    }
}

impl Requests {
    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionCards>> {
        self.by_session.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A request arrived. Returns its card when the session shows none; else
    /// it waits its turn.
    pub fn arrive(
        &self,
        session: &str,
        call_id: &str,
        reason: String,
        rows: Vec<AppRow>,
    ) -> Option<RequestView> {
        let waiting = Waiting {
            call_id: call_id.to_string(),
            reason,
            rows,
        };
        let mut sessions = self.sessions();
        let cards = sessions.entry(session.to_string()).or_default();
        if cards.open.is_some() {
            cards.queued.push_back(waiting);
            return None;
        }
        let shown = view(session, &waiting);
        cards.open = Some(waiting);
        Some(shown)
    }

    fn show_next(session: &str, cards: &mut SessionCards) -> Option<RequestView> {
        cards.open = cards.queued.pop_front();
        cards.open.as_ref().map(|waiting| view(session, waiting))
    }

    /// The user answered the card of `call_id` with the ticked `allowed`
    /// keys. `None` when that call shows no card (answered, ended or queued).
    pub fn answer(&self, call_id: &str, allowed: &[String]) -> Option<Answered> {
        let mut sessions = self.sessions();
        let (session, cards) = sessions.iter_mut().find(|(_, cards)| {
            cards
                .open
                .as_ref()
                .is_some_and(|open| open.call_id == call_id)
        })?;
        let answered = cards.open.take()?;
        let mut grants = Vec::new();
        let mut lines = Vec::new();
        for row in answered.rows {
            let granted = row
                .app
                .filter(|_| row.tier != Tier::Never && allowed.contains(&row.key));
            match granted {
                Some(app) => {
                    lines.push(format!("{}: allowed ({})", row.name, tier_words(row.tier)));
                    grants.push(AppGrant {
                        key: row.key,
                        app,
                        tier: row.tier,
                    });
                }
                None if !row.installed => lines.push(format!("{}: not on this Mac", row.name)),
                None => lines.push(format!("{}: not allowed", row.name)),
            }
        }
        let session = session.clone();
        let next = Self::show_next(&session, cards);
        Some(Answered {
            session,
            grants,
            text: lines.join("\n"),
            next,
        })
    }

    /// The call ended without an answer: it timed out, the agent cancelled
    /// it, or its session stopped.
    pub fn end(&self, call_id: &str) -> Option<Ended> {
        let mut sessions = self.sessions();
        for (session, cards) in sessions.iter_mut() {
            if cards
                .open
                .as_ref()
                .is_some_and(|open| open.call_id == call_id)
            {
                return Some(Ended {
                    was_open: true,
                    next: Self::show_next(session, cards),
                });
            }
            let before = cards.queued.len();
            cards.queued.retain(|waiting| waiting.call_id != call_id);
            if cards.queued.len() != before {
                return Some(Ended {
                    was_open: false,
                    next: None,
                });
            }
        }
        None
    }

    /// Every request ends unanswered: each call's id, and whether its card
    /// was on screen.
    pub fn end_all(&self) -> Vec<(String, bool)> {
        self.sessions()
            .drain()
            .flat_map(|(_, cards)| {
                let open = cards.open.map(|waiting| (waiting.call_id, true));
                let queued = cards
                    .queued
                    .into_iter()
                    .map(|waiting| (waiting.call_id, false));
                open.into_iter().chain(queued).collect::<Vec<_>>()
            })
            .collect()
    }

    /// The cards on screen, for a webview that just loaded.
    pub fn open_views(&self) -> Vec<RequestView> {
        self.sessions()
            .iter()
            .filter_map(|(session, cards)| cards.open.as_ref().map(|open| view(session, open)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer_use::grants::tests::app;
    use serde_json::json;

    fn resolve(bundle_id: &str) -> Option<AppIdentity> {
        match bundle_id {
            "com.apple.Notes" => Some(app("Notes", bundle_id)),
            "com.apple.Terminal" => Some(app("Terminal", bundle_id)),
            "com.apple.keychainaccess" => Some(app("Keychain Access", bundle_id)),
            _ => None,
        }
    }

    fn rows(ids: &[&str]) -> Vec<AppRow> {
        let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        rows_for(&ids, resolve, |_| None)
    }

    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|key| key.to_string()).collect()
    }

    #[test]
    fn refuses_zero_or_eleven_apps_and_a_501_character_reason() {
        let eleven: Vec<String> = (0..11).map(|n| format!("com.example.app{n}")).collect();
        assert_eq!(
            validate(&json!({ "apps": [], "reason": "x" })),
            Err(APPS_RULE.to_string())
        );
        assert_eq!(
            validate(&json!({ "apps": eleven, "reason": "x" })),
            Err(APPS_RULE.to_string())
        );
        assert_eq!(
            validate(&json!({ "apps": ["com.apple.Notes"], "reason": "x".repeat(501) })),
            Err(REASON_RULE.to_string())
        );
        assert_eq!(
            validate(&json!({ "apps": ["com.apple.Notes"], "reason": "  " })),
            Err(REASON_RULE.to_string())
        );
        assert_eq!(
            validate(&json!({ "apps": ["Notes; rm -rf"], "reason": "x" })),
            Err(APPS_RULE.to_string())
        );
        assert_eq!(
            validate(&json!({ "apps": ["com.apple.Notes"], "reason": "x", "pid": 1 })),
            Err(FIELDS_RULE.to_string())
        );
    }

    #[test]
    fn keeps_a_bundle_id_asked_twice_once() {
        let (ids, reason) = validate(&json!({
            "apps": ["com.apple.Notes", "COM.APPLE.NOTES", "com.apple.Terminal"],
            "reason": " Read your notes. "
        }))
        .unwrap();
        assert_eq!(ids, ["com.apple.Notes", "com.apple.Terminal"]);
        assert_eq!(reason, "Read your notes.");
    }

    #[test]
    fn rows_say_the_tier_and_what_is_missing() {
        let rows = rows(&[
            "com.apple.Notes",
            "com.apple.Terminal",
            "com.apple.keychainaccess",
            "com.example.missing",
        ]);
        assert_eq!(rows[0].label, "Full use");
        assert_eq!(rows[0].signer.as_deref(), Some("Apple"));
        assert_eq!(rows[1].label, "Click only");
        assert_eq!(rows[2].tier, Tier::Never);
        assert_eq!(rows[3].label, "Not on this Mac");
        assert_eq!(rows[3].name, "com.example.missing");
        assert!(!rows[3].installed);
        assert_eq!(rows[3].key, "app-4");
    }

    #[test]
    fn second_request_waits_for_the_first_card() {
        let requests = Requests::default();
        let first = requests.arrive("s-1", "1", "a".into(), rows(&["com.apple.Notes"]));
        let second = requests.arrive("s-1", "2", "b".into(), rows(&["com.apple.Terminal"]));
        let other = requests.arrive("s-2", "3", "c".into(), rows(&["com.apple.Notes"]));

        assert_eq!(first.unwrap().call_id, "1");
        assert_eq!(second, None);
        assert_eq!(other.unwrap().session_id, "s-2");
        // A queued call has no card to answer.
        assert_eq!(requests.answer("2", &keys(&["app-1"])), None);

        let answered = requests.answer("1", &[]).unwrap();
        assert_eq!(answered.next.unwrap().call_id, "2");
    }

    #[test]
    fn answer_grants_only_keys_of_that_call() {
        let requests = Requests::default();
        requests.arrive(
            "s-1",
            "1",
            "a".into(),
            rows(&["com.apple.Notes", "com.apple.Terminal"]),
        );

        let answered = requests
            .answer("1", &keys(&["app-2", "app-9", "full-screen"]))
            .unwrap();

        assert_eq!(answered.session, "s-1");
        assert_eq!(answered.grants.len(), 1);
        assert_eq!(answered.grants[0].app.name, "Terminal");
        assert_eq!(answered.grants[0].tier, Tier::ClickOnly);
        assert_eq!(
            answered.text,
            "Notes: not allowed\nTerminal: allowed (click only)"
        );
        // Answered once.
        assert_eq!(requests.answer("1", &keys(&["app-1"])), None);
    }

    #[test]
    fn never_and_missing_rows_cannot_be_granted() {
        let requests = Requests::default();
        requests.arrive(
            "s-1",
            "1",
            "a".into(),
            rows(&["com.apple.keychainaccess", "com.example.missing"]),
        );

        let answered = requests.answer("1", &keys(&["app-1", "app-2"])).unwrap();

        assert!(answered.grants.is_empty());
        assert_eq!(
            answered.text,
            "Keychain Access: not allowed\ncom.example.missing: not on this Mac"
        );
    }

    #[test]
    fn a_request_that_ends_gives_way_to_the_next() {
        let requests = Requests::default();
        requests.arrive("s-1", "1", "a".into(), rows(&["com.apple.Notes"]));
        requests.arrive("s-1", "2", "b".into(), rows(&["com.apple.Notes"]));
        requests.arrive("s-1", "3", "c".into(), rows(&["com.apple.Notes"]));

        // A queued request can end without ever being shown.
        let queued = requests.end("2").unwrap();
        assert!(!queued.was_open);
        assert_eq!(queued.next, None);

        let open = requests.end("1").unwrap();
        assert!(open.was_open);
        assert_eq!(open.next.unwrap().call_id, "3");
        assert_eq!(requests.end("1"), None);
        assert_eq!(requests.open_views().len(), 1);
    }

    #[test]
    fn ending_all_leaves_no_card_open_or_queued() {
        let requests = Requests::default();
        requests.arrive("s-1", "1", "a".into(), rows(&["com.apple.Notes"]));
        requests.arrive("s-1", "2", "b".into(), rows(&["com.apple.Notes"]));
        requests.arrive("s-2", "3", "c".into(), rows(&["com.apple.Notes"]));

        let mut ended = requests.end_all();
        ended.sort();

        assert_eq!(
            ended,
            vec![
                ("1".to_string(), true),
                ("2".to_string(), false),
                ("3".to_string(), true)
            ]
        );
        assert!(requests.open_views().is_empty());
        assert_eq!(requests.end("2"), None);
    }
}
