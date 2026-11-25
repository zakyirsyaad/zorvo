//! Agent file uploads into the in-app WebKit browser.
//!
//! The Chromium engine sets a file input's files over CDP, but it runs in its own window with a
//! temporary profile, so it cannot upload to a site the user is signed in to in the WebKit tab.
//! WebKit has no such call: a page's file input asks the app for files through the UI delegate's
//! open-panel method. So an approved upload is armed on the tab, the input is clicked, and the
//! delegate answers that one request with the approved files (`browser/policy.rs`).
//!
//! The rules match the Chromium worker's (`resources/browser-cdp/files.mjs`): files must resolve
//! inside the session's workspace, the user approves the exact files and the receiving origin on a
//! one-time card, and the files are copied to a staging folder first, so a file swapped after the
//! approval is not the one sent.

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// At most this many files in one upload.
pub const MAX_FILES: usize = 10;
/// At most this many bytes in one upload, all files together (the Chromium worker's `MAX_FILE`).
pub const MAX_BYTES: u64 = 5 * 1024 * 1024;
/// How long an armed upload waits for the page's file chooser before it is withdrawn.
pub const ARM_TTL: Duration = Duration::from_secs(5);
/// Staged copies older than this are removed at the next upload: a form may send them well after
/// the upload, so they cannot go at once.
pub const STAGED_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub const NEEDS_APPROVAL: &str =
    "This upload needs explicit permission for these files and the receiving origin.";
pub const NOT_A_FILE_INPUT: &str =
    "The element did not open a file chooser. Point ref at an input of type file.";

/// The `paths` an agent asked to upload: 1 to `MAX_FILES` non-empty strings.
pub fn requested_paths(args: &Value) -> Result<Vec<String>, String> {
    let paths = args
        .get("paths")
        .and_then(Value::as_array)
        .ok_or("Specify the files to upload in paths.")?;
    if paths.is_empty() {
        return Err("Specify at least one file.".into());
    }
    if paths.len() > MAX_FILES {
        return Err(format!("Upload at most {MAX_FILES} files at once."));
    }
    paths
        .iter()
        .map(|path| {
            path.as_str()
                .filter(|p| !p.is_empty() && p.len() <= 4096 && !p.contains('\0'))
                .map(str::to_owned)
                .ok_or_else(|| "Each path must be a file name or path.".to_string())
        })
        .collect()
}

/// A file inside `root` (canonical): relative paths are read against it, and the resolved file,
/// links followed, must stay inside it. The error never repeats the path.
pub fn workspace_file(root: &Path, path: &str) -> Result<PathBuf, String> {
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|_| "Choose a file in the session workspace.".to_string())?;
    if !canonical.starts_with(root) {
        return Err("Choose a file in the session workspace.".into());
    }
    if !canonical.is_file() {
        return Err("Choose a file, not a folder.".into());
    }
    Ok(canonical)
}

/// The receiving origin of a page, as the approval card shows it: `https://example.com/`.
pub fn origin_of(url: &str) -> Result<String, String> {
    let checked = crate::browser::navigation_url(url)
        .map_err(|_| "Open a web page before uploading files.".to_string())?;
    let parsed =
        url::Url::parse(&checked).map_err(|_| "Open a web page before uploading files.")?;
    Ok(format!("{}/", parsed.origin().ascii_serialization()))
}

/// The origin of a frame as WebKit reports it, in the same form as `origin_of`. Port 0 is the
/// scheme's default, which an origin leaves out.
pub fn frame_origin(protocol: &str, host: &str, port: i64) -> String {
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    let default = matches!((protocol, port), ("https", 443) | ("http", 80));
    if port <= 0 || default {
        format!("{protocol}://{host}/")
    } else {
        format!("{protocol}://{host}:{port}/")
    }
}

/// What the one-time card asks the user to approve.
pub fn approval_for(url: &str, paths: &[PathBuf]) -> Value {
    json!({
        "url": url,
        "paths": paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
        "engine": "webkit",
    })
}

/// The approval covers exactly this origin and these files, in this order.
pub fn matches_approval(approval: &Value, url: &str, paths: &[PathBuf]) -> bool {
    let Some(approved) = approval.get("paths").and_then(Value::as_array) else {
        return false;
    };
    approval.get("url").and_then(Value::as_str) == Some(url)
        && approved.len() == paths.len()
        && approved
            .iter()
            .zip(paths)
            .all(|(a, p)| a.as_str() == Some(&*p.to_string_lossy()))
}

