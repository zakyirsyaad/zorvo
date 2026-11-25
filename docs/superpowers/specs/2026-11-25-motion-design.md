# Motion and video: agents make videos that Zorvo plays and renders

Date: 2026-11-25. Status: design and implementation on `feat/motion-video`.
Parts 1 and 2 were agreed in chat. Parts 3 to 5 were decided in the same session from the review
and the spike below, and are open to correction in review.

## Goal

The user asks for a video ("make a 15 second motion graphics video of Compare") and gets one, the
way Claude Code desktop delivers it: the agent works, then a video card shows in the chat and plays.
Behind it, Zorvo owns the engine, so every agent (Claude Code, Codex, Qwen Code, Pi) can make the
same quality of video without installing Chrome or ffmpeg.

## What Claude Code desktop does (checked 2026-11-25)

- No motion type and no bundled Remotion or HyperFrames. The agent writes the video in the project
  (an HTML page with one GSAP timeline seeked per frame, or a Remotion project it installed with
  npm), renders it from its shell, looks at stills it rendered, and shows the MP4 as a file card.
- Audio only when the user asked for it (every showreel session named ElevenLabs in the prompt).
- Two formats (16:9 and 9:16) of one piece are the norm.

## Decisions taken with the user

1. Video playback, a motion guide for agents, and a motion artifact with a player and MP4 export
   are all in this version.
2. Rendering runs in Zorvo's backend with WebKit and AVFoundation. Nothing is downloaded.
3. Both the agent (a tool) and the user (Export) render.
4. Silent by default. Audio is a list of tracks in `motion.json`, mixed by Zorvo.
5. One composition holds a list of formats.
6. The agent checks its work with synchronous stills and a contact sheet.
7. Motion blur is always on.
8. Remotion stays the agent's: Zorvo plays its MP4 (`kind: "video"`) and never runs it.
9. The user's prompt only says what they want; agents use these tools without being told.

## Spike (2026-11-25, MacBook Air M2, 8 GB)

A throwaway Swift program, using the same macOS APIs Rust reaches through objc2:

- 900 frames of a 1920×1080 page (48 moving chips with shadows, a `filter: blur` title, a
  `backdrop-filter` panel, an SVG path, a counter) seeked with `document.getAnimations()`,
  snapshotted with `WKSnapshotConfiguration` and encoded by `AVAssetWriter` (H.264): 17.6 s in a
  hidden view of a window on screen, 18.6 s in a window off screen. Per frame: seek 0.3 ms,
  snapshot 18.4 ms, encode 0.9 ms. The contact sheet showed every frame followed its seek time.
- `<video>` over a `WKURLSchemeHandler` scheme loaded, seeked to 10 s and played, with 206 Range
  answers and with full 200 answers; WebKit always asks for byte ranges, so Range is required for
  large files. `AVAssetWriter` puts `moov` at the end unless `shouldOptimizeForNetworkUse` is set.
- `objc2-av-foundation`, `objc2-core-media` and `objc2-core-video` 0.3.2 exist and match the objc2
  family in use.
- Not tested in the spike: audio mixing, blur, the real wry child view, web fonts from a CDN.

## Part 1: agent tools

| Tool | Arguments | Answer |
|---|---|---|
| `show_artifact`, `kind: "motion"` | `path` (the folder or its `motion.json`), `title` | Key, formats, duration, warnings. A motion card in the chat and a row in Output |
| `show_artifact`, `kind: "video"` | `path` to an `.mp4`, `.mov` or `.m4v` in the session's folder | A video card and a row in Output. The file stays where it is |
| `render_motion` (new) | `motion` (key or path), `formats`, `frames` (seconds) | With `frames`: synchronous stills, one contact sheet (an image on the MCP path, a path for Pi) and the PNG paths under `out/frames/`. Without: starts a render job and answers its id at once |
| `render_status` (new) | `job`, `wait` (0 to 120 s) | Progress per format, or the MP4 paths under `out/` |
| `artifact_guide`, `kind: "motion"` | | The motion guide (`src/lib/motion-guide.md`) |

