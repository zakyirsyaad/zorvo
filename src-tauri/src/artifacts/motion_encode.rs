//! Writes a motion render with AVFoundation: frames to H.264 in an MP4, then, when the motion has
//! audio, its tracks mixed to AAC and joined with the video. Everything here runs on the render's
//! own thread; nothing touches the main thread. Every object lives and dies on that thread.

use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetExportPresetAppleM4A, AVAssetExportPresetPassthrough, AVAssetExportSession,
    AVAssetExportSessionStatus, AVAssetTrack, AVAssetWriter, AVAssetWriterInput,
    AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus, AVAudioMixInputParameters,
    AVFileTypeAppleM4A, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVMutableAudioMix,
    AVMutableAudioMixInputParameters, AVMutableComposition, AVURLAsset, AVVideoAverageBitRateKey,
    AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey,
    AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey, AVVideoWidthKey,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{kCMPersistentTrackID_Invalid, kCMTimeZero, CMTime, CMTimeRange};
use objc2_core_video::{
    kCVPixelBufferHeightKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey,
    kCVPixelFormatType_32BGRA, CVPixelBuffer, CVPixelBufferGetBaseAddress,
    CVPixelBufferGetBytesPerRow, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferPool, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};

use super::motion_pixels::rgba_to_bgra;

pub const ENCODE_FAILED: &str = "Zorvo could not write the video.";
/// About 0.12 bits per pixel per frame: 1080p at 60 fps is near 15 Mbit/s.
const BITS_PER_PIXEL_FRAME: f64 = 0.12;
/// How long one export step (the audio mix, the join) may take before it is given up.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(600);
const AUDIO_TIMESCALE: i32 = 48_000;

fn failed() -> String {
    ENCODE_FAILED.to_string()
}

fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

/// A CoreFoundation string as the `NSString` it is toll-free bridged to.
fn bridged(key: &objc2_core_foundation::CFString) -> &NSString {
    // SAFETY: CFString and NSString are toll-free bridged: the same object under two names.
    unsafe { &*(key as *const objc2_core_foundation::CFString as *const NSString) }
}

fn dictionary(entries: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = entries.iter().map(|(key, _)| *key).collect();
    let values: Vec<&AnyObject> = entries.iter().map(|(_, value)| *value).collect();
    NSDictionary::from_slices(&keys, &values)
}

/// An H.264 MP4 being written, one frame at a time.
pub struct VideoWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    width: u32,
    height: u32,
    fps: u32,
}