/// Copies `sources` into a new folder under `dir`, each in its own subfolder so names never clash,
/// files 0600 and folders 0700, at most `MAX_BYTES` in all. Returns the copies, in order.
pub fn stage(dir: &Path, sources: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|_| "The upload could not be prepared.")?;
    let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let staging = dir.join(format!("upload-{name}"));
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&staging)
        .map_err(|_| "The upload could not be prepared.")?;
    let result = (|| {
        let mut remaining = MAX_BYTES;
        let mut staged = Vec::with_capacity(sources.len());
        for (index, source) in sources.iter().enumerate() {
            let file_name = source.file_name().ok_or("Choose a file, not a folder.")?;
            let folder = staging.join(index.to_string());
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&folder)
                .map_err(|_| "The upload could not be prepared.")?;
            let mut data = Vec::new();
            std::fs::File::open(source)
                .map_err(|_| "A file to upload could not be read.")?
                .take(remaining + 1)
                .read_to_end(&mut data)
                .map_err(|_| "A file to upload could not be read.")?;
            if data.len() as u64 > remaining {
                return Err(format!(
                    "Files to upload may hold at most {} MB together.",
                    MAX_BYTES / 1024 / 1024
                ));
            }
            remaining -= data.len() as u64;
            let target = folder.join(file_name);
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&target)
                .map_err(|_| "The upload could not be prepared.")?;
            std::io::Write::write_all(&mut file, &data)
                .map_err(|_| "The upload could not be prepared.")?;
            staged.push(target);
        }
        Ok(staged)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

/// Removes staged uploads older than `max_age` under `dir`; only `upload-*` folders are touched.
pub fn sweep(dir: &Path, now: SystemTime, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let is_upload = entry.file_name().to_string_lossy().starts_with("upload-");
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        let is_old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > max_age);
        if is_upload && is_dir && is_old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The approval card's content for a WebKit upload: the page's origin and the canonical files.
