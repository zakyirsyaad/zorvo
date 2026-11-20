//! Which app a bundle id, a path or a running process is, and who signed it.
//!
//! An agent only ever names a bundle id or a pid. Zorvo turns that into a
//! path through LaunchServices or the kernel, and reads the name and the
//! signature from the app on disk, so nothing the agent writes is shown as
//! the app's name.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::agent_tools::peer::ProcessId;

/// The longest app name kept; the card shows it on one line.
const MAX_NAME_CHARS: usize = 80;
/// Running apps remembered; the table is emptied when it fills.
const MAX_REMEMBERED: usize = 256;
/// The side of the icon's square, twice the 32 px it is drawn at.
const ICON_PIXELS: &str = "64";
const MAX_ICON_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppIdentity {
    pub name: String,
    pub path: PathBuf,
    pub bundle_id: Option<String>,
    /// The signing identifier the signature carries.
    pub identifier: Option<String>,
    /// The team of a signature Apple issued to a developer.
    pub team: Option<String>,
    /// The developer's name from the signing certificate.
    pub signer: Option<String>,
    /// Signed by Apple itself.
    pub apple: bool,
    /// Not signed, signed ad hoc, or signed by no one Apple knows.
    pub ad_hoc: bool,
}

/// What `codesign -dv --verbose=2` printed about a signature. Nothing here is
/// verified: it is what the signature says of itself.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Signature {
    pub identifier: Option<String>,
    pub team: Option<String>,
    pub authority: Option<String>,
    pub ad_hoc: bool,
}

