//! Turns a user prompt and its attached files into ACP content blocks.

use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Value};

/// Images above this size are linked instead of inlined, to keep prompts small.
pub const MAX_INLINE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// A `resource_link`, which every ACP agent must accept.
fn resource_link(path: &Path) -> Result<Value, String> {
    let uri = url::Url::from_file_path(path)
        .map_err(|_| format!("Cannot attach {}: not an absolute path", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!({ "type": "resource_link", "uri": uri.as_str(), "name": name }))
}

fn attachment_block(raw: &str, supports_images: bool) -> Result<Value, String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(format!("Cannot attach {}: not an absolute path", raw));
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot attach {}: {}", raw, e))?;
    if !metadata.is_file() {
        return Err(format!("Cannot attach {}: not a file", raw));
    }
    match image_mime_type(path) {
        Some(mime_type) if supports_images && metadata.len() <= MAX_INLINE_IMAGE_BYTES => {
            let bytes = std::fs::read(path).map_err(|e| format!("Cannot attach {}: {}", raw, e))?;
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(json!({ "type": "image", "mimeType": mime_type, "data": data }))
        }
        _ => resource_link(path),
    }
}

/// Whether `path` lies inside `folder`, both resolved; a path that cannot be
/// resolved counts as outside, so it is named rather than lost.
fn is_inside(path: &Path, folder: &Path) -> bool {
    match (path.canonicalize(), folder.canonicalize()) {
        (Ok(path), Ok(folder)) => path.starts_with(folder),
        _ => false,
    }
}

/// A path as one line of text: control characters (a newline in a file
/// name) become visible escapes, so a name cannot add lines to the prompt.
fn visible_path(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_control() {
                c.escape_unicode().to_string()
            } else {
                c.to_string()
            }
        })
        .collect()
}

/// The note that names linked files outside the session's folder. Some agents
/// read a `resource_link` only inside their workspace and drop any other
/// without a word (Qwen Code does), so the agent would never learn the file
/// was attached; with its path it can read the file with its own tools.
fn outside_files_note(paths: &[&String]) -> Value {
    let lines: Vec<String> = paths
        .iter()
        .map(|path| format!("- {}", visible_path(path)))
        .collect();
    json!({
        "type": "text",
        "text": format!(
            "Attached files outside the working folder (read them from these paths):\n{}",
            lines.join("\n")
        ),
    })
}

/// The prompt's text, then one block per attachment: an inline image when
/// the agent takes images and the file is small enough, a file link otherwise.
/// Linked files outside `cwd` are also named in a last text block.
pub fn prompt_blocks(
    text: &str,
    attachments: &[String],
    supports_images: bool,
    cwd: &Path,
) -> Result<Vec<Value>, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    let mut outside = Vec::new();
    for attachment in attachments {
        let block = attachment_block(attachment, supports_images)?;
        if block["type"] == "resource_link" && !is_inside(Path::new(attachment), cwd) {
            outside.push(attachment);
        }
        blocks.push(block);
    }
    if !outside.is_empty() {
        blocks.push(outside_files_note(&outside));
    }
    Ok(blocks)
}