#[cfg(target_os = "macos")]
pub async fn info(
    app: &tauri::AppHandle,
    session: &str,
    root: &Path,
    args: &Value,
) -> Result<Value, String> {
    let paths = requested_paths(args)?
        .iter()
        .map(|path| workspace_file(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    let page = crate::browser::upload_page(app, session.into(), args).await?;
    Ok(approval_for(&origin_of(&page)?, &paths))
}

/// Uploads the approved files into the file input at `ref`: checks the approval against the files
/// and the page as they are now, stages copies, arms the tab and clicks the input. The answer says
/// so only once the page's file chooser has taken the files.
#[cfg(target_os = "macos")]
pub async fn upload(
    app: &tauri::AppHandle,
    session: &str,
    root: &Path,
    args: &Value,
    approval: &Value,
) -> Result<Value, String> {
    use tauri::Manager;
    if args.get("ref").and_then(Value::as_str).is_none() {
        return Err("Point ref at the file input to upload into.".into());
    }
    let paths = requested_paths(args)?
        .iter()
        .map(|path| workspace_file(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    let page = crate::browser::upload_page(app, session.into(), args).await?;
    let origin = origin_of(&page)?;
    if !matches_approval(approval, &origin, &paths) {
        return Err(NEEDS_APPROVAL.into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "The upload could not be prepared.")?
        .join("browser-uploads");
    sweep(&dir, SystemTime::now(), STAGED_MAX_AGE);
    let staged = stage(&dir, &paths)?;
    crate::browser::upload_arm(app, session.into(), args, &origin, &staged).await?;
    let deadline = std::time::Instant::now() + ARM_TTL;
    while std::time::Instant::now() < deadline {
        if !crate::browser::upload_pending(app, session.into(), args).await? {
            return Ok(json!({"files": staged.len(), "engine": "webkit"}));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let _ = crate::browser::upload_disarm(app, session.into(), args).await;
    Err(NOT_A_FILE_INPUT.into())
}

#[cfg(not(target_os = "macos"))]
pub async fn info(
    _app: &tauri::AppHandle,
    _session: &str,
    _root: &Path,
    _args: &Value,
) -> Result<Value, String> {
    Err("The embedded browser requires macOS.".into())
}

#[cfg(not(target_os = "macos"))]
pub async fn upload(
    _app: &tauri::AppHandle,
    _session: &str,
    _root: &Path,
    _args: &Value,
    _approval: &Value,
) -> Result<Value, String> {
    Err("The embedded browser requires macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zorvo-upload-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn asks_for_one_to_ten_paths() {
        assert!(requested_paths(&json!({})).is_err());
        assert!(requested_paths(&json!({"paths": []})).is_err());
        assert!(requested_paths(&json!({"paths": [""]})).is_err());
        assert!(requested_paths(&json!({"paths": [1]})).is_err());
        let eleven: Vec<String> = (0..11).map(|i| format!("{i}.txt")).collect();
        assert!(requested_paths(&json!({ "paths": eleven })).is_err());
        assert_eq!(
            requested_paths(&json!({"paths": ["a.xls", "b/c.xls"]})).unwrap(),
            vec!["a.xls", "b/c.xls"]
        );
    }

    #[test]
    fn takes_only_files_inside_the_workspace() {
        let root = scratch("root");
        let outside = scratch("outside");
        std::fs::write(root.join("in.txt"), "in").unwrap();
        std::fs::create_dir(root.join("folder")).unwrap();
        std::fs::write(outside.join("secret.txt"), "out").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();

        assert_eq!(
            workspace_file(&root, "in.txt").unwrap(),
            root.join("in.txt")
        );
        let absolute = root.join("in.txt");
        assert!(workspace_file(&root, absolute.to_str().unwrap()).is_ok());
        assert!(workspace_file(&root, "../secret.txt").is_err());
        assert!(workspace_file(&root, outside.join("secret.txt").to_str().unwrap()).is_err());
        assert!(workspace_file(&root, "link.txt").is_err());
        assert!(workspace_file(&root, "folder").is_err());
        assert!(workspace_file(&root, "missing.txt").is_err());
        let error = workspace_file(&root, "../secret.txt").unwrap_err();
        assert!(!error.contains("secret"));
    }

    #[test]
    fn names_the_receiving_origin() {
        assert_eq!(
            origin_of("https://icio.themoonlab.co/import/custodian?x=1").unwrap(),
            "https://icio.themoonlab.co/"
        );
        assert_eq!(
            origin_of("http://127.0.0.1:4310/form").unwrap(),
            "http://127.0.0.1:4310/"
        );
        assert!(origin_of("about:blank").is_err());
        assert!(origin_of("file:///etc/passwd").is_err());
    }

    #[test]
    fn writes_a_frame_origin_the_same_way() {
        assert_eq!(
            frame_origin("https", "icio.themoonlab.co", 0),
            "https://icio.themoonlab.co/"
        );
        assert_eq!(
            frame_origin("https", "example.com", 443),
            "https://example.com/"
        );
        assert_eq!(
            frame_origin("http", "127.0.0.1", 4310),
            "http://127.0.0.1:4310/"
        );
        assert_eq!(frame_origin("http", "::1", 8080), "http://[::1]:8080/");
    }

    #[test]
    fn an_approval_covers_exactly_its_origin_and_files() {
        let files = vec![PathBuf::from("/w/a.xls"), PathBuf::from("/w/b.xls")];
        let approval = approval_for("https://example.com/", &files);
        assert!(matches_approval(&approval, "https://example.com/", &files));
        assert!(!matches_approval(
            &approval,
            "https://evil.example/",
            &files
        ));
        assert!(!matches_approval(
            &approval,
            "https://example.com/",
            &files[..1]
        ));
        let reversed = vec![files[1].clone(), files[0].clone()];
        assert!(!matches_approval(
            &approval,
            "https://example.com/",
            &reversed
        ));
        assert!(!matches_approval(
            &json!({}),
            "https://example.com/",
            &files
        ));
    }

    #[test]
    fn stages_private_copies_within_the_size_cap() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("stage-src");
        let dir = scratch("stage-dir");
        std::fs::write(root.join("a.xls"), "first").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub").join("a.xls"), "second").unwrap();

        let staged = stage(&dir, &[root.join("a.xls"), root.join("sub").join("a.xls")]).unwrap();
        assert_eq!(staged.len(), 2);
        assert_ne!(staged[0], staged[1]);
        assert_eq!(std::fs::read_to_string(&staged[0]).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(&staged[1]).unwrap(), "second");
        assert_eq!(staged[0].file_name().unwrap(), "a.xls");
        let mode = std::fs::metadata(&staged[0]).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);

        let big = root.join("big.bin");
        std::fs::write(&big, vec![0u8; (MAX_BYTES + 1) as usize]).unwrap();
        let before = std::fs::read_dir(&dir).unwrap().count();
        assert!(stage(&dir, &[big]).is_err());
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            before,
            "a refused upload leaves nothing"
        );
    }

    #[test]
    fn sweeps_only_old_upload_folders() {
        let dir = scratch("sweep");
        std::fs::create_dir(dir.join("upload-old")).unwrap();
        std::fs::create_dir(dir.join("keep-me")).unwrap();
        let later = SystemTime::now() + Duration::from_secs(48 * 60 * 60);
        sweep(&dir, later, STAGED_MAX_AGE);
        assert!(!dir.join("upload-old").exists());
        assert!(dir.join("keep-me").exists());

        std::fs::create_dir(dir.join("upload-new")).unwrap();
        sweep(&dir, SystemTime::now(), STAGED_MAX_AGE);
        assert!(dir.join("upload-new").exists());
    }
}
