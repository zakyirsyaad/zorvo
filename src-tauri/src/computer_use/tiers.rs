//! What an agent may do in an app: nothing, look, look and click, or
//! everything.
//!
//! An entry names a signing identifier or a bundle id. A restricting entry
//! matches whoever signed the app: an agent can copy an app and sign the copy
//! itself, and a copy that claims to be Terminal must be held to Terminal's
//! tier, never trusted more for it. The other direction cannot be closed by a
//! table at all (a copy that claims a new name is a new app), which is why
//! the card shows each app's path and signer and warns on an unsigned one.
//!
//! The identifiers of the apps on the maintainer's Mac were read with
//! `codesign -dv --verbose=2` (2026-11-21, macOS 27.2); the rest are the ids
//! their vendors publish and have not been checked against an installed copy.

use super::apps::AppIdentity;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub enum Tier {
    #[serde(rename = "never")]
    Never,
    #[serde(rename = "view")]
    ViewOnly,
    #[serde(rename = "click")]
    ClickOnly,
    #[serde(rename = "full")]
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Observe,
    Click,
    Type,
    Launch,
}

/// Zorvo itself: an agent that could use it could press Allow on its own card.
pub const ZORVO: &str = "xyz.zorvo.desktop";

const NEVER: &[&str] = &[
    ZORVO,
    "com.apple.keychainaccess",
    "com.apple.Passwords",
    "com.apple.systempreferences",
    // The system's password, Touch ID and passkey prompts.
    "com.apple.SecurityAgent",
    "com.apple.LocalAuthentication.UIAgent",
    "com.apple.AuthenticationServicesCore.AuthenticationServicesAgent",
    "com.apple.loginwindow",
    "com.apple.dock",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.UserNotificationCenter",
    "com.apple.Spotlight",
    "com.apple.ScriptEditor2",
    "com.apple.Automator",
    "com.apple.shortcuts",
    "com.apple.ActivityMonitor",
    "com.apple.DiskUtility",
    "com.apple.Console",
    "com.apple.ScreenSharing",
    "com.apple.RemoteDesktop",
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.dashlane.Dashlane",
    "com.dashlane.dashlanephonefinal",
    "com.lastpass.LastPass",
    "com.lastpass.lastpassmacdesktop",
    "me.proton.pass.electron",
    "me.proton.pass.catalyst",
];

const VIEW_ONLY: &[&str] = &[
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
    "com.google.Chrome",
    "company.thebrowser.Browser",
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "org.mozilla.nightly",
    "com.microsoft.edgemac",
    "com.brave.Browser",
    "com.operasoftware.Opera",
    "com.operasoftware.OperaGX",
    "com.vivaldi.Vivaldi",
    "com.kagi.kagimacOS",
];

const CLICK_ONLY: &[&str] = &[
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "dev.warp.Warp",
    "dev.warp.Warp-Stable",
    "com.mitchellh.ghostty",
    "org.alacritty",
    "io.alacritty",
    "net.kovidgoyal.kitty",
    "com.github.wez.wezterm",
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.todesktop.230313mzl4w4u92",
    "com.exafunction.windsurf",
    "com.google.antigravity",
    "dev.zed.Zed",
    "dev.zed.Zed-Preview",
    "com.apple.dt.Xcode",
    "com.jetbrains",
    "com.google.android.studio",
];

const FILES_WARNING: &str = "Can open, move and delete your files.";
const MESSAGES_WARNING: &str = "Can send messages as you.";
const INNER_APPS_WARNING: &str = "Shows other apps inside it; Zorvo cannot tell them apart.";
const NOT_SIGNED_WARNING: &str = "Not signed. Allow it only if you built it.";

const WARNINGS: &[(&str, &str)] = &[
    ("com.apple.finder", FILES_WARNING),
    ("com.apple.mail", MESSAGES_WARNING),
    ("com.apple.MobileSMS", MESSAGES_WARNING),
    ("com.apple.iphonesimulator", INNER_APPS_WARNING),
    ("com.utmapp.UTM", INNER_APPS_WARNING),
    ("com.parallels.desktop.console", INNER_APPS_WARNING),
    ("com.vmware.fusion", INNER_APPS_WARNING),
];

/// Whether `id` is `entry` or one of its parts ("com.google.Chrome.helper",
/// "com.google.Chrome.canary"). Bundle ids compare without case, as
/// LaunchServices compares them.
fn is_entry(id: &str, entry: &str) -> bool {
    let (id, entry) = (id.to_ascii_lowercase(), entry.to_ascii_lowercase());
    id == entry
        || id
            .strip_prefix(&entry)
            .is_some_and(|rest| rest.starts_with('.'))
}

fn names(app: &AppIdentity) -> impl Iterator<Item = &str> {
    [app.identifier.as_deref(), app.bundle_id.as_deref()]
        .into_iter()
        .flatten()
}

fn is_in(app: &AppIdentity, table: &[&str]) -> bool {
    names(app).any(|id| table.iter().any(|entry| is_entry(id, entry)))
}

/// The tier of `app`; `None` is a window whose owner has no app bundle. The
/// most restricting entry either of the app's names matches wins.
pub fn tier_of(app: Option<&AppIdentity>) -> Tier {
    let Some(app) = app else {
        return Tier::Never;
    };
    if names(app).next().is_none() || is_in(app, NEVER) {
        Tier::Never
    } else if is_in(app, VIEW_ONLY) {
        Tier::ViewOnly
    } else if is_in(app, CLICK_ONLY) {
        Tier::ClickOnly
    } else {
        Tier::Full
    }
}

