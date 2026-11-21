//! Exporting canvas artboards as PNG and PDF: which artboards, in what order, and under which
//! names. The drawing is `render.rs`'s; the command and its dialogs are in `commands.rs`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::canvas::{Artboard, Canvas};
use super::commands::clean_file_stem;

pub const COULD_NOT_EXPORT: &str = "Zorvo could not export those artboards.";
pub const COULD_NOT_SAVE: &str = "Zorvo could not save that file.";
const DEFAULT_PDF_NAME: &str = "Canvas";
/// How many numbered names (`<stem> 2.png` …) are tried before giving up.
const MAX_NUMBERED_NAME: u32 = 999;
/// PNGs are drawn at twice the artboard's size (Retina).
const PNG_SCALE: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ExportFormat {
    Png,
    Pdf,
}

impl ExportFormat {
    pub fn parse(format: &str) -> Result<Self, String> {
        match format {
            "png" => Ok(Self::Png),
            "pdf" => Ok(Self::Pdf),
            _ => Err(COULD_NOT_EXPORT.to_string()),
        }
    }
}

/// What an export wrote. `failed` holds the ids of the artboards that could not be drawn.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub written: u32,
    pub failed: Vec<String>,
}

/// One artboard to export, with the stem of its file name.
#[derive(Clone, Debug, PartialEq)]
pub struct ExportBoard {
    pub artboard: Artboard,
    pub stem: String,
}

/// `<section>-<artboard>`; both are ids, which hold only letters, digits, `-` and `_`.
pub fn export_file_stem(section_id: &str, artboard_id: &str) -> String {
    format!("{section_id}-{artboard_id}")
}

/// The whole canvas's PDF: `<canvas title>.pdf`, cleaned like a page's export.
pub fn pdf_file_name(canvas_title: &str) -> String {
    format!("{}.pdf", clean_file_stem(canvas_title, DEFAULT_PDF_NAME))
}

/// How wide an artboard's PNG is drawn, in pixels.
pub fn png_width(width: u32) -> u32 {
    width.saturating_mul(PNG_SCALE)
}

/// The artboards to export, in canvas order whatever order they were asked in: those named by
/// `ids`, or every artboard. Nothing to export is an error.
pub fn export_boards(canvas: &Canvas, ids: Option<&[String]>) -> Result<Vec<ExportBoard>, String> {
    let is_asked = |id: &str| ids.is_none_or(|ids| ids.iter().any(|asked| asked == id));
    let boards: Vec<ExportBoard> = canvas
        .sections
        .iter()
        .flat_map(|section| {
            section.artboards.iter().map(move |artboard| ExportBoard {
                artboard: artboard.clone(),
                stem: export_file_stem(&section.id, &artboard.id),
            })
        })
        .filter(|board| is_asked(&board.artboard.id))
        .collect();
    if boards.is_empty() {
        return Err(COULD_NOT_EXPORT.to_string());
    }
    Ok(boards)
}

/// Leaves out the artboards whose file is missing (`missing`, the ids the canvas read reports without
/// a file hash) and names them, so they are never drawn as a blank page.
pub fn without_missing(
    boards: Vec<ExportBoard>,
    missing: &[String],
) -> (Vec<ExportBoard>, Vec<String>) {
    let (absent, present): (Vec<ExportBoard>, Vec<ExportBoard>) = boards
        .into_iter()
        .partition(|board| missing.contains(&board.artboard.id));
    (
        present,
        absent.into_iter().map(|board| board.artboard.id).collect(),
    )
}

/// Writes `bytes` as `<stem>.<extension>` in `folder`, or `<stem> 2.<extension>` and so on when
/// that name is taken: an existing file, folder or link is never replaced or written through.
pub fn write_new_file(
    folder: &Path,
    stem: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let failed = || COULD_NOT_SAVE.to_string();
    for number in 1..=MAX_NUMBERED_NAME {
        let name = if number == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem} {number}.{extension}")
        };
        let path = folder.join(name);
        // `create_new` is O_CREAT | O_EXCL, which also refuses a link of that name.
        let mut file = match std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(failed()),
        };
        if file.write_all(bytes).is_err() {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(failed());
        }
        return Ok(path);
    }
    Err(failed())
}

/// Splits what was drawn into the artboards to write, in order, and the ids of those that could
/// not be drawn.
pub fn split_drawn(
    drawn: Vec<(ExportBoard, Result<Vec<u8>, String>)>,
) -> (Vec<(ExportBoard, Vec<u8>)>, Vec<String>) {
    let mut ready = Vec::new();
    let mut failed = Vec::new();
    for (board, bytes) in drawn {
        match bytes {
            Ok(bytes) => ready.push((board, bytes)),
            Err(_) => failed.push(board.artboard.id),
        }
    }
    (ready, failed)
}

