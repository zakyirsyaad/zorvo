//! Motion renders: stills an agent reads, and MP4 jobs an agent or the user starts. One thread
//! does the work, one thing at a time: stills go ahead of queued jobs and run between the frames
//! of the job under way, so an agent is never kept waiting behind a long render.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::motion::{
    frames_dir, out_dir, out_file, read_motion, render_key, still_name, Motion, MotionFormat,
    OUT_DIR,
};
use super::motion_capture::CaptureView;
use super::motion_encode::{join, mix_audio, Track, VideoWriter};
use super::motion_pixels::{contact_sheet, png_of, sample_times, Accumulator, SheetCell};
use super::motion_protocol::{motion_page_url, motion_root};
use super::protocol::Served;

pub const MOTION_RENDER_EVENT: &str = "motion-render";
pub const MAX_STILLS: usize = 12;
pub const MAX_QUEUED_PER_SESSION: usize = 4;
pub const RENDER_FILE: &str = "render.json";
pub const NOT_SHOWN: &str =
    "Show the motion with show_artifact (kind motion) first, then render it by its key.";
pub const TOO_MANY_JOBS: &str =
    "This session already has 4 renders waiting. Wait for one to finish.";
pub const NO_SUCH_JOB: &str = "There is no render with that id in this session.";
pub const CANCELLED: &str = "The render was cancelled.";
const PROGRESS_EVERY: u32 = 15;
const JOB_HEX_CHARS: usize = 16;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// Where a finished render goes besides `out/`: nowhere, one file, or a folder (one file a format).
#[derive(Clone, Debug, PartialEq)]
pub enum Destination {
    Out,
    File(PathBuf),
    Folder(PathBuf),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Rendering,
    Done,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatProgress {
    pub id: String,
    pub frame: u32,
    pub total: u32,
    /// The rendered file, relative to the composition's folder, once written.
    pub file: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub job: String,
    pub session_id: String,
    pub key: String,
    pub state: JobState,
    pub formats: Vec<FormatProgress>,
    pub error: Option<String>,
    pub by_user: bool,
    /// For an export, how many files reached the place the user chose.
    pub saved: u32,
}

struct Job {
    view: JobView,
    root: PathBuf,
    destination: Destination,
    cancelled: bool,
}

/// A request for stills, answered on its channel.
struct StillsRequest {
    session_id: String,
    key: String,
    formats: Vec<String>,
    times: Vec<f64>,
    answer: mpsc::Sender<Result<Stills, String>>,
}

/// What a stills request produced.
pub struct Stills {
    pub title: String,
    /// Each still's format, time and path relative to the composition's folder.
    pub frames: Vec<(String, f64, String)>,
    pub sheet: Vec<u8>,
    pub sheet_relative: String,
}

#[derive(Default)]
struct Queue {
    jobs: HashMap<String, Job>,
    waiting: VecDeque<String>,
    stills: VecDeque<StillsRequest>,
}

pub struct MotionRenderer {
    app: AppHandle,
    served: Arc<Served>,
    queue: Mutex<Queue>,
    wake: Condvar,
}

fn new_job_id() -> String {
    use std::io::Read;
    let mut bytes = [0u8; JOB_HEX_CHARS / 2];
    let _ = fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes));
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("r-{hex}")
}

pub fn is_job_id(id: &str) -> bool {
    id.strip_prefix("r-")
        .is_some_and(|hex| hex.len() == JOB_HEX_CHARS && hex.chars().all(|c| c.is_ascii_hexdigit()))
}

/// The formats a request names, in the motion's order; all of them when it names none.
pub fn chosen_formats(motion: &Motion, wanted: &[String]) -> Result<Vec<MotionFormat>, String> {
    if wanted.is_empty() {
        return Ok(motion.formats.clone());
    }
    if let Some(unknown) = wanted.iter().find(|id| motion.format(id).is_none()) {
        let known: Vec<&str> = motion.formats.iter().map(|f| f.id.as_str()).collect();
        let shown = if unknown.chars().count() <= 64 {
            unknown.as_str()
        } else {
            "that"
        };
        return Err(format!(
            "The motion has no format {shown}. Its formats: {}.",
            known.join(", ")
        ));
    }
    Ok(motion
        .formats
        .iter()
        .filter(|f| wanted.contains(&f.id))
        .cloned()
        .collect())
}