- `render_motion` and `render_status` are answered in the backend, like computer use, since they
  return images and the webview never receives one. `AgentTools` gets a list of backend tool
  servers (`BackendTools`, each saying which tools it `offers`); computer use is one of them.
- No card and no grant: they read and write only in the session's own folder.
- Coordinator and plain sessions only; a worker keeps `done` alone.
- Context notes (`MCP_PATH_CONTEXT`, `COMMAND_PATH_CONTEXT`) say: for a video or motion graphics,
  make a composition and show it with `kind: "motion"`; add sound only when asked, and suggest it
  at most once.

## Part 2: the composition

A folder inside the session's folder (canvas rules: never a temporary folder):

```text
promo/
  motion.json
  index.html
  assets/…  audio/…
  out/        written by Zorvo only: frames/, <format>.mp4, render.json
```

`motion.json` version 1:

```json
{
  "version": 1,
  "title": "Compare in 15 seconds",
  "page": "index.html",
  "duration": 15,
  "fps": 60,
  "formats": [
    { "id": "wide", "width": 1920, "height": 1080 },
    { "id": "tall", "width": 1080, "height": 1920 }
  ],
  "audio": [
    { "file": "audio/bed.mp3", "start": 0, "volume": 0.8 },
    { "file": "audio/whoosh.wav", "start": 2 }
  ],
  "poster": 4.5
}
```

- `duration` 0.5 to 180 s; `fps` 24, 25, 30, 50 or 60 (default 60); 1 to 4 formats, ids
  `a-z0-9-` and unique, width and height 240 to 3840 and even (H.264 refuses odd sizes); up to 32
  audio tracks (`mp3`, `wav`, `m4a`, `aac`, `start` within the duration, `volume` 0 to 1, default
  1); `poster` within the duration (default a third). At most 64 KiB and no other field. A refusal
  names the field and never repeats the file's text.
- **One clock, Zorvo's.** A runtime script (`motion_runtime.js`, pinned by its SHA-256) runs before
  the page's own and gives it `window.zorvoMotion = { format, width, height, duration, fps,
  onSeek(fn) }` and `data-format` on `<html>`. Zorvo seeks every CSS and Web Animation itself
  through `document.getAnimations()`; JavaScript motion registers `onSeek(t => tl.seek(t))`. The
  guide forbids free-running `requestAnimationFrame`, timers that move things, `Date.now()` and
  `<video>` in the page.
- Preview uses the same path as a render: the player seeks the page on every display frame, so the
  preview is the video, without blur.
- Frames are taken after `document.fonts` and images have loaded. The page cannot fetch, as on a
  canvas.
- `show_artifact` checks the page: when neither an animation nor an `onSeek` handler exists after
  load, the answer warns that nothing moves when seeked.

## Part 3: backend

- **Store.** `motions.json` and `videos.json` beside `canvases.json` (`MotionEntry`, `VideoEntry`:
  key `m-`/`v-` plus 16 hex, canonical path, path relative to the session's folder, title, shown
  time; 50 motions and 100 videos per session). Deleting a session forgets them; files stay.
- **Serving to the native view.** The `zorvo-artifact://localhost/motion/<session>/<key>/…` routes
  serve the preview wrapper (`motion_shell.html`, pinned by its SHA-256) and the folder's files
  under `BOARD_CSP`, for a remembered motion inside a known workspace. `SERVED_TYPES` gains `mp3`,
  `wav`, `m4a` and `aac`. The wrapper's CSP adds `media-src zorvo-artifact://localhost` for audio.