/// `written` as the outcome counts it.
pub fn count(written: usize) -> u32 {
    u32::try_from(written).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::canvas::parse_canvas;
    use crate::artifacts::test_support::Temp;

    const EXPORT_CANVAS: &str = r#"{"version":1,"title":"Checkout / v2","sections":[
        {"id":"flow","title":"Flow","artboards":[
            {"id":"cart","title":"Cart","file":"cart.html","width":1440,"height":900}]},
        {"id":"pay","title":"Pay","artboards":[
            {"id":"pay-a","title":"Payment A","file":"a.html","width":390,"height":844},
            {"id":"pay-b","title":"Payment B","file":"b.html","width":800,"height":600}]}]}"#;

    fn ids(boards: &[ExportBoard]) -> Vec<&str> {
        boards
            .iter()
            .map(|board| board.artboard.id.as_str())
            .collect()
    }

    #[test]
    fn export_names_files_by_section_and_artboard() {
        assert_eq!(export_file_stem("flow", "cart"), "flow-cart");
        let canvas = parse_canvas(EXPORT_CANVAS.as_bytes()).unwrap();
        let boards = export_boards(&canvas, Some(&["pay-b".to_string()])).unwrap();
        assert_eq!(boards[0].stem, "pay-pay-b");
        assert_eq!(pdf_file_name("Checkout / v2"), "Checkout v2.pdf");
        assert_eq!(pdf_file_name("…"), "Canvas.pdf");
    }

    #[test]
    fn an_artboard_with_a_missing_file_is_not_drawn_and_is_named() {
        let canvas = parse_canvas(EXPORT_CANVAS.as_bytes()).unwrap();
        let boards = export_boards(&canvas, None).unwrap();

        let (present, absent) =
            without_missing(boards, &["pay-a".to_string(), "other".to_string()]);

        assert_eq!(ids(&present), ["cart", "pay-b"]);
        assert_eq!(absent, ["pay-a"]);
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let folder = Temp::new("export");
        std::fs::write(folder.0.join("flow-cart.png"), b"old").unwrap();

        let written = write_new_file(&folder.0, "flow-cart", "png", b"new").unwrap();
        assert_eq!(written, folder.0.join("flow-cart 2.png"));
        let again = write_new_file(&folder.0, "flow-cart", "png", b"newer").unwrap();
        assert_eq!(again, folder.0.join("flow-cart 3.png"));
        assert_eq!(
            std::fs::read(folder.0.join("flow-cart.png")).unwrap(),
            b"old"
        );
        assert_eq!(std::fs::read(&written).unwrap(), b"new");
        // A link of that name is a taken name too: it is never written through.
        std::os::unix::fs::symlink(folder.0.join("elsewhere"), folder.0.join("flow-pay.png"))
            .unwrap();
        let beside = write_new_file(&folder.0, "flow-pay", "png", b"x").unwrap();
        assert_eq!(beside, folder.0.join("flow-pay 2.png"));
        assert!(!folder.0.join("elsewhere").exists());
    }

    #[test]
    fn export_keeps_canvas_order_for_pdf_pages() {
        let canvas = parse_canvas(EXPORT_CANVAS.as_bytes()).unwrap();
        let asked = ["pay-b".to_string(), "cart".to_string()];
        assert_eq!(
            ids(&export_boards(&canvas, Some(&asked)).unwrap()),
            ["cart", "pay-b"]
        );
        assert_eq!(
            ids(&export_boards(&canvas, None).unwrap()),
            ["cart", "pay-a", "pay-b"]
        );
        // An id the canvas does not have exports nothing.
        assert!(export_boards(&canvas, Some(&["gone".to_string()])).is_err());
        assert!(export_boards(&canvas, Some(&[])).is_err());
    }

    #[test]
    fn what_could_not_be_drawn_is_named_and_the_rest_keeps_its_order() {
        let canvas = parse_canvas(EXPORT_CANVAS.as_bytes()).unwrap();
        let boards = export_boards(&canvas, None).unwrap();
        let drawn = boards
            .into_iter()
            .map(|board| {
                let bytes = if board.artboard.id == "pay-a" {
                    Err("no".to_string())
                } else {
                    Ok(board.artboard.id.clone().into_bytes())
                };
                (board, bytes)
            })
            .collect();

        let (ready, failed) = split_drawn(drawn);
        let ready: Vec<&[u8]> = ready.iter().map(|(_, bytes)| bytes.as_slice()).collect();
        assert_eq!(ready, [b"cart".as_slice(), b"pay-b".as_slice()]);
        assert_eq!(failed, ["pay-a"]);
    }

    #[test]
    fn export_formats_are_png_and_pdf_only() {
        assert_eq!(ExportFormat::parse("png"), Ok(ExportFormat::Png));
        assert_eq!(ExportFormat::parse("pdf"), Ok(ExportFormat::Pdf));
        assert!(ExportFormat::parse("html").is_err());
        // PNG is drawn at twice the artboard's width.
        assert_eq!(png_width(1440), 2880);
    }
}