/// The keys `out/render.json` recorded for each rendered format.
pub fn recorded_keys(root: &Path) -> HashMap<String, String> {
    fs::read(root.join(OUT_DIR).join(RENDER_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn record_key(root: &Path, format: &str, key: &str) {
    let mut keys = recorded_keys(root);
    keys.insert(format.to_string(), key.to_string());
    if let Ok(bytes) = serde_json::to_vec_pretty(&keys) {
        let path = root.join(OUT_DIR).join(RENDER_FILE);
        let tmp = root.join(OUT_DIR).join(format!(".{RENDER_FILE}.tmp"));
        let _ = crate::store::atomic_write(&path, &tmp, &bytes);
    }
}

/// Whether `out/<format>.mp4` exists and was rendered from what the folder holds now.
pub fn is_up_to_date(root: &Path, format: &MotionFormat) -> bool {
    out_file(root, &format.id).is_file()
        && render_key(root, format)
            .is_some_and(|key| recorded_keys(root).get(&format.id) == Some(&key))
}

impl MotionRenderer {
    pub fn start(app: AppHandle, served: Arc<Served>) -> Arc<Self> {
        let renderer = Arc::new(Self {
            app,
            served,
            queue: Mutex::new(Queue::default()),
            wake: Condvar::new(),
        });
        let worker = Arc::clone(&renderer);
        let _ = std::thread::Builder::new()
            .name("motion-render".into())
            .spawn(move || worker.run());
        renderer
    }

    /// The composition of a motion this session showed, when it is still readable and inside a
    /// known workspace.
    pub fn motion_of(&self, session_id: &str, key: &str) -> Result<(PathBuf, Motion), String> {
        let root =
            motion_root(&self.served, session_id, key).ok_or_else(|| NOT_SHOWN.to_string())?;
        let motion = read_motion(&root)?;
        Ok((root, motion))
    }

    /// Finds a motion this session showed by its key, or by the folder it was shown from.
    pub fn find(&self, session_id: &str, name: &str) -> Option<String> {
        let entries = self.served.store.motions(session_id).ok()?;
        let name = name.trim_end_matches('/').trim_end_matches("/motion.json");
        entries
            .into_iter()
            .find(|entry| entry.key == name || entry.relative == name || entry.folder == name)
            .map(|entry| entry.key)
    }

    /// Stills of a motion at `times` in `formats` (all when none), synchronous.
    pub fn stills(
        &self,
        session_id: &str,
        key: &str,
        formats: Vec<String>,
        times: Vec<f64>,
        timeout: Duration,
    ) -> Result<Stills, String> {
        let (answer, received) = mpsc::channel();
        lock(&self.queue).stills.push_back(StillsRequest {
            session_id: session_id.to_string(),
            key: key.to_string(),
            formats,
            times,
            answer,
        });
        self.wake.notify_all();
        received
            .recv_timeout(timeout)
            .map_err(|_| "The stills took too long.".to_string())?
    }

    /// Queues a render of `formats` (all when none). A queued render of the same motion is
    /// replaced; one under way goes on.
    pub fn enqueue(
        &self,
        session_id: &str,
        key: &str,
        formats: Vec<String>,
        destination: Destination,
        by_user: bool,
    ) -> Result<JobView, String> {
        let (root, motion) = self.motion_of(session_id, key)?;
        let chosen = chosen_formats(&motion, &formats)?;
        let mut queue = lock(&self.queue);
        let replaced: Vec<String> = queue
            .waiting
            .iter()
            .filter(|id| {
                queue.jobs.get(*id).is_some_and(|job| {
                    job.view.key == key
                        && job.view.session_id == session_id
                        && job.destination == Destination::Out
                })
            })
            .cloned()
            .collect();
        for id in &replaced {
            if let Some(job) = queue.jobs.get_mut(id) {
                job.view.state = JobState::Cancelled;
            }
        }
        queue.waiting.retain(|id| !replaced.contains(id));
        let waiting = queue
            .waiting
            .iter()
            .filter(|id| {
                queue
                    .jobs
                    .get(*id)
                    .is_some_and(|job| job.view.session_id == session_id)
            })
            .count();
        if waiting >= MAX_QUEUED_PER_SESSION {
            return Err(TOO_MANY_JOBS.to_string());
        }
        let view = JobView {
            job: new_job_id(),
            session_id: session_id.to_string(),
            key: key.to_string(),
            state: JobState::Queued,
            formats: chosen
                .iter()
                .map(|f| FormatProgress {
                    id: f.id.clone(),
                    frame: 0,
                    total: motion.frame_count(),
                    file: None,
                })
                .collect(),
            error: None,
            by_user,
            saved: 0,
        };
        queue.waiting.push_back(view.job.clone());
        queue.jobs.insert(
            view.job.clone(),
            Job {
                view: view.clone(),
                root,
                destination,
                cancelled: false,
            },
        );
        drop(queue);
        self.wake.notify_all();
        self.emit(&view);
        Ok(view)
    }

    /// A job of `session_id`, as it stands.
    pub fn job(&self, session_id: &str, job: &str) -> Option<JobView> {
        lock(&self.queue)
            .jobs
            .get(job)
            .filter(|job| job.view.session_id == session_id)
            .map(|job| job.view.clone())
    }

    /// The session's jobs that have not ended, oldest first.
    pub fn open_jobs(&self, session_id: &str) -> Vec<JobView> {
        lock(&self.queue)
            .jobs
            .values()
            .filter(|job| {
                job.view.session_id == session_id
                    && matches!(job.view.state, JobState::Queued | JobState::Rendering)
            })
            .map(|job| job.view.clone())
            .collect()
    }

    pub fn cancel(&self, session_id: &str, job: &str) -> bool {
        let mut queue = lock(&self.queue);
        let Some(entry) = queue
            .jobs
            .get_mut(job)
            .filter(|j| j.view.session_id == session_id)
        else {
            return false;
        };
        entry.cancelled = true;
        if entry.view.state == JobState::Queued {
            entry.view.state = JobState::Cancelled;
            let view = entry.view.clone();
            queue.waiting.retain(|id| id != job);
            drop(queue);
            self.emit(&view);
        }
        true
    }

    /// The session's agent stopped (`with_user` false: the user's exports go on) or the session
    /// was deleted (`with_user` true): its jobs end.
    pub fn forget(&self, session_id: &str, with_user: bool) {
        let ids: Vec<String> = lock(&self.queue)
            .jobs
            .iter()
            .filter(|(_, job)| {
                job.view.session_id == session_id && (with_user || !job.view.by_user)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.cancel(session_id, &id);
        }
    }

    fn emit(&self, view: &JobView) {
        let _ = self.app.emit(MOTION_RENDER_EVENT, view);
    }

    fn update(&self, job: &str, change: impl FnOnce(&mut JobView)) -> Option<JobView> {
        let mut queue = lock(&self.queue);
        let entry = queue.jobs.get_mut(job)?;
        change(&mut entry.view);
        Some(entry.view.clone())
    }

    fn is_cancelled(&self, job: &str) -> bool {
        lock(&self.queue)
            .jobs
            .get(job)
            .is_none_or(|job| job.cancelled)
    }

    fn run(self: Arc<Self>) {
        loop {
            let next = {
                let mut queue = lock(&self.queue);
                loop {
                    if let Some(request) = queue.stills.pop_front() {
                        break Err(request);
                    }
                    if let Some(id) = queue.waiting.pop_front() {
                        break Ok(id);
                    }
                    queue = self.wake.wait(queue).unwrap_or_else(|e| e.into_inner());
                }
            };
            match next {
                Err(request) => self.answer_stills(request),
                Ok(job) => self.run_job(&job),
            }
        }
    }

    /// Answers every stills request waiting, between two frames of a job.
    fn serve_stills(&self) {
        loop {
            let request = lock(&self.queue).stills.pop_front();
            match request {
                Some(request) => self.answer_stills(request),
                None => return,
            }
        }
    }

    fn answer_stills(&self, request: StillsRequest) {
        let result = self.make_stills(&request);
        let _ = request.answer.send(result);
    }

    fn open_view(
        &self,
        session_id: &str,
        key: &str,
        motion: &Motion,
        format: &MotionFormat,
    ) -> Result<CaptureView, String> {
        let view = CaptureView::open(
            &self.app,
            Arc::clone(&self.served),
            motion_page_url(session_id, key, motion, format),
            session_id.to_string(),
            key.to_string(),
            format.width,
            format.height,
        )?;
        view.wait_ready();
        Ok(view)
    }

    /// One frame at `start`: the blurred average of its samples.
    fn blurred_frame(
        view: &CaptureView,
        start: f64,
        fps: u32,
        acc: &mut Accumulator,
    ) -> Result<Vec<u8>, String> {
        for t in sample_times(start, fps) {
            acc.add(&view.frame_at(t)?)
                .map_err(|_| super::motion_capture::CAPTURE_FAILED.to_string())?;
        }
        Ok(acc.take())
    }

    fn make_stills(&self, request: &StillsRequest) -> Result<Stills, String> {
        let (root, motion) = self.motion_of(&request.session_id, &request.key)?;
        let formats = chosen_formats(&motion, &request.formats)?;
        let frames = frames_dir(&root)?;
        let mut cells = Vec::new();
        let mut written = Vec::new();
        for (row, format) in formats.iter().enumerate() {
            let view = self.open_view(&request.session_id, &request.key, &motion, format)?;
            let mut acc = Accumulator::new(format.width, format.height);
            for &t in &request.times {
                let t = t.clamp(0.0, motion.duration);
                let rgba = Self::blurred_frame(&view, t, motion.fps, &mut acc)?;
                let name = still_name(&format.id, t);
                let png = png_of(rgba.clone(), format.width, format.height)
                    .ok_or_else(|| super::motion_capture::CAPTURE_FAILED.to_string())?;
                fs::write(frames.join(&name), png)
                    .map_err(|_| super::motion::OUT_NOT_A_FOLDER.to_string())?;
                written.push((format.id.clone(), t, format!("{OUT_DIR}/frames/{name}")));
                cells.push(SheetCell {
                    row,
                    rgba,
                    width: format.width,
                    height: format.height,
                });
            }
        }
        let sheet = contact_sheet(cells)
            .ok_or_else(|| super::motion_capture::CAPTURE_FAILED.to_string())?;
        fs::write(frames.join("sheet.jpg"), &sheet)
            .map_err(|_| super::motion::OUT_NOT_A_FOLDER.to_string())?;
        Ok(Stills {
            title: motion.title,
            frames: written,
            sheet,
            sheet_relative: format!("{OUT_DIR}/frames/sheet.jpg"),
        })
    }

    fn run_job(&self, job: &str) {
        let Some((session_id, key, root, destination)) = lock(&self.queue).jobs.get(job).map(|j| {
            (
                j.view.session_id.clone(),
                j.view.key.clone(),
                j.root.clone(),
                j.destination.clone(),
            )
        }) else {
            return;
        };
        if self.is_cancelled(job) {
            return;
        }
        if let Some(view) = self.update(job, |view| view.state = JobState::Rendering) {
            self.emit(&view);
        }
        let result = self.render_formats(job, &session_id, &key, &root, &destination);
        let view = self.update(job, |view| match &result {
            Ok(saved) => {
                view.state = JobState::Done;
                view.saved = *saved;
            }
            Err(error) if error == CANCELLED => view.state = JobState::Cancelled,
            Err(error) => {
                view.state = JobState::Failed;
                view.error = Some(error.clone());
            }
        });
        if let Some(view) = view {
            self.emit(&view);
        }
    }

    /// Renders each format of the job to `out/` (or reuses an up-to-date one for an export) and
    /// copies it to the destination. Returns how many files reached an export's destination.
    fn render_formats(
        &self,
        job: &str,
        session_id: &str,
        key: &str,
        root: &Path,
        destination: &Destination,
    ) -> Result<u32, String> {
        let motion = read_motion(root)?;
        out_dir(root)?;
        let ids: Vec<String> = lock(&self.queue)
            .jobs
            .get(job)
            .map(|j| j.view.formats.iter().map(|f| f.id.clone()).collect())
            .unwrap_or_default();
        let mut saved = 0;
        for id in ids {
            let format = motion
                .format(&id)
                .cloned()
                .ok_or_else(|| NOT_SHOWN.to_string())?;
            let reusable = *destination != Destination::Out && is_up_to_date(root, &format);
            if !reusable {
                self.render_one(job, session_id, key, root, &motion, &format)?;
            }
            let total = motion.frame_count();
            if let Some(view) = self.update(job, |view| {
                if let Some(progress) = view.formats.iter_mut().find(|f| f.id == id) {
                    progress.frame = total;
                    progress.file = Some(format!("{OUT_DIR}/{id}.mp4"));
                }
            }) {
                self.emit(&view);
            }
            let rendered = out_file(root, &id);
            let copied = match destination {
                Destination::Out => false,
                Destination::File(path) => fs::copy(&rendered, path).is_ok(),
                Destination::Folder(folder) => {
                    let stem = super::commands::clean_file_stem(&motion.title, "motion");
                    fs::copy(&rendered, folder.join(format!("{stem}-{id}.mp4"))).is_ok()
                }
            };
            saved += u32::from(copied);
        }
        Ok(saved)
    }

    fn render_one(
        &self,
        job: &str,
        session_id: &str,
        key: &str,
        root: &Path,
        motion: &Motion,
        format: &MotionFormat,
    ) -> Result<(), String> {
        let out = out_dir(root)?;
        let video = out.join(format!(".{}.video.mp4", format.id));
        let audio = out.join(format!(".{}.audio.m4a", format.id));
        let joined = out.join(format!(".{}.joined.mp4", format.id));
        // Every temporary file of this format starts with `.<id>.`, AVFoundation's own copies
        // (`.<id>.video.mp4.sb-…`) included.
        let prefix = format!(".{}.", format.id);
        let cleanup = || {
            let Ok(entries) = fs::read_dir(&out) else {
                return;
            };
            for entry in entries.flatten() {
                let is_temp = entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(&prefix));
                if is_temp && entry.file_type().is_ok_and(|kind| kind.is_file()) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        };
        cleanup();
        let key_before = render_key(root, format);
        let result = (|| {
            let view = self.open_view(session_id, key, motion, format)?;
            let writer = VideoWriter::new(&video, format.width, format.height, motion.fps)?;
            let mut acc = Accumulator::new(format.width, format.height);
            let total = motion.frame_count();
            let started = Instant::now();
            for index in 0..total {
                if self.is_cancelled(job) {
                    return Err(CANCELLED.to_string());
                }
                self.serve_stills();
                let start = f64::from(index) / f64::from(motion.fps);
                let frame = Self::blurred_frame(&view, start, motion.fps, &mut acc)?;
                writer.append(index, &frame)?;
                if index % PROGRESS_EVERY == 0 || started.elapsed() > Duration::from_secs(1) {
                    if let Some(view) = self.update(job, |view| {
                        if let Some(progress) = view.formats.iter_mut().find(|f| f.id == format.id)
                        {
                            progress.frame = index;
                        }
                    }) {
                        self.emit(&view);
                    }
                }
            }
            drop(view);
            writer.finish()?;
            let finished = if motion.audio.is_empty() {
                video.clone()
            } else {
                let tracks: Vec<Track> = motion
                    .audio
                    .iter()
                    .map(|track| Track {
                        file: root.join(&track.file),
                        start: track.start,
                        volume: track.volume,
                    })
                    .collect();
                mix_audio(&tracks, motion.duration, &audio)?;
                join(&video, &audio, motion.duration, &joined)?;
                joined.clone()
            };
            fs::rename(&finished, out_file(root, &format.id))
                .map_err(|_| super::motion_encode::ENCODE_FAILED.to_string())?;
            if let Some(key) = key_before {
                record_key(root, &format.id, &key);
            }
            Ok(())
        })();
        cleanup();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::motion::parse_motion;

    fn motion() -> Motion {
        parse_motion(
            br#"{"version":1,"title":"T","duration":2,"formats":[
                {"id":"wide","width":640,"height":360},{"id":"tall","width":360,"height":640}]}"#,
        )
        .expect("motion")
    }

    #[test]
    fn chooses_formats_in_the_motion_order() {
        let ids =
            |formats: Vec<MotionFormat>| formats.into_iter().map(|f| f.id).collect::<Vec<_>>();
        assert_eq!(
            ids(chosen_formats(&motion(), &[]).expect("all")),
            vec!["wide", "tall"]
        );
        assert_eq!(
            ids(chosen_formats(&motion(), &["tall".into(), "wide".into()]).expect("both")),
            vec!["wide", "tall"]
        );
        assert_eq!(
            chosen_formats(&motion(), &["square".into()]).unwrap_err(),
            "The motion has no format square. Its formats: wide, tall."
        );
    }

    #[test]
    fn job_ids_have_one_shape() {
        assert!(is_job_id(&new_job_id()));
        assert!(!is_job_id("r-xyz"));
        assert!(!is_job_id("m-0123456789abcdef"));
    }

    #[test]
    fn a_render_is_up_to_date_only_with_its_recorded_key() {
        let root = crate::artifacts::test_support::Temp::new("motion-up-to-date");
        fs::write(root.0.join("motion.json"), br#"{"version":1,"title":"T","duration":2,"formats":[{"id":"wide","width":640,"height":360}]}"#).expect("spec");
        let format = read_motion(&root.0).expect("motion").formats[0].clone();
        out_dir(&root.0).expect("out");
        fs::write(out_file(&root.0, "wide"), b"video").expect("file");
        assert!(!is_up_to_date(&root.0, &format));
        record_key(&root.0, "wide", &render_key(&root.0, &format).expect("key"));
        assert!(is_up_to_date(&root.0, &format));
        fs::write(root.0.join("index.html"), b"<p>changed</p>").expect("page");
        assert!(!is_up_to_date(&root.0, &format));
    }
}