- **Serving to the main webview.** A new scheme `zorvo-media://localhost/<token>` plays videos in
  the chat, Output and the file viewer. Tokens are 32 random hex characters, memory only, made by
  `media_url` for a video entry, a motion's rendered format or a workspace file (after
  `ensure_known_workspace`, a path inside the root and a video header), and answer `GET`/`HEAD`
  with Range (206, 416), at most 4 MiB per answer. The main CSP gains
  `media-src zorvo-media://localhost`; nothing reaches the network.
- **Renderer** (`motion_render.rs`, `motion_encode.rs`). One job at a time, on the main thread's
  hidden child view at the format's size (the thumbnails' path), with the runtime script and the
  canvas navigation rule. Per frame, four seeks spread over half the frame interval (a 180°
  shutter), four snapshots, averaged, written by `AVAssetWriter` (H.264, about 0.12 bits per pixel
  per frame, `shouldOptimizeForNetworkUse`). With audio, the tracks are placed in an
  `AVMutableComposition` with an audio mix for their volumes, exported to AAC
  (`AVAssetExportPresetAppleM4A`), then joined with the video by a passthrough export. Files are
  written as `out/.<format>.mp4.partial` and renamed; `out/` must be a real folder.
- **Jobs.** Id `r-` plus 16 hex; states queued, rendering, done, failed, cancelled; progress per
  format. One active job per motion (a new one replaces a queued one), at most four queued per
  session. Stopping or deleting the session or quitting cancels it and removes the partial file.
  `motion-render` events carry the progress to the webview.
- **Stills** run ahead of queued jobs: up to 12 times per call, blurred like the video, PNGs at
  full size in `out/frames/`, and a contact sheet (`out/frames/sheet.jpg`, at most 1920 px wide, a
  row per format).
- **Export.** The user picks a file (one format) or a folder (all). An `out/<format>.mp4` whose
  recorded key (`out/render.json`: SHA-256 of `motion.json` and a digest of the folder's other files)
  still matches is copied; anything else is rendered first.
- Refusals are fixed sentences mirrored in `src/lib/motion.ts` (`MOTION_REFUSALS`), kept equal by a
  test.

## Part 4: screens

- **Chat.** A motion or video card: poster, title, duration and formats, and a Play button. A video
  plays in place through `zorvo-media`. A motion plays its newest up-to-date render, else Open
  shows its preview in Output. A running render shows its progress. Nothing autoplays.
- **Output.** Rows for motions (duration, formats, rendered or not) and videos.
- **Motion viewer.** Header: title, format switch, play and pause, time, a scrubber, Export (this
  format, all formats) and ⋯. The preview in the native view, letterboxed. Under it: "Preview has
  no motion blur. Exports do." and the rendered videos with Play and Show in Finder.
- **Video viewer and file viewer.** A `<video controls>` element through `zorvo-media`.
- **Popout.** Title only and "Shown in the main window."
- No keyboard shortcuts beyond the native controls' own keys.

## Part 5: security, tests, order

- Paths: the folder is canonical and inside the session's folder and a known workspace; `out/` is
  the only place Zorvo writes; tokens never carry a path; the native view's navigation allows only
  that motion's files; the runtime and wrapper are pinned by their SHA-256.
- No new network host. Rendering loads the same files and CDNs the preview does.
- Tests: Rust unit tests (parse, keys, store, tokens, Range, job queue, contact sheet layout, tool
  validation), a render test (`tests/motion_render.rs`, `harness = false`, skipped unless
  `ZORVO_RENDER_TEST=1`) of a fixture with two formats and one audio track, frontend tests (parsing,
  cards, viewer, file viewer, refusals), and the Tauri contract test.
- Agent check (by hand, after merge): a plain prompt to Claude Code, Codex, Qwen Code and Pi; do
  they use `kind: "motion"` unasked, look at stills, and finish with a render.

## Not in this version

Comments on motion, `<video>` inside a composition, virtual time, loudness normalization, HEVC,
ProRes or GIF, running Remotion, a timeline editor, playback in a popout.
