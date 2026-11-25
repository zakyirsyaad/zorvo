//! The pixel work of a motion render that needs no WebKit: when each sub-frame is taken, how
//! sub-frames are averaged into one blurred frame, and the stills and contact sheet an agent reads.

use image::codecs::jpeg::JpegEncoder;
use image::{imageops, ImageBuffer, ImageFormat, Rgba, RgbaImage};

/// How many snapshots make one frame: motion blur is always on.
pub const BLUR_SAMPLES: u32 = 4;
/// The share of a frame's interval the samples are spread over: a 180° shutter.
pub const SHUTTER: f64 = 0.5;
/// The contact sheet's widest side, and the width of one cell in it.
pub const SHEET_MAX_WIDTH: u32 = 1920;
const SHEET_CELL_WIDTH: u32 = 480;
const SHEET_GAP: u32 = 8;
const SHEET_JPEG_QUALITY: u8 = 80;

/// The times, in seconds, of the snapshots that make the frame starting at `frame_start`: spread
/// evenly over the shutter, each in the middle of its slice.
pub fn sample_times(frame_start: f64, fps: u32) -> Vec<f64> {
    let interval = 1.0 / f64::from(fps);
    (0..BLUR_SAMPLES)
        .map(|sample| {
            frame_start + (f64::from(sample) + 0.5) / f64::from(BLUR_SAMPLES) * SHUTTER * interval
        })
        .collect()
}

/// Running sums of RGBA snapshots of one size, averaged into one frame.
pub struct Accumulator {
    sums: Vec<u16>,
    count: u16,
}

impl Accumulator {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            sums: vec![0; width as usize * height as usize * 4],
            count: 0,
        }
    }

    /// Adds one RGBA snapshot. A snapshot of another size is refused.
    pub fn add(&mut self, rgba: &[u8]) -> Result<(), ()> {
        if rgba.len() != self.sums.len() {
            return Err(());
        }
        for (sum, value) in self.sums.iter_mut().zip(rgba) {
            *sum += u16::from(*value);
        }
        self.count += 1;
        Ok(())
    }

    /// The average of what was added, as RGBA, and the sums emptied for the next frame.
    pub fn take(&mut self) -> Vec<u8> {
        let count = self.count.max(1);
        let half = count / 2;
        let frame = self
            .sums
            .iter()
            .map(|sum| ((sum + half) / count) as u8)
            .collect();
        self.sums.iter_mut().for_each(|sum| *sum = 0);
        self.count = 0;
        frame
    }
}

/// RGBA bytes as BGRA, the pixel format the video encoder takes.
pub fn rgba_to_bgra(rgba: &[u8], bgra: &mut [u8]) {
    for (from, to) in rgba.chunks_exact(4).zip(bgra.chunks_exact_mut(4)) {
        to[0] = from[2];
        to[1] = from[1];
        to[2] = from[0];
        to[3] = from[3];
    }
}

fn image_of(rgba: Vec<u8>, width: u32, height: u32) -> Option<RgbaImage> {
    ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba)
}

