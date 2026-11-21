//! Which apps each session may use. Memory only: a grant lasts until its
//! session ends, the user stops computer use, or Zorvo quits.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;

use super::apps::AppIdentity;
use super::tiers::Tier;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppGrant {
    /// The row's key in the card that granted it.
    pub key: String,
    pub app: AppIdentity,
    pub tier: Tier,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GrantedApp {
    pub name: String,
    pub tier: Tier,
}

/// What the webview reads to show a session's status line and icon.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantView {
    pub session_id: String,
    pub apps: Vec<GrantedApp>,
    pub full_screen: bool,
}

#[derive(Default)]
pub struct Grants {
    by_session: Mutex<HashMap<String, Vec<AppGrant>>>,
}

impl Grants {
    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, Vec<AppGrant>>> {
        self.by_session.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Adds `apps` to what `session` may use; an app granted again takes its
    /// new row's place.
    pub fn grant(&self, session: &str, apps: Vec<AppGrant>) {
        if apps.is_empty() {
            return;
        }
        let mut sessions = self.sessions();
        let held = sessions.entry(session.to_string()).or_default();
        for grant in apps {
            held.retain(|old| old.app.path != grant.app.path);
            held.push(grant);
        }
    }

    /// The session's grant for the running app `running`: the same path and
    /// the same code identity as when the user answered. An app that moved,
    /// or was signed again, needs a new grant.
    pub fn app_for(&self, session: &str, running: &AppIdentity) -> Option<AppGrant> {
        self.sessions()
            .get(session)?
            .iter()
            .find(|grant| grant.app == *running)
            .cloned()
    }

    pub fn apps_of(&self, session: &str) -> Vec<AppGrant> {
        self.sessions().get(session).cloned().unwrap_or_default()
    }

    /// Whether anything was held.
    pub fn revoke(&self, session: &str) -> bool {
        self.sessions().remove(session).is_some()
    }

    pub fn revoke_all(&self) {
        self.sessions().clear();
    }

    pub fn views(&self) -> Vec<GrantView> {
        let mut views: Vec<GrantView> = self
            .sessions()
            .iter()
            .map(|(session, apps)| GrantView {
                session_id: session.clone(),
                apps: apps
                    .iter()
                    .map(|grant| GrantedApp {
                        name: grant.app.name.clone(),
                        tier: grant.tier,
                    })
                    .collect(),
                full_screen: false,
            })
            .collect();
        views.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        views
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    pub(crate) fn app(name: &str, id: &str) -> AppIdentity {
        AppIdentity {
            name: name.to_string(),
            path: PathBuf::from(format!("/Applications/{name}.app")),
            bundle_id: Some(id.to_string()),
            identifier: Some(id.to_string()),
            team: None,
            signer: None,
            apple: true,
            ad_hoc: false,
        }
    }

    fn grant(name: &str, id: &str) -> AppGrant {
        AppGrant {
            key: "app-1".to_string(),
            app: app(name, id),
            tier: Tier::Full,
        }
    }

    #[test]
    fn a_grant_belongs_to_one_session() {
        let grants = Grants::default();
        grants.grant("s-1", vec![grant("Notes", "com.apple.Notes")]);

        assert!(grants
            .app_for("s-1", &app("Notes", "com.apple.Notes"))
            .is_some());
        assert!(grants
            .app_for("s-2", &app("Notes", "com.apple.Notes"))
            .is_none());
    }

    #[test]
    fn an_app_at_another_path_or_with_another_signature_has_no_grant() {
        let grants = Grants::default();
        grants.grant("s-1", vec![grant("Notes", "com.apple.Notes")]);

        let moved = AppIdentity {
            path: PathBuf::from("/tmp/Notes.app"),
            ..app("Notes", "com.apple.Notes")
        };
        let resigned = AppIdentity {
            apple: false,
            ad_hoc: true,
            ..app("Notes", "com.apple.Notes")
        };
        assert!(grants.app_for("s-1", &moved).is_none());
        assert!(grants.app_for("s-1", &resigned).is_none());
    }

    #[test]
    fn revoke_clears_only_that_session() {
        let grants = Grants::default();
        grants.grant("s-1", vec![grant("Notes", "com.apple.Notes")]);
        grants.grant("s-2", vec![grant("Notes", "com.apple.Notes")]);

        assert!(grants.revoke("s-1"));
        assert!(!grants.revoke("s-1"));

        let views = grants.views();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].session_id, "s-2");
        assert_eq!(views[0].apps[0].name, "Notes");
    }

    #[test]
    fn granting_an_app_again_keeps_one_row() {
        let grants = Grants::default();
        grants.grant("s-1", vec![grant("Notes", "com.apple.Notes")]);
        grants.grant("s-1", vec![grant("Notes", "com.apple.Notes")]);

        assert_eq!(grants.apps_of("s-1").len(), 1);
    }
}
