# Making a video for Zorvo

Zorvo turns a web page that moves into an MP4. You write the page; Zorvo plays it beside the chat,
draws stills you can check, and renders the video with WebKit, the same engine as the preview. You
install nothing: no Chrome, no ffmpeg, no Remotion.

## The folder

Make a folder inside this folder, never a temporary one:

```text
promo/
  motion.json     the composition
  index.html      the page that moves
  assets/         images, fonts, CSS, JS it loads
  audio/          sound files, only when the user asked for sound
  out/            written by Zorvo only: frames/, <format>.mp4
```

`motion.json`:

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

- `duration` 0.5 to 180 seconds. `fps` 24, 25, 30, 50 or 60 (60 when left out).
- 1 to 4 `formats`. Ids use a-z, 0-9 and -. Width and height are 240 to 3840 and **even**.
  When the user asks for no size, use 16:9 at 1920 × 1080; add 9:16 (1080 × 1920) for social video.
- `audio` is optional: `.mp3`, `.wav`, `.m4a` or `.aac` files in the folder, each placed at `start`
  seconds with a `volume` from 0 to 1. Zorvo mixes them.
- `poster` is the time of the picture on the chat card (a third of the way in when left out).
- No other field. Zorvo names the field it refuses.

## One clock: Zorvo's

Zorvo does not play your page in real time. It **seeks** it: to any time, forwards or back, once
per frame of the video and four times per frame for motion blur. So every moving thing must be a
pure function of time.

- **CSS animations and transitions, and the Web Animations API**: Zorvo pauses and seeks them for
  you. Give them `animation-fill-mode: both` (or `fill: 'both'`) and absolute delays.
- **JavaScript motion** (GSAP, counters, canvas drawing, SVG paths you set by hand): register it.

  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from('.title', { y: 60, opacity: 0, duration: 0.8, ease: 'power3.out' }, 0.2);
    zorvoMotion.onSeek((t) => tl.seek(t));
  </script>
  ```

- Never: `requestAnimationFrame` loops that move things by themselves, `setTimeout` or
  `setInterval` for motion, `Date.now()` or `performance.now()` for time, `Math.random()` that
  changes between frames (seed it once), `<video>` elements, autoplay.

`window.zorvoMotion` holds `format`, `width`, `height`, `duration` and `fps`, and `<html>` has
`data-format="wide"`: lay out each format from one page with CSS such as
`[data-format="tall"] .title { font-size: 120px; }`.

The page cannot fetch anything or keep data. Scripts may come only from cdnjs.cloudflare.com,
cdn.jsdelivr.net/npm/, unpkg.com, cdn.tailwindcss.com and code.jquery.com, with an exact version;
fonts from Google Fonts or the folder. Load images, fonts and CSS from the folder by relative path.

## Make it look made

- Pick a direction first: the project's design system when it has one (its colours, type and
  spacing), otherwise ask once.
- One idea per scene. Cut on beats: 1.5 to 3 seconds a scene in a 15 second piece.
- Ease everything (`cubic-bezier(.2, .8, .2, 1)` or GSAP's `power3`). Nothing linear but a
  progress bar. Overlap motions by 0.1 to 0.2 s so scenes flow.
- Large type, few words, high contrast. Leave the first and last half second calm.
- A real product shown working beats decoration. Never invent numbers, logos or quotes.

## Sound

Silent by default. Add audio only when the user asked for it; you may suggest it once in your
answer. The sound files are yours to make or bring (with the user's own tools and keys); Zorvo only
places and mixes them.

## Check, then render

1. `show_artifact` with `kind: "motion"` and the folder: the user sees the preview at once. Read
   its answer: a warning that nothing moves means your motion is not seekable.
2. `render_motion` with `frames`, for example `[0.5, 3, 7.5, 12, 14.5]`: look at the contact sheet
   (and the full-size PNGs in `out/frames/` when a detail matters). Fix what is cut off, overlapping,
   unreadable or off-brand, then check again.
3. `render_motion` without `frames` renders the MP4 of every format; follow it with
   `render_status` (`wait` up to 120 seconds) until it is done. About a minute per 15 seconds of
   1080p60 video and format.
4. Tell the user where the files are (`out/<format>.mp4`). They can also export from Zorvo.

## Another engine

If the user asks for Remotion or another tool, use it in the project the usual way (Remotion
needs a company licence for teams of four or more), render it yourself, then show the MP4 with
`show_artifact` and `kind: "video"`.