pub fn parse_signature(display: &str) -> Signature {
    let mut signature = Signature::default();
    for line in display.lines() {
        if let Some(value) = line.strip_prefix("Identifier=") {
            signature.identifier = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("TeamIdentifier=") {
            let value = value.trim();
            signature.team = is_team_id(value).then(|| value.to_string());
        } else if let Some(value) = line.strip_prefix("Authority=") {
            // The first authority is the leaf: who signed.
            signature.authority.get_or_insert(value.trim().to_string());
        } else if line.trim() == "Signature=adhoc" {
            signature.ad_hoc = true;
        }
    }
    signature
}

fn is_team_id(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

/// "Brave Software, Inc." from "Developer ID Application: Brave Software,
/// Inc. (KL8N8XSYF4)"; `None` for an authority that names no developer.
fn developer_of(authority: &str, team: &str) -> Option<String> {
    let name = authority.split_once(": ")?.1;
    let name = name
        .strip_suffix(&format!("({team})"))
        .unwrap_or(name)
        .trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Who signed `app`, as the card says it.
pub fn signer_label(app: &AppIdentity) -> String {
    match (&app.team, &app.signer) {
        _ if app.apple => "Apple".to_string(),
        (Some(team), Some(signer)) => format!("{signer} ({team})"),
        (Some(team), None) => format!("Team {team}"),
        _ => "Not signed".to_string(),
    }
}

/// The innermost `.app` folder `executable` sits in.
pub fn enclosing_app(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .skip(1)
        .find(|dir| dir.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

fn info_plist(app: &Path) -> Option<plist::Dictionary> {
    plist::Value::from_file(app.join("Contents/Info.plist"))
        .ok()?
        .into_dictionary()
}

fn text_of(info: &plist::Dictionary, key: &str) -> Option<String> {
    let text = info.get(key)?.as_string()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn name_of(app: &Path, info: Option<&plist::Dictionary>) -> String {
    let named = info.and_then(|info| {
        text_of(info, "CFBundleDisplayName").or_else(|| text_of(info, "CFBundleName"))
    });
    let name = named.unwrap_or_else(|| {
        app.file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default()
    });
    name.chars().take(MAX_NAME_CHARS).collect()
}

#[cfg(target_os = "macos")]
fn codesign(app: &Path, args: &[&str]) -> Option<std::process::Output> {
    crate::spawn::command("/usr/bin/codesign")
        .args(args)
        .arg(app)
        .output()
        .ok()
}

/// Whether the signature on `app` is valid and meets `requirement`. Resources
/// are not hashed: Xcode's would take minutes, and the name and the signer
/// come from the signature, not from them.
#[cfg(target_os = "macos")]
fn meets(app: &Path, requirement: &str) -> bool {
    let requirement = format!("-R={requirement}");
    codesign(app, &["--verify", "--ignore-resources", &requirement])
        .is_some_and(|output| output.status.success())
}

#[cfg(target_os = "macos")]
fn signature_of(app: &Path) -> (Signature, bool, bool) {
    let Some(output) = codesign(app, &["-dv", "--verbose=2"]) else {
        return (Signature::default(), false, false);
    };
    // `codesign -d` writes to stderr.
    let signature = parse_signature(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() || signature.ad_hoc {
        return (signature, false, false);
    }
    // Anything Apple signed or let a developer sign; only then is the team
    // in the signature one Apple gave out.
    let is_known = meets(app, "anchor apple generic");
    let is_apple = is_known && signature.team.is_none() && meets(app, "anchor apple");
    (signature, is_known, is_apple)
}

#[cfg(not(target_os = "macos"))]
fn signature_of(_app: &Path) -> (Signature, bool, bool) {
    (Signature::default(), false, false)
}

/// The app at `app`, read from disk. `None` when it is not an app bundle.
pub fn identity_of_path(app: &Path) -> Option<AppIdentity> {
    let path = app.canonicalize().ok()?;
    if !path.is_dir() || path.extension().is_none_or(|ext| ext != "app") {
        return None;
    }
    let info = info_plist(&path);
    let (signature, is_known, is_apple) = signature_of(&path);
    let team = signature.team.filter(|_| is_known && !is_apple);
    let signer = team.as_deref().and_then(|team| {
        signature
            .authority
            .as_deref()
            .and_then(|authority| developer_of(authority, team))
    });
    Some(AppIdentity {
        name: name_of(&path, info.as_ref()),
        bundle_id: info
            .as_ref()
            .and_then(|info| text_of(info, "CFBundleIdentifier")),
        identifier: signature.identifier,
        team,
        signer,
        apple: is_apple,
        ad_hoc: !is_known,
        path,
    })
}

#[cfg(target_os = "macos")]
fn path_of_bundle_id(bundle_id: &str) -> Option<PathBuf> {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    let workspace_class = AnyClass::get(c"NSWorkspace")?;
    let id = NSString::from_str(bundle_id);
    // SAFETY: plain messages with the argument and return types AppKit
    // declares; `URLForApplicationWithBundleIdentifier:` may be called from
    // any thread.
    unsafe {
        let workspace: Option<Retained<AnyObject>> =
            objc2::msg_send![workspace_class, sharedWorkspace];
        let url: Option<Retained<AnyObject>> =
            objc2::msg_send![&*workspace?, URLForApplicationWithBundleIdentifier: &*id];
        let path: Option<Retained<NSString>> = objc2::msg_send![&*url?, path];
        Some(PathBuf::from(path?.to_string()))
    }
}

#[cfg(not(target_os = "macos"))]
fn path_of_bundle_id(_bundle_id: &str) -> Option<PathBuf> {
    None
}

/// The installed app macOS opens for `bundle_id`.
pub fn resolve_bundle_id(bundle_id: &str) -> Option<AppIdentity> {
    identity_of_path(&path_of_bundle_id(bundle_id)?)
}

#[cfg(target_os = "macos")]
fn executable_of(pid: i32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStringExt;

    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: the buffer is as long as the size passed.
    let length =
        unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if length <= 0 {
        return None;
    }
    buffer.truncate(length as usize);
    Some(PathBuf::from(std::ffi::OsString::from_vec(buffer)))
}

#[cfg(not(target_os = "macos"))]
fn executable_of(_pid: i32) -> Option<PathBuf> {
    None
}

/// The app the process `pid` runs from, with the process's start time so a
/// reused pid is another process. `None` for a process outside an app bundle.
pub fn running(pid: i32) -> Option<(AppIdentity, ProcessId)> {
    static SEEN: Mutex<Option<HashMap<ProcessId, AppIdentity>>> = Mutex::new(None);

    let process = ProcessId::of(pid)?;
    let remembered = |seen: &Mutex<Option<HashMap<ProcessId, AppIdentity>>>| {
        seen.lock().ok()?.as_ref()?.get(&process).cloned()
    };
    if let Some(app) = remembered(&SEEN) {
        return Some((app, process));
    }
    let app = identity_of_path(&enclosing_app(&executable_of(pid)?)?)?;
    // The path was read after the start time: a pid reused in between would
    // pair one process's time with another's app.
    if ProcessId::of(pid) != Some(process) {
        return None;
    }
    if let Ok(mut seen) = SEEN.lock() {
        let seen = seen.get_or_insert_with(HashMap::new);
        if seen.len() >= MAX_REMEMBERED {
            seen.clear();
        }
        seen.insert(process, app.clone());
    }
    Some((app, process))
}

fn icon_file(app: &Path) -> Option<PathBuf> {
    let name = text_of(&info_plist(app)?, "CFBundleIconFile")?;
    // The name is one file in Resources, with or without its extension.
    if name.contains('/') || name.contains("..") {
        return None;
    }
    let resources = app.join("Contents/Resources");
    [
        resources.join(&name),
        resources.join(format!("{name}.icns")),
    ]
    .into_iter()
    .find(|file| file.is_file())
}

/// The app's icon as a PNG data URL, when the bundle holds an `.icns` file.
#[cfg(target_os = "macos")]
pub fn icon_png(app: &Path) -> Option<String> {
    use base64::Engine;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    let icon = icon_file(app)?;
    let out = std::env::temp_dir().join(format!(
        "zorvo-icon-{}-{}.png",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let made = crate::spawn::command("/usr/bin/sips")
        .args(["-s", "format", "png", "-Z", ICON_PIXELS])
        .arg(&icon)
        .arg("--out")
        .arg(&out)
        .output()
        .is_ok_and(|output| output.status.success());
    let bytes = made.then(|| std::fs::read(&out).ok()).flatten();
    let _ = std::fs::remove_file(&out);
    let bytes = bytes
        .filter(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() <= MAX_ICON_BYTES)?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn icon_png(_app: &Path) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const APPLE: &str = "Executable=/System/Applications/Notes.app/Contents/MacOS/Notes\n\
Identifier=com.apple.Notes\n\
Format=app bundle with Mach-O universal (x86_64 arm64e)\n\
CodeDirectory v=20400 size=1 flags=0x0(none) hashes=1+7 location=embedded\n\
Authority=Software Signing\n\
Authority=Apple Code Signing Certification Authority\n\
Authority=Apple Root CA\n\
TeamIdentifier=not set\n";

    const DEVELOPER: &str = "Identifier=com.brave.Browser\n\
Authority=Developer ID Application: Brave Software, Inc. (KL8N8XSYF4)\n\
Authority=Developer ID Certification Authority\n\
Authority=Apple Root CA\n\
TeamIdentifier=KL8N8XSYF4\n";

    const AD_HOC: &str = "Identifier=xyz.zorvo.desktop.spike\n\
CodeDirectory v=20400 size=1 flags=0x2(adhoc) hashes=1+3 location=embedded\n\
Signature=adhoc\n\
TeamIdentifier=not set\n";

    fn app(team: Option<&str>, signer: Option<&str>, apple: bool) -> AppIdentity {
        AppIdentity {
            name: "App".to_string(),
            path: PathBuf::from("/Applications/App.app"),
            bundle_id: None,
            identifier: None,
            team: team.map(str::to_string),
            signer: signer.map(str::to_string),
            apple,
            ad_hoc: team.is_none() && !apple,
        }
    }

    #[test]
    fn reads_an_apple_signature() {
        let signature = parse_signature(APPLE);
        assert_eq!(signature.identifier.as_deref(), Some("com.apple.Notes"));
        assert_eq!(signature.team, None);
        assert_eq!(signature.authority.as_deref(), Some("Software Signing"));
        assert!(!signature.ad_hoc);
    }

    #[test]
    fn reads_a_developer_signature() {
        let signature = parse_signature(DEVELOPER);
        assert_eq!(signature.team.as_deref(), Some("KL8N8XSYF4"));
        assert_eq!(
            developer_of(signature.authority.as_deref().unwrap(), "KL8N8XSYF4").as_deref(),
            Some("Brave Software, Inc.")
        );
    }

    #[test]
    fn reads_an_ad_hoc_signature_and_an_unsigned_app() {
        assert!(parse_signature(AD_HOC).ad_hoc);
        let unsigned = parse_signature("/x/App.app: code object is not signed at all\n");
        assert_eq!(unsigned, Signature::default());
    }

    #[test]
    fn a_team_that_is_not_ten_capitals_or_digits_is_dropped() {
        let odd = parse_signature("TeamIdentifier=\" or anchor apple\n");
        assert_eq!(odd.team, None);
    }

    #[test]
    fn says_who_signed() {
        assert_eq!(signer_label(&app(None, None, true)), "Apple");
        assert_eq!(
            signer_label(&app(
                Some("KL8N8XSYF4"),
                Some("Brave Software, Inc."),
                false
            )),
            "Brave Software, Inc. (KL8N8XSYF4)"
        );
        assert_eq!(
            signer_label(&app(Some("KL8N8XSYF4"), None, false)),
            "Team KL8N8XSYF4"
        );
        assert_eq!(signer_label(&app(None, None, false)), "Not signed");
    }

    #[test]
    fn finds_the_innermost_app_folder() {
        assert_eq!(
            enclosing_app(Path::new(
                "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator"
            )),
            Some(PathBuf::from(
                "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app"
            ))
        );
        assert_eq!(enclosing_app(Path::new("/usr/bin/true")), None);
    }

    #[test]
    fn a_folder_that_is_not_an_app_has_no_identity() {
        assert_eq!(identity_of_path(Path::new("/usr/bin")), None);
        assert_eq!(identity_of_path(Path::new("/no/such/Thing.app")), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn notes_is_an_apple_app() {
        let notes = identity_of_path(Path::new("/System/Applications/Notes.app")).unwrap();
        assert_eq!(notes.name, "Notes");
        assert_eq!(notes.bundle_id.as_deref(), Some("com.apple.Notes"));
        assert_eq!(notes.identifier.as_deref(), Some("com.apple.Notes"));
        assert!(notes.apple);
        assert!(!notes.ad_hoc);
        assert_eq!(notes.team, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_resolves_from_its_bundle_id_and_its_process() {
        let finder = resolve_bundle_id("com.apple.finder").unwrap();
        assert!(finder.path.ends_with("Finder.app"));
        assert_eq!(resolve_bundle_id("xyz.zorvo.no-such-app"), None);
        // This test process runs from no app bundle.
        assert_eq!(running(std::process::id() as i32), None);
    }
}