pub fn allows(tier: Tier, action: Action) -> bool {
    match tier {
        Tier::Never => false,
        Tier::ViewOnly => action == Action::Observe,
        Tier::ClickOnly => matches!(action, Action::Observe | Action::Click),
        Tier::Full => true,
    }
}

/// What the card says under an app's row, when there is something to say.
pub fn warning_of(app: &AppIdentity) -> Option<&'static str> {
    if app.ad_hoc {
        return Some(NOT_SIGNED_WARNING);
    }
    WARNINGS
        .iter()
        .find(|(entry, _)| names(app).any(|id| is_entry(id, entry)))
        .map(|(_, warning)| *warning)
}

pub fn row_label(tier: Tier) -> &'static str {
    match tier {
        Tier::Full => "Full use",
        Tier::ClickOnly => "Click only",
        Tier::ViewOnly => "View only",
        Tier::Never => "Never allowed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn apple(id: &str) -> AppIdentity {
        AppIdentity {
            name: id.to_string(),
            path: PathBuf::from(format!("/Applications/{id}.app")),
            bundle_id: Some(id.to_string()),
            identifier: Some(id.to_string()),
            team: None,
            signer: None,
            apple: true,
            ad_hoc: false,
        }
    }

    fn ad_hoc(id: &str) -> AppIdentity {
        AppIdentity {
            apple: false,
            ad_hoc: true,
            ..apple(id)
        }
    }

    #[test]
    fn keychain_access_is_never() {
        assert_eq!(
            tier_of(Some(&apple("com.apple.keychainaccess"))),
            Tier::Never
        );
        assert_eq!(
            tier_of(Some(&apple("com.1password.1password"))),
            Tier::Never
        );
    }

    #[test]
    fn zorvo_is_never() {
        assert_eq!(tier_of(Some(&apple(ZORVO))), Tier::Never);
        assert_eq!(tier_of(Some(&ad_hoc(ZORVO))), Tier::Never);
    }

    #[test]
    fn a_window_without_a_bundle_is_never() {
        assert_eq!(tier_of(None), Tier::Never);
        let nameless = AppIdentity {
            bundle_id: None,
            identifier: None,
            ..ad_hoc("x")
        };
        assert_eq!(tier_of(Some(&nameless)), Tier::Never);
    }

    #[test]
    fn safari_is_view_only() {
        assert_eq!(tier_of(Some(&apple("com.apple.Safari"))), Tier::ViewOnly);
        assert_eq!(
            tier_of(Some(&apple("com.google.Chrome.helper"))),
            Tier::ViewOnly
        );
        assert_eq!(tier_of(Some(&apple("COM.BRAVE.BROWSER"))), Tier::ViewOnly);
    }

    #[test]
    fn terminal_is_click_only() {
        assert_eq!(tier_of(Some(&apple("com.apple.Terminal"))), Tier::ClickOnly);
        assert_eq!(
            tier_of(Some(&apple("com.jetbrains.intellij"))),
            Tier::ClickOnly
        );
    }

    #[test]
    fn notes_is_full() {
        assert_eq!(tier_of(Some(&apple("com.apple.Notes"))), Tier::Full);
        assert_eq!(warning_of(&apple("com.apple.Notes")), None);
        // A name that only starts like an entry is another app.
        assert_eq!(tier_of(Some(&apple("com.apple.TerminalX"))), Tier::Full);
    }

    #[test]
    fn finder_mail_messages_are_full_with_warnings() {
        for (id, warning) in [
            ("com.apple.finder", FILES_WARNING),
            ("com.apple.mail", MESSAGES_WARNING),
            ("com.apple.MobileSMS", MESSAGES_WARNING),
            ("com.apple.iphonesimulator", INNER_APPS_WARNING),
        ] {
            assert_eq!(tier_of(Some(&apple(id))), Tier::Full, "{id}");
            assert_eq!(warning_of(&apple(id)), Some(warning), "{id}");
        }
    }

    #[test]
    fn an_ad_hoc_copy_using_simulators_bundle_id_is_not_simulator() {
        let copy = ad_hoc("com.apple.iphonesimulator");
        assert_eq!(tier_of(Some(&copy)), Tier::Full);
        assert_eq!(warning_of(&copy), Some(NOT_SIGNED_WARNING));
    }

    #[test]
    fn a_copy_that_claims_a_restricted_name_keeps_its_tier() {
        assert_eq!(
            tier_of(Some(&ad_hoc("com.apple.Terminal"))),
            Tier::ClickOnly
        );
        // The bundle id alone is enough, whatever the signature says.
        let renamed = AppIdentity {
            identifier: Some("anything".to_string()),
            ..ad_hoc("com.apple.Safari")
        };
        assert_eq!(tier_of(Some(&renamed)), Tier::ViewOnly);
    }

    #[test]
    fn click_only_allows_click_but_not_type() {
        assert!(allows(Tier::ClickOnly, Action::Observe));
        assert!(allows(Tier::ClickOnly, Action::Click));
        assert!(!allows(Tier::ClickOnly, Action::Type));
        assert!(!allows(Tier::ClickOnly, Action::Launch));
        assert!(allows(Tier::ViewOnly, Action::Observe));
        assert!(!allows(Tier::ViewOnly, Action::Click));
        assert!(!allows(Tier::Never, Action::Observe));
        assert!(allows(Tier::Full, Action::Launch));
    }
}
