//! A motion composition: a folder in the session's folder holding `motion.json`, one page that
//! moves and its files. Zorvo serves it to the preview and renders it to MP4; it keeps no copy.
//! Design: `docs/superpowers/specs/2026-11-25-motion-design.md`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::canvas::{canvas_file, digest_where, is_id, only_known, Fields, MAX_DIGEST_ENTRIES};
use super::source::{read_checked, MAX_PATH_CHARS};
use super::store::clean_title_within;

pub const MOTION_FILE: &str = "motion.json";
/// The folder inside a composition Zorvo writes to, and the only one.
pub const OUT_DIR: &str = "out";
pub const NOT_A_MOTION: &str = "The motion must be a folder with a motion.json inside this folder.";
pub const MAX_MOTION_JSON_BYTES: usize = 64 * 1024;
pub const MIN_DURATION: f64 = 0.5;
pub const MAX_DURATION: f64 = 180.0;
pub const FPS_CHOICES: [u32; 5] = [24, 25, 30, 50, 60];
pub const DEFAULT_FPS: u32 = 60;
pub const MAX_FORMATS: usize = 4;
pub const MIN_SIDE: u64 = 240;
pub const MAX_SIDE: u64 = 3840;
pub const MAX_TRACKS: usize = 32;
pub const MAX_TITLE_CHARS: usize = 120;
const AUDIO_EXTENSIONS: [&str; 4] = ["mp3", "wav", "m4a", "aac"];
const PAGE_EXTENSIONS: [&str; 2] = ["html", "htm"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Motion {
    pub title: String,
    pub page: String,
    pub duration: f64,
    pub fps: u32,
    pub formats: Vec<MotionFormat>,
    pub audio: Vec<AudioTrack>,
    pub poster: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionFormat {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub file: String,
    pub start: f64,
    pub volume: f64,
}

impl Motion {
    pub fn format(&self, id: &str) -> Option<&MotionFormat> {
        self.formats.iter().find(|format| format.id == id)
    }

    /// How many frames the video has: the duration rounded to whole frames.
    pub fn frame_count(&self) -> u32 {
        ((self.duration * f64::from(self.fps)).round() as u32).max(1)
    }
}

/// A composition folder: its canonical path, and its path relative to the session's folder.
#[derive(Clone, Debug, PartialEq)]
pub struct MotionFolder {
    pub root: PathBuf,
    pub relative: String,
}

/// Finds the composition the agent names (its folder or its `motion.json`). Only a folder inside
/// the session's folder counts, never a temporary one, and a refusal never repeats the path.
pub fn resolve_motion(session_folder: &Path, path: &str) -> Result<MotionFolder, String> {
    let refused = || NOT_A_MOTION.to_string();
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
        return Err(refused());
    }
    let session = fs::canonicalize(session_folder).map_err(|_| refused())?;
    let mut root = fs::canonicalize(session.join(path)).map_err(|_| refused())?;
    if root.is_file() && root.file_name().is_some_and(|name| name == MOTION_FILE) {
        root.pop();
    }
    let relative = root.strip_prefix(&session).map_err(|_| refused())?;
    if !root.is_dir() || !root.join(MOTION_FILE).is_file() {
        return Err(refused());
    }
    let relative = relative
        .components()
        .map(|part| part.as_os_str().to_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(refused)?
        .join("/");
    Ok(MotionFolder { root, relative })
}

pub fn read_motion(root: &Path) -> Result<Motion, String> {
    parse_motion(&read_checked(&root.join(MOTION_FILE))?)
}

/// A relative file inside the folder with one of `extensions`. Only the text is judged here.
fn is_relative_file_with(file: &str, extensions: &[&str]) -> bool {
    let lower = file.to_ascii_lowercase();
    let has_extension = extensions
        .iter()
        .any(|extension| lower.ends_with(&format!(".{extension}")));
    has_extension
        && !file.starts_with('/')
        && !file.chars().any(|c| c.is_control() || c == '\\')
        && file
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && !file
            .split('/')
            .next()
            .is_some_and(|first| first.eq_ignore_ascii_case(OUT_DIR))
}

fn number(fields: &Fields, name: &str, path: &str) -> Result<Option<f64>, String> {
    match fields.get(name) {
        None => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|n| n.is_finite())
            .map(Some)
            .ok_or_else(|| format!("{path}{name}: must be a number")),
    }
}

fn whole(fields: &Fields, name: &str, path: &str) -> Result<u64, String> {
    fields
        .get(name)
        .ok_or_else(|| format!("{path}{name}: is required"))?
        .as_u64()
        .ok_or_else(|| format!("{path}{name}: must be a whole number"))
}

fn format_at(
    item: &serde_json::Value,
    index: usize,
    seen: &mut Vec<String>,
) -> Result<MotionFormat, String> {
    let path = format!("formats[{index}].");
    let fields = item
        .as_object()
        .ok_or_else(|| format!("formats[{index}]: must be an object"))?;
    only_known(
        fields,
        &["id", "width", "height"],
        &format!("formats[{index}]"),
    )?;
    let id = fields
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| is_id(id))
        .ok_or_else(|| format!("{path}id: must be 1 to 64 characters of a-z, 0-9 and -"))?;
    if seen.iter().any(|other| other == id) {
        return Err(format!("{path}id: is used twice"));
    }
    seen.push(id.to_string());
    let side = |name: &str| -> Result<u32, String> {
        let value = whole(fields, name, &path)?;
        if !(MIN_SIDE..=MAX_SIDE).contains(&value) {
            return Err(format!("{path}{name}: must be {MIN_SIDE} to {MAX_SIDE}"));
        }
        if value % 2 != 0 {
            return Err(format!("{path}{name}: must be even"));
        }
        Ok(value as u32)
    };
    Ok(MotionFormat {
        id: id.to_string(),
        width: side("width")?,
        height: side("height")?,
    })
}

