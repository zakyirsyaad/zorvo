//! Renders a fixture motion through `artifacts::motion_render` in a real Tauri app: stills with
//! their contact sheet, then an MP4 of two formats with one audio track. `harness = false`, as in
//! `canvas_render.rs`: Tauri's event loop can only be made on the process's main thread.
//!
//! It needs a window server, so it skips unless `ZORVO_RENDER_TEST=1`:
//! `ZORVO_RENDER_TEST=1 cargo test --test motion_render`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::Manager;

use zorvo_lib::artifacts::motion::{out_file, read_motion, resolve_motion};
use zorvo_lib::artifacts::motion_render::{is_up_to_date, Destination, JobState, MotionRenderer};
use zorvo_lib::artifacts::motion_store::ShownMotion;
use zorvo_lib::artifacts::protocol::Served;
use zorvo_lib::artifacts::store::ArtifactStore;

const SESSION: &str = "session-1794800000000-k3x9a";
const DEADLINE: Duration = Duration::from_secs(240);
const MOTION_JSON: &str = r#"{
  "version": 1, "title": "Probe", "duration": 1, "fps": 24,
  "formats": [
    { "id": "wide", "width": 640, "height": 360 },
    { "id": "tall", "width": 360, "height": 640 }
  ],
  "audio": [{ "file": "audio/tone.wav", "start": 0.25, "volume": 0.5 }]
}"#;
const PAGE: &str = r#"<!doctype html><html><head><style>
  html, body { margin: 0; width: 100%; height: 100%; background: #0a0a0b; }
  #box { position: absolute; left: 0; top: 40%; width: 80px; height: 80px; background: #f97316;
         animation: slide 1s linear both; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(500px); } }
  #n { position: absolute; left: 20px; top: 20px; color: #fafafa; font: 32px sans-serif; }
</style></head><body><div id="box"></div><div id="n"></div>
<script>zorvoMotion.onSeek(t => { document.getElementById('n').textContent = t.toFixed(2); });</script>
</body></html>"#;

/// A one-second 440 Hz tone as a 16-bit mono WAV.
fn tone() -> Vec<u8> {
    let rate: u32 = 48_000;
    let samples: Vec<i16> = (0..rate)
        .map(|i| {
            ((i as f64 * 440.0 * std::f64::consts::TAU / f64::from(rate)).sin() * 8000.0) as i16
        })
        .collect();
    let data_len = samples.len() as u32 * 2;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn check(app: &tauri::AppHandle, folder: &Path) {
    let work = folder.join("work");
    std::fs::create_dir_all(work.join("promo/audio")).expect("fixture folder");
    std::fs::write(work.join("promo/motion.json"), MOTION_JSON).expect("motion.json");
    std::fs::write(work.join("promo/index.html"), PAGE).expect("page");
    std::fs::write(work.join("promo/audio/tone.wav"), tone()).expect("tone");
    let work = std::fs::canonicalize(work).expect("canonical");
    let found = resolve_motion(&work, "promo").expect("motion folder");
    let motion = read_motion(&found.root).expect("motion");
    let store = Arc::new(ArtifactStore::new(folder.join("artifacts")));
    let entry = store
        .remember_motion(
            SESSION,
            ShownMotion {
                folder: &found.root,
                relative: &found.relative,
                title: &motion.title,
                duration: motion.duration,
                formats: motion.formats.iter().map(|f| f.id.clone()).collect(),
            },
            1,
        )
        .expect("remember");
    let served = Arc::new(Served {
        store,
        thumbs: folder.join("thumbs"),
        is_known: Arc::new(|_| true),
    });
    let renderer = MotionRenderer::start(app.clone(), served);

    let started = Instant::now();
    let stills = renderer
        .stills(
            SESSION,
            &entry.key,
            Vec::new(),
            vec![0.0, 0.9],
            Duration::from_secs(90),
        )
        .expect("stills");
    println!("motion_render: 4 stills in {:?}", started.elapsed());
    assert_eq!(stills.frames.len(), 4);
    for (_, _, relative) in &stills.frames {
        let png = std::fs::read(found.root.join(relative)).expect("still");
        assert!(png.starts_with(b"\x89PNG"), "{relative}");
    }
    assert_eq!(&stills.sheet[..2], &[0xFF, 0xD8]);
    let first = std::fs::read(found.root.join(&stills.frames[0].2)).expect("first");
    let last = std::fs::read(found.root.join(&stills.frames[1].2)).expect("last");
    assert_ne!(
        first, last,
        "the box and the counter move between 0 s and 0.9 s"
    );

    let started = Instant::now();
    let job = renderer
        .enqueue(SESSION, &entry.key, Vec::new(), Destination::Out, false)
        .expect("enqueue");
    let done = loop {
        let view = renderer.job(SESSION, &job.job).expect("job");
        match view.state {
            JobState::Done => break view,
            JobState::Failed | JobState::Cancelled => panic!("render ended: {:?}", view.error),
            JobState::Queued | JobState::Rendering => {
                std::thread::sleep(Duration::from_millis(200))
            }
        }
    };
    println!(
        "motion_render: 2 formats of 24 frames in {:?}",
        started.elapsed()
    );
    for format in &motion.formats {
        let video = std::fs::read(out_file(&found.root, &format.id)).expect("rendered file");
        assert_eq!(&video[4..8], b"ftyp", "{}", format.id);
        assert!(contains(&video, b"vide"), "{} has a video track", format.id);
        assert!(
            contains(&video, b"soun"),
            "{} has an audio track",
            format.id
        );
        assert!(
            is_up_to_date(&found.root, format),
            "{} is up to date",
            format.id
        );
    }
    assert!(done.formats.iter().all(|f| f.file.is_some()));
}

fn scratch_folder() -> PathBuf {
    let folder = std::env::temp_dir().join(format!("zorvo-motion-render-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("scratch folder");
    std::fs::canonicalize(folder).expect("canonical scratch folder")
}

fn main() {
    if std::env::var("ZORVO_RENDER_TEST").as_deref() != Ok("1") {
        println!("motion_render: skipped (needs a window server; set ZORVO_RENDER_TEST=1)");
        return;
    }
    let folder = scratch_folder();
    std::thread::spawn(|| {
        std::thread::sleep(DEADLINE);
        eprintln!("motion_render: no result after {DEADLINE:?}");
        std::process::exit(1);
    });
    let checked = folder.clone();
    tauri::Builder::default()
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                window.hide()?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let passed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    check(&handle, &checked);
                }))
                .is_ok();
                if std::env::var("ZORVO_KEEP_RENDER").is_err() {
                    let _ = std::fs::remove_dir_all(&checked);
                } else {
                    println!("motion_render: kept {}", checked.display());
                }
                println!("motion_render: {}", if passed { "ok" } else { "FAILED" });
                handle.exit(if passed { 0 } else { 1 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run the test app");
}