/// A PNG of an RGBA frame.
pub fn png_of(rgba: Vec<u8>, width: u32, height: u32) -> Option<Vec<u8>> {
    let image = image_of(rgba, width, height)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// One still for the contact sheet: its frame and the row (format) it belongs to.
pub struct SheetCell {
    pub row: usize,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Where each cell goes: a row per format, cells left to right, each scaled to one width.
/// Returns the sheet's size and each cell's position and size, in the order given.
pub fn sheet_layout(cells: &[(usize, u32, u32)]) -> (u32, u32, Vec<(u32, u32, u32, u32)>) {
    let rows = cells.iter().map(|(row, _, _)| row + 1).max().unwrap_or(0);
    let per_row = |row: usize| cells.iter().filter(|(r, _, _)| *r == row).count() as u32;
    let widest = (0..rows).map(per_row).max().unwrap_or(1).max(1);
    let cell_width = SHEET_CELL_WIDTH.min((SHEET_MAX_WIDTH - SHEET_GAP * (widest - 1)) / widest);
    let mut placed = Vec::with_capacity(cells.len());
    let mut row_tops = vec![0u32; rows];
    let mut top = 0;
    for (row, slot) in row_tops.iter_mut().enumerate() {
        *slot = top;
        let tallest = cells
            .iter()
            .filter(|(r, _, _)| *r == row)
            .map(|(_, w, h)| scaled_height(*w, *h, cell_width))
            .max()
            .unwrap_or(0);
        top += tallest + SHEET_GAP;
    }
    let mut next_in_row = vec![0u32; rows];
    for (row, width, height) in cells {
        let x = next_in_row[*row] * (cell_width + SHEET_GAP);
        next_in_row[*row] += 1;
        placed.push((x, row_tops[*row], cell_width, scaled_height(*width, *height, cell_width)));
    }
    let sheet_width = widest * cell_width + SHEET_GAP * (widest - 1);
    let sheet_height = top.saturating_sub(SHEET_GAP).max(1);
    (sheet_width, sheet_height, placed)
}

fn scaled_height(width: u32, height: u32, to_width: u32) -> u32 {
    ((u64::from(height) * u64::from(to_width)) / u64::from(width.max(1))).max(1) as u32
}

/// The contact sheet of `cells` as a JPEG.
pub fn contact_sheet(cells: Vec<SheetCell>) -> Option<Vec<u8>> {
    let shape: Vec<(usize, u32, u32)> = cells.iter().map(|c| (c.row, c.width, c.height)).collect();
    let (width, height, placed) = sheet_layout(&shape);
    let mut sheet = RgbaImage::from_pixel(width, height, Rgba([24, 24, 27, 255]));
    for (cell, (x, y, w, h)) in cells.into_iter().zip(placed) {
        let image = image_of(cell.rgba, cell.width, cell.height)?;
        let small = imageops::resize(&image, w, h, imageops::FilterType::Triangle);
        imageops::overlay(&mut sheet, &small, i64::from(x), i64::from(y));
    }
    let rgb = image::DynamicImage::ImageRgba8(sheet).to_rgb8();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, SHEET_JPEG_QUALITY)
        .encode_image(&rgb)
        .ok()?;
    Some(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_spread_over_half_a_frame() {
        let times = sample_times(1.0, 50);
        assert_eq!(times.len(), 4);
        assert!((times[0] - 1.00125).abs() < 1e-9);
        assert!((times[3] - 1.00875).abs() < 1e-9);
        assert!(times.iter().all(|t| *t < 1.0 + 0.5 / 50.0));
    }

    #[test]
    fn averages_samples_and_starts_again() {
        let mut acc = Accumulator::new(1, 1);
        acc.add(&[0, 100, 255, 255]).expect("first");
        acc.add(&[255, 100, 0, 255]).expect("second");
        assert_eq!(acc.take(), vec![128, 100, 128, 255]);
        acc.add(&[10, 20, 30, 40]).expect("next frame");
        assert_eq!(acc.take(), vec![10, 20, 30, 40]);
        assert!(acc.add(&[1, 2, 3]).is_err());
    }

    #[test]
    fn swaps_red_and_blue() {
        let mut out = [0u8; 4];
        rgba_to_bgra(&[1, 2, 3, 4], &mut out);
        assert_eq!(out, [3, 2, 1, 4]);
    }

    #[test]
    fn lays_out_a_row_per_format() {
        let (width, height, placed) =
            sheet_layout(&[(0, 1920, 1080), (0, 1920, 1080), (1, 1080, 1920)]);
        assert_eq!(placed[0], (0, 0, 480, 270));
        assert_eq!(placed[1], (488, 0, 480, 270));
        assert_eq!(placed[2], (0, 278, 480, 853));
        assert_eq!((width, height), (968, 278 + 853));
    }

    #[test]
    fn keeps_a_wide_sheet_within_its_limit() {
        let cells: Vec<_> = (0..12).map(|_| (0, 1920, 1080)).collect();
        let (width, _, _) = sheet_layout(&cells);
        assert!(width <= SHEET_MAX_WIDTH);
    }

    #[test]
    fn draws_a_sheet_and_a_png() {
        let cell = |row| SheetCell {
            row,
            rgba: vec![200; 8 * 4 * 4],
            width: 8,
            height: 4,
        };
        let jpeg = contact_sheet(vec![cell(0), cell(1)]).expect("sheet");
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        let png = png_of(vec![0; 2 * 2 * 4], 2, 2).expect("png");
        assert!(png.starts_with(b"\x89PNG"));
    }
}