fn track_at(item: &serde_json::Value, index: usize, duration: f64) -> Result<AudioTrack, String> {
    let path = format!("audio[{index}].");
    let fields = item
        .as_object()
        .ok_or_else(|| format!("audio[{index}]: must be an object"))?;
    only_known(
        fields,
        &["file", "start", "volume"],
        &format!("audio[{index}]"),
    )?;
    let file = fields
        .get("file")
        .and_then(serde_json::Value::as_str)
        .filter(|file| is_relative_file_with(file, &AUDIO_EXTENSIONS))
        .ok_or_else(|| {
            format!("{path}file: must be a relative .mp3, .wav, .m4a or .aac file in the folder")
        })?;
    let start = number(fields, "start", &path)?.unwrap_or(0.0);
    if !(0.0..duration).contains(&start) {
        return Err(format!("{path}start: must be from 0 to below the duration"));
    }
    let volume = number(fields, "volume", &path)?.unwrap_or(1.0);
    if !(0.0..=1.0).contains(&volume) {
        return Err(format!("{path}volume: must be 0 to 1"));
    }
    Ok(AudioTrack {
        file: file.to_string(),
        start,
        volume,
    })
}

/// Reads `motion.json`. Every refusal names the field that is wrong and the rule it broke, and
/// never repeats a value from the file.
pub fn parse_motion(bytes: &[u8]) -> Result<Motion, String> {
    if bytes.len() > MAX_MOTION_JSON_BYTES {
        return Err("motion.json: over 64 KB".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "motion.json: not valid UTF-8")?;
    let value: serde_json::Value =
        serde_json::from_str(source).map_err(|_| "motion.json: not valid JSON")?;
    let root = value
        .as_object()
        .ok_or("motion.json: must be a JSON object")?;
    if root.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("version: must be 1".into());
    }
    only_known(
        root,
        &[
            "version", "title", "page", "duration", "fps", "formats", "audio", "poster",
        ],
        "",
    )?;
    let title = root
        .get("title")
        .ok_or("title: is required")?
        .as_str()
        .ok_or("title: must be a string")?;
    let title =
        clean_title_within(title, MAX_TITLE_CHARS).ok_or("title: must hold visible text")?;
    let page = match root.get("page") {
        None => "index.html",
        Some(value) => value
            .as_str()
            .filter(|page| is_relative_file_with(page, &PAGE_EXTENSIONS))
            .ok_or("page: must be a relative .html file in the folder")?,
    };
    let duration = number(root, "duration", "")?.ok_or("duration: is required")?;
    if !(MIN_DURATION..=MAX_DURATION).contains(&duration) {
        return Err(format!(
            "duration: must be {MIN_DURATION} to {MAX_DURATION} seconds"
        ));
    }
    let fps = match root.get("fps") {
        None => DEFAULT_FPS,
        Some(value) => value
            .as_u64()
            .and_then(|fps| u32::try_from(fps).ok())
            .filter(|fps| FPS_CHOICES.contains(fps))
            .ok_or("fps: must be 24, 25, 30, 50 or 60")?,
    };
    let list = root
        .get("formats")
        .ok_or("formats: is required")?
        .as_array()
        .ok_or("formats: must be a list")?;
    if list.is_empty() || list.len() > MAX_FORMATS {
        return Err(format!("formats: must hold 1 to {MAX_FORMATS} formats"));
    }
    let mut seen = Vec::new();
    let formats = list
        .iter()
        .enumerate()
        .map(|(index, item)| format_at(item, index, &mut seen))
        .collect::<Result<Vec<_>, _>>()?;
    let audio = match root.get("audio") {
        None => Vec::new(),
        Some(value) => {
            let list = value.as_array().ok_or("audio: must be a list")?;
            if list.len() > MAX_TRACKS {
                return Err(format!("audio: must hold at most {MAX_TRACKS} tracks"));
            }
            list.iter()
                .enumerate()
                .map(|(index, item)| track_at(item, index, duration))
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    let poster = number(root, "poster", "")?.unwrap_or(duration / 3.0);
    if !(0.0..=duration).contains(&poster) {
        return Err("poster: must be within the duration".into());
    }
    Ok(Motion {
        title,
        page: page.to_string(),
        duration,
        fps,
        formats,
        audio,
        poster,
    })
}

fn hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Whether a file of the folder counts toward what a render is made from: everything servable
/// but Zorvo's own `out/`.
fn is_input(relative: &str) -> bool {
    relative != format!("{OUT_DIR}/") && !relative.starts_with(&format!("{OUT_DIR}/"))
}

/// What a rendered format is keyed by: `motion.json`, a digest of the folder's other servable
/// files (paths, sizes and modification times, `out/` left out) and the format's id and size. A
/// rendered file whose recorded key still matches is up to date.
pub fn render_key(root: &Path, format: &MotionFormat) -> Option<String> {
    let spec = read_checked(&root.join(MOTION_FILE)).ok()?;
    let folder = digest_where(root, MAX_DIGEST_ENTRIES, &is_input);
    Some(hex(Sha256::digest(format!(
        "{}\0{folder}\0{}\0{}x{}",
        hex(Sha256::digest(&spec)),
        format.id,
        format.width,
        format.height
    ))))
}

/// A file of the composition the preview or a render may load: its canonical path inside `root`
/// and the type it is served as.
pub fn motion_file(root: &Path, relative: &str) -> Option<(PathBuf, &'static str)> {
    canvas_file(root, relative)
}

/// The rendered file of a format.
pub fn out_file(root: &Path, format_id: &str) -> PathBuf {
    root.join(OUT_DIR).join(format!("{format_id}.mp4"))
}

/// `out/` inside `root`, made when missing. A link or anything but a folder there is refused, so
/// Zorvo never writes through it to another place.
pub fn out_dir(root: &Path) -> Result<PathBuf, String> {
    let out = root.join(OUT_DIR);
    match fs::symlink_metadata(&out) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err(OUT_NOT_A_FOLDER.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&out).map_err(|_| OUT_NOT_A_FOLDER.to_string())?;
        }
        Err(_) => return Err(OUT_NOT_A_FOLDER.to_string()),
    }
    Ok(out)
}