impl VideoWriter {
    /// Starts writing `path`, which must not exist yet.
    pub fn new(path: &Path, width: u32, height: u32, fps: u32) -> Result<Self, String> {
        let bit_rate = f64::from(width) * f64::from(height) * f64::from(fps) * BITS_PER_PIXEL_FRAME;
        // SAFETY: AVFoundation's writer, input and adaptor are made, configured and used on this
        // thread only. The dictionaries hold the documented keys with values of the documented
        // types (NSString codec, NSNumber sizes and rates, a nested NSDictionary).
        unsafe {
            let file_type = AVFileTypeMPEG4.ok_or_else(failed)?;
            let writer =
                AVAssetWriter::assetWriterWithURL_fileType_error(&file_url(path), file_type)
                    .map_err(|_| failed())?;
            writer.setShouldOptimizeForNetworkUse(true);
            let rate = NSNumber::new_f64(bit_rate.round());
            let frame_rate = NSNumber::new_u32(fps);
            let compression = dictionary(&[
                (AVVideoAverageBitRateKey.ok_or_else(failed)?, rate.as_ref()),
                (
                    AVVideoExpectedSourceFrameRateKey.ok_or_else(failed)?,
                    frame_rate.as_ref(),
                ),
            ]);
            let codec = AVVideoCodecTypeH264.ok_or_else(failed)?;
            let w = NSNumber::new_u32(width);
            let h = NSNumber::new_u32(height);
            let settings = dictionary(&[
                (AVVideoCodecKey.ok_or_else(failed)?, codec.as_ref()),
                (AVVideoWidthKey.ok_or_else(failed)?, w.as_ref()),
                (AVVideoHeightKey.ok_or_else(failed)?, h.as_ref()),
                (
                    AVVideoCompressionPropertiesKey.ok_or_else(failed)?,
                    compression.as_ref(),
                ),
            ]);
            let video = AVMediaTypeVideo.ok_or_else(failed)?;
            let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                video,
                Some(&settings),
            );
            input.setExpectsMediaDataInRealTime(false);
            let format = NSNumber::new_u32(kCVPixelFormatType_32BGRA);
            let attributes = dictionary(&[
                (bridged(kCVPixelBufferPixelFormatTypeKey), format.as_ref()),
                (bridged(kCVPixelBufferWidthKey), w.as_ref()),
                (bridged(kCVPixelBufferHeightKey), h.as_ref()),
            ]);
            let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(
                &input,
                Some(&attributes),
            );
            if !writer.canAddInput(&input) {
                return Err(failed());
            }
            writer.addInput(&input);
            if !writer.startWriting() {
                return Err(failed());
            }
            writer.startSessionAtSourceTime(kCMTimeZero);
            Ok(Self {
                writer,
                input,
                adaptor,
                width,
                height,
                fps,
            })
        }
    }

    fn pixel_buffer(&self) -> Result<CFRetained<CVPixelBuffer>, String> {
        // SAFETY: the pool belongs to the adaptor and lives while it does; the out pointer is a
        // local that the pool fills with a +1 buffer, taken over by `CFRetained::from_raw`.
        unsafe {
            let pool: Retained<CVPixelBufferPool> =
                self.adaptor.pixelBufferPool().ok_or_else(failed)?;
            let mut raw: *mut CVPixelBuffer = std::ptr::null_mut();
            let status =
                CVPixelBufferPool::create_pixel_buffer(None, &pool, NonNull::from(&mut raw));
            if status != 0 {
                return Err(failed());
            }
            NonNull::new(raw)
                .map(|raw| CFRetained::from_raw(raw))
                .ok_or_else(failed)
        }
    }

    /// Appends frame `index`, an RGBA image of the writer's size.
    pub fn append(&self, index: u32, rgba: &[u8]) -> Result<(), String> {
        let row = self.width as usize * 4;
        if rgba.len() != row * self.height as usize {
            return Err(failed());
        }
        // SAFETY: as in `new`. The buffer is locked while its memory is written, each row within
        // `bytes_per_row`, and unlocked before it is appended.
        unsafe {
            while !self.input.isReadyForMoreMediaData() {
                if self.writer.status() == AVAssetWriterStatus::Failed {
                    return Err(failed());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            let buffer = self.pixel_buffer()?;
            if CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags(0)) != 0 {
                return Err(failed());
            }
            let base = CVPixelBufferGetBaseAddress(&buffer) as *mut u8;
            let stride = CVPixelBufferGetBytesPerRow(&buffer);
            if base.is_null() || stride < row {
                CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags(0));
                return Err(failed());
            }
            for (y, from) in rgba.chunks_exact(row).enumerate() {
                let to = std::slice::from_raw_parts_mut(base.add(y * stride), row);
                rgba_to_bgra(from, to);
            }
            CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags(0));
            let at = CMTime::new(i64::from(index), self.fps as i32);
            if !self
                .adaptor
                .appendPixelBuffer_withPresentationTime(&buffer, at)
            {
                return Err(failed());
            }
        }
        Ok(())
    }

    /// Ends the file and waits for it to be written.
    pub fn finish(self) -> Result<(), String> {
        let (sent, received) = mpsc::channel();
        let done = RcBlock::new(move || {
            let _ = sent.send(());
        });
        // SAFETY: as in `new`; the block only sends on a channel, so it may run on any thread.
        unsafe {
            self.input.markAsFinished();
            self.writer.finishWritingWithCompletionHandler(&done);
        }
        received
            .recv_timeout(EXPORT_TIMEOUT)
            .map_err(|_| failed())?;
        // SAFETY: as in `new`.
        let status = unsafe { self.writer.status() };
        (status == AVAssetWriterStatus::Completed)
            .then_some(())
            .ok_or_else(failed)
    }
}

/// One audio track of a motion: its file, when it starts and its volume.
pub struct Track {
    pub file: PathBuf,
    pub start: f64,
    pub volume: f64,
}

fn seconds(value: f64) -> CMTime {
    // SAFETY: a plain value function.
    unsafe { CMTime::with_seconds(value, AUDIO_TIMESCALE) }
}

fn first_track(
    path: &Path,
    kind: &objc2_av_foundation::AVMediaType,
) -> Result<Retained<AVAssetTrack>, String> {
    let (sent, received) = mpsc::channel();
    // SAFETY: the asset is used on this thread; the block copies the first track out of the
    // array AVFoundation hands it (or nothing) and sends it, which is all it does.
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&file_url(path), None);
        let done = RcBlock::new(
            move |tracks: *mut NSArray<AVAssetTrack>, _error: *mut objc2_foundation::NSError| {
                let first = tracks.as_ref().and_then(|tracks| tracks.firstObject());
                let _ = sent.send(first.map(SendTrack));
            },
        );
        asset.loadTracksWithMediaType_completionHandler(kind, &done);
        let track = received
            .recv_timeout(EXPORT_TIMEOUT)
            .map_err(|_| failed())?;
        // The asset must outlive its track's use; keep it alive until the track is taken.
        drop(asset);
        track.map(|track| track.0).ok_or_else(failed)
    }
}

/// A track handed from AVFoundation's queue back to the render thread, which then owns it.
struct SendTrack(Retained<AVAssetTrack>);
// SAFETY: the track is only moved across, never shared: the block's thread drops its handle.
unsafe impl Send for SendTrack {}