pub const OUT_NOT_A_FOLDER: &str =
    "Zorvo writes renders to the out folder, and out is not a folder.";

/// `out/frames/` for stills, made like `out/`.
pub fn frames_dir(root: &Path) -> Result<PathBuf, String> {
    let frames = out_dir(root)?.join("frames");
    match fs::symlink_metadata(&frames) {
        Ok(meta) if meta.is_dir() => Ok(frames),
        Ok(_) => Err(OUT_NOT_A_FOLDER.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&frames)
            .map(|()| frames)
            .map_err(|_| OUT_NOT_A_FOLDER.to_string()),
        Err(_) => Err(OUT_NOT_A_FOLDER.to_string()),
    }
}

/// The file name of a still: the format and the time in hundredths, so names sort by time.
pub fn still_name(format_id: &str, seconds: f64) -> String {
    let hundredths = (seconds * 100.0).round() as u64;
    format!(
        "{format_id}-{:03}.{:02}.png",
        hundredths / 100,
        hundredths % 100
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    const SPEC: &str = r#"{
      "version": 1, "title": "Compare in 15 seconds", "page": "index.html",
      "duration": 15, "fps": 60,
      "formats": [
        { "id": "wide", "width": 1920, "height": 1080 },
        { "id": "tall", "width": 1080, "height": 1920 }
      ],
      "audio": [
        { "file": "audio/bed.mp3", "start": 0, "volume": 0.8 },
        { "file": "audio/whoosh.wav", "start": 2 }
      ],
      "poster": 4.5
    }"#;

    fn err(json: &str) -> String {
        parse_motion(json.as_bytes()).expect_err("should be refused")
    }

    fn minimal(extra: &str) -> String {
        format!(
            r#"{{"version":1,"title":"T","duration":2,"formats":[{{"id":"wide","width":640,"height":360}}]{extra}}}"#
        )
    }

    #[test]
    fn parses_the_spec_example() {
        let motion = parse_motion(SPEC.as_bytes()).expect("spec example parses");
        assert_eq!(motion.title, "Compare in 15 seconds");
        assert_eq!(motion.formats.len(), 2);
        assert_eq!(
            motion.format("tall").map(|f| (f.width, f.height)),
            Some((1080, 1920))
        );
        assert_eq!(motion.audio[1].volume, 1.0);
        assert_eq!(motion.frame_count(), 900);
        assert_eq!(motion.poster, 4.5);
    }

    #[test]
    fn fills_defaults() {
        let motion = parse_motion(minimal("").as_bytes()).expect("parses");
        assert_eq!(motion.page, "index.html");
        assert_eq!(motion.fps, 60);
        assert!(motion.audio.is_empty());
        assert!((motion.poster - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn refuses_odd_and_out_of_range_sizes() {
        assert_eq!(
            err(
                r#"{"version":1,"title":"T","duration":2,"formats":[{"id":"a","width":641,"height":360}]}"#
            ),
            "formats[0].width: must be even"
        );
        assert!(err(r#"{"version":1,"title":"T","duration":2,"formats":[{"id":"a","width":4000,"height":360}]}"#)
            .starts_with("formats[0].width: must be 240"));
    }

    #[test]
    fn refuses_a_format_id_used_twice() {
        let json = r#"{"version":1,"title":"T","duration":2,"formats":[
            {"id":"a","width":640,"height":360},{"id":"a","width":360,"height":640}]}"#;
        assert_eq!(err(json), "formats[1].id: is used twice");
    }

    #[test]
    fn refuses_bad_timing() {
        assert!(
            err(&minimal("").replace("\"duration\":2", "\"duration\":200"))
                .starts_with("duration:")
        );
        assert_eq!(
            err(&minimal(r#","fps":29"#)),
            "fps: must be 24, 25, 30, 50 or 60"
        );
        assert_eq!(
            err(&minimal(r#","poster":9"#)),
            "poster: must be within the duration"
        );
    }

    #[test]
    fn refuses_audio_outside_the_folder_or_the_duration() {
        assert!(err(&minimal(r#","audio":[{"file":"../bed.mp3"}]"#)).starts_with("audio[0].file:"));
        assert!(err(&minimal(r#","audio":[{"file":"out/bed.mp3"}]"#)).starts_with("audio[0].file:"));
        assert!(err(&minimal(r#","audio":[{"file":"bed.ogg"}]"#)).starts_with("audio[0].file:"));
        assert_eq!(
            err(&minimal(r#","audio":[{"file":"bed.mp3","start":2}]"#)),
            "audio[0].start: must be from 0 to below the duration"
        );
        assert_eq!(
            err(&minimal(r#","audio":[{"file":"bed.mp3","volume":1.5}]"#)),
            "audio[0].volume: must be 0 to 1"
        );
    }

    #[test]
    fn refuses_unknown_fields_without_repeating_long_ones() {
        assert!(err(&minimal(r#","loop":true"#)).contains("loop"));
        let long = "x".repeat(60);
        assert!(!err(&minimal(&format!(r#","{long}":1"#))).contains(&long));
    }

    #[test]
    fn refuses_a_page_that_is_not_html() {
        assert_eq!(
            err(&minimal(r#","page":"index.js""#)),
            "page: must be a relative .html file in the folder"
        );
    }

    #[test]
    fn resolves_the_folder_or_its_file_and_nothing_outside() {
        let session = Temp::new("motion-resolve");
        let folder = session.0.join("promo");
        fs::create_dir_all(&folder).expect("folder");
        fs::write(folder.join(MOTION_FILE), minimal("")).expect("spec");
        let by_folder = resolve_motion(&session.0, "promo").expect("folder");
        let by_file = resolve_motion(&session.0, "promo/motion.json").expect("file");
        assert_eq!(by_folder, by_file);
        assert_eq!(by_folder.relative, "promo");
        assert_eq!(resolve_motion(&session.0, "..").unwrap_err(), NOT_A_MOTION);
        assert_eq!(
            resolve_motion(&session.0, "missing").unwrap_err(),
            NOT_A_MOTION
        );
    }

    #[test]
    fn render_key_follows_inputs_but_not_out() {
        let root = Temp::new("motion-key");
        fs::write(root.0.join(MOTION_FILE), minimal("")).expect("spec");
        fs::write(root.0.join("index.html"), "<p>one</p>").expect("page");
        let format = parse_motion(minimal("").as_bytes())
            .expect("parses")
            .formats[0]
            .clone();
        let first = render_key(&root.0, &format).expect("key");
        let out = out_dir(&root.0).expect("out");
        fs::write(out.join("wide.mp4"), b"video").expect("render");
        assert_eq!(render_key(&root.0, &format), Some(first.clone()));
        fs::write(root.0.join("index.html"), "<p>two, longer</p>").expect("page");
        assert_ne!(render_key(&root.0, &format), Some(first));
    }

    #[test]
    fn refuses_an_out_that_is_a_link() {
        let root = Temp::new("motion-out-link");
        let elsewhere = Temp::new("motion-out-elsewhere");
        std::os::unix::fs::symlink(&elsewhere.0, root.0.join(OUT_DIR)).expect("link");
        assert_eq!(out_dir(&root.0).unwrap_err(), OUT_NOT_A_FOLDER);
    }

    #[test]
    fn names_stills_by_format_and_time() {
        assert_eq!(still_name("wide", 4.5), "wide-004.50.png");
        assert_eq!(still_name("tall", 0.0), "tall-000.00.png");
    }
}