fn export(session: &AVAssetExportSession) -> Result<(), String> {
    let (sent, received) = mpsc::channel();
    let done = RcBlock::new(move || {
        let _ = sent.send(());
    });
    // SAFETY: the session is configured and started on this thread; the block only sends.
    unsafe {
        session.exportAsynchronouslyWithCompletionHandler(&done);
    }
    received
        .recv_timeout(EXPORT_TIMEOUT)
        .map_err(|_| failed())?;
    // SAFETY: as above.
    let status = unsafe { session.status() };
    (status == AVAssetExportSessionStatus::Completed)
        .then_some(())
        .ok_or_else(failed)
}

/// Mixes `tracks` (each placed at its start, at its volume, cut at `duration`) to an AAC file at
/// `out`, which must not exist.
pub fn mix_audio(tracks: &[Track], duration: f64, out: &Path) -> Result<(), String> {
    // SAFETY: every AVFoundation object is made and used on this thread; the composition is not
    // changed once its export starts. The media type is a constant AVFoundation defines.
    unsafe {
        let audio = AVMediaTypeAudio.ok_or_else(failed)?;
        let composition = AVMutableComposition::composition();
        let mut parameters: Vec<Retained<AVAudioMixInputParameters>> = Vec::new();
        for track in tracks {
            let source = first_track(&track.file, audio)?;
            let length = (duration - track.start).max(0.0);
            let available = source.timeRange().duration;
            let wanted = seconds(length);
            let take = if CMTime::compare(available, wanted) < 0 {
                available
            } else {
                wanted
            };
            let target = composition
                .addMutableTrackWithMediaType_preferredTrackID(audio, kCMPersistentTrackID_Invalid)
                .ok_or_else(failed)?;
            target
                .insertTimeRange_ofTrack_atTime_error(
                    CMTimeRange::new(kCMTimeZero, take),
                    &source,
                    seconds(track.start),
                )
                .map_err(|_| failed())?;
            let input =
                AVMutableAudioMixInputParameters::audioMixInputParametersWithTrack(Some(&target));
            input.setVolume_atTime(track.volume as f32, kCMTimeZero);
            parameters.push(Retained::into_super(input));
        }
        let mix = AVMutableAudioMix::audioMix();
        mix.setInputParameters(&NSArray::from_retained_slice(&parameters));
        let session = AVAssetExportSession::exportSessionWithAsset_presetName(
            &composition,
            AVAssetExportPresetAppleM4A,
        )
        .ok_or_else(failed)?;
        session.setOutputURL(Some(&file_url(out)));
        session.setOutputFileType(Some(AVFileTypeAppleM4A.ok_or_else(failed)?));
        session.setAudioMix(Some(&mix));
        session.setTimeRange(CMTimeRange::new(kCMTimeZero, seconds(duration)));
        export(&session)
    }
}

/// Joins the video at `video` and the mixed audio at `audio` into an MP4 at `out`, without
/// encoding either again.
pub fn join(video: &Path, audio: &Path, duration: f64, out: &Path) -> Result<(), String> {
    // SAFETY: as in `mix_audio`.
    unsafe {
        let video_kind = AVMediaTypeVideo.ok_or_else(failed)?;
        let audio_kind = AVMediaTypeAudio.ok_or_else(failed)?;
        let picture = first_track(video, video_kind)?;
        let sound = first_track(audio, audio_kind)?;
        let composition = AVMutableComposition::composition();
        let range = CMTimeRange::new(kCMTimeZero, picture.timeRange().duration);
        composition
            .addMutableTrackWithMediaType_preferredTrackID(video_kind, kCMPersistentTrackID_Invalid)
            .ok_or_else(failed)?
            .insertTimeRange_ofTrack_atTime_error(range, &picture, kCMTimeZero)
            .map_err(|_| failed())?;
        let sound_length = sound.timeRange().duration;
        let wanted = seconds(duration);
        let take = if CMTime::compare(sound_length, wanted) < 0 {
            sound_length
        } else {
            wanted
        };
        composition
            .addMutableTrackWithMediaType_preferredTrackID(audio_kind, kCMPersistentTrackID_Invalid)
            .ok_or_else(failed)?
            .insertTimeRange_ofTrack_atTime_error(
                CMTimeRange::new(kCMTimeZero, take),
                &sound,
                kCMTimeZero,
            )
            .map_err(|_| failed())?;
        let session = AVAssetExportSession::exportSessionWithAsset_presetName(
            &composition,
            AVAssetExportPresetPassthrough,
        )
        .ok_or_else(failed)?;
        session.setOutputURL(Some(&file_url(out)));
        session.setOutputFileType(Some(AVFileTypeMPEG4.ok_or_else(failed)?));
        session.setShouldOptimizeForNetworkUse(true);
        export(&session)
    }
}
