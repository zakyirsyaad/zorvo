# Design canvas: many screens an agent draws, side by side

Date: 2026-11-21. Status: design, waiting for review.

## Goal

An agent draws several screens of a product (a flow, a set of variants, a whole
redesign) and Zorvo shows them on one canvas beside the chat: artboards in
labelled sections that the user pans and zooms. The user comments on an
artboard, picks between variants, asks the agent to build one in the
repository, and exports artboards as PNG or PDF. The model is the design canvas
the user worked with for Zorvo's own redesign (the "Zorvo redesign v2" canvas,
44 artboards in nine sections), made by any agent Zorvo hosts.

This is the typed artifact the artifacts spec
(`2026-11-16-artifacts-design.md`) and the artifact comments spec
(`2026-11-17-artifact-comments-design.md`) left out of scope. It builds on
both: the same child webview, the same sandbox, the same comment bridge.

## Decisions made with the user

- **Screens side by side**, not a whiteboard. The agent draws the artboards;
  the user looks, comments and decides, and does not draw on the canvas.
- **All four uses in the first version:** comments on artboards, picking
  between variants, handing an artboard to the agent to build, and export.
- **PNG and PDF export now**, not later with decks.
- **The canvas lives in the project folder**, as files: any session and any
  agent can open, extend and implement it, git keeps its history, and deleting
  a session keeps it.
- **Approach: a folder with `canvas.json` and one HTML file per artboard;
  Zorvo lays them out.** Chosen over one large HTML file with a Zorvo runtime
  (styles of one artboard leak into the others, and one screen cannot be
  handed to the agent on its own) and over a native canvas of pictures
  (artboards would not be live). The user asked for the best and most
  efficient version, so the canvas keeps at most eight artboards live and
  shows the rest as pictures.
- **Export through macOS WebKit**, not a downloaded Chrome: the spike below
  shows WebKit renders a full artboard to PNG and PDF with no window.

## Out of scope

Drawing or moving things on the canvas by hand, free positions for artboards
(the agent names the order; Zorvo places them), links between artboards
(prototype flows), a canvas shared outside this Mac other than by export,
publishing to a URL, design systems per project and templates (their own
spec), decks and motion, a canvas in a popout window, a canvas for sessions
that get no Zorvo tools, Markdown artboards, comments written by the agent,
and keyboard shortcuts (the user declined them for Zorvo).

## 1. Format

### Where a canvas lives

A canvas is a folder inside the session's folder, holding `canvas.json`, one
HTML file per artboard and the files the artboards use (images, CSS, scripts,
fonts). The guide suggests `design/<name>/`; any folder inside the session's
folder is accepted. Zorvo keeps no copy of these files: git is the history.

### `canvas.json`, version 1

```json
{
  "version": 1,
  "title": "Checkout",
  "sections": [
    {
      "id": "flow",
      "title": "Flow",
      "artboards": [
        { "id": "cart", "title": "Cart", "file": "cart.html", "width": 1440, "height": 900 },
        { "id": "pay-a", "title": "Payment A", "file": "pay-a.html", "width": 1440, "height": 900, "group": "pay" },
        { "id": "pay-b", "title": "Payment B", "file": "pay-b.html", "width": 1440, "height": 900, "group": "pay" }
      ]
    }
  ]
}
```

- `version` is 1. Any other value is refused with a sentence that names it.
- `title`: 1 to 120 visible characters, cleaned like an artifact title
  (`clean_title`: no control or bidi characters).
- `sections`: 1 to 50. A section has an `id` (1 to 64 of `a-z0-9-`, unique in
  the canvas), a `title` (as above) and 1 to 200 `artboards`.
- An artboard has an `id` (same rule, unique in the canvas), a `title`, a
  `file`, a `width` and a `height` (whole numbers from 200 to 8000), and an
  optional `group` (same rule as an id). Artboards that share a `group` are
  variants of one screen. A group needs two artboards or more.
- `file` is a relative path inside the canvas folder, ending in `.html` or
  `.htm`. It may name a subfolder (`screens/cart.html`); it may not hold `..`,
  start with `/`, or reach outside the folder through a link.
- At most 200 artboards in the whole canvas. `canvas.json` itself is at most
  256 KiB, valid UTF-8 and a JSON object with no other top-level field.
- Every refusal says which field is wrong (`sections[0].artboards[2].width:
  must be a whole number from 200 to 8000`) and never repeats file contents.

### Files an artboard may load

Inside the canvas folder only, served through the `zorvo-artifact` scheme:
HTML (`.html`, `.htm`, as an artboard only), CSS, JavaScript (`.js`, `.mjs`),
images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`), fonts
(`.woff`, `.woff2`, `.ttf`, `.otf`) and JSON. The type comes from the extension
on this list; anything else is not served. SVG is sent as `image/svg+xml` and
loads as an image; the CSP stops it from running as a document. Each file is
at most 16 MiB and is opened as `source.rs` opens an artifact today
(`O_NOFOLLOW | O_NONBLOCK`, judged after it is open, a regular file only).

### What Zorvo stores

Per session, in the artifacts index it already keeps
(`<data dir>/artifacts/<sessionId>/index.json`), the canvases the session has
shown: a key, the canvas folder relative to the session's folder, the title
last read, and when it was last shown. Pictures of artboards are cached under
`<data dir>/canvas-thumbs/<artboard key>.png` and removed when no shown
canvas has used them for 30 days. Deleting a session forgets its canvases
(the files in the project stay). `STATE_VERSION` stays 2: nothing goes in
`state.json`.

## 2. Tools

### `show_artifact` takes a kind

`show_artifact` gets an optional `kind`, `"page"` (the default, today's
behaviour) or `"canvas"`. With `"canvas"`, `path` names the canvas folder or
its `canvas.json`, absolute or relative to the session's folder, and it must
be inside the session's folder (a temporary folder is not allowed for a
canvas, since a canvas is meant to stay). `title` is not used: the canvas has
its own. Calling it again for the same canvas means "it changed": Zorvo reads
it again and the viewer reloads what changed. The answer tells the agent the
canvas key, how many artboards it has, and, when it is refused, the field that
is wrong.

### `artifact_guide` takes a kind

`artifact_guide` gets an optional `kind`. With `"canvas"` it returns the
canvas guide (`src/lib/canvas-guide.md`, imported as text, like
`artifact-guide.md`): the format above, common sizes (1440 × 900 desktop,
390 × 844 phone, 1024 × 768 tablet), one self-contained HTML file per
artboard, shared CSS in one file of the folder, variants as a `group`, keep
the order meaningful since Zorvo places the artboards, and what the sandbox
allows.

### Telling agents

`MCP_PATH_CONTEXT` (`lib/agent-tools-context.ts`) gains one clause: several
screens, a flow or variants go on a canvas (`artifact_guide` with
`kind: "canvas"`, then `show_artifact` with `kind: "canvas"`). The tool
descriptions say the same. `COMMAND_PATH_CONTEXT` names the kind for Pi.

## 3. Viewer

### Where it shows

A canvas is a row in the Output tab and in the gallery, beside the session's
pages, with its title and artboard count. Opening it shows the canvas in the
artifact page's webview (the child wry webview of today), in the inspector or
expanded, with Expand and Shrink keeping the same view as they do for a page.
`ArtifactCardRow` in the chat gets a canvas form (the title, "Canvas · 12
artboards").

### The wrapper page

The webview loads Zorvo's own page, `src-tauri/src/artifacts/canvas_shell.html`
plus its script, held in the binary; a test pins its SHA-256, as for
`page_script.js`. It is served at
`zorvo-artifact://localhost/canvas/<sessionId>/<canvasKey>/` with this CSP:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost;
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
sandbox allow-scripts
```

Zorvo's React side tells it what to show (the parsed canvas, which artboards
have pictures, the view) through `evaluate_script` on the main frame, the way
comment mode and marks reach a page today. The wrapper never receives a file
path, only keys and relative file names.

### Layout

Zorvo places the artboards: each section is a row, top to bottom, with its
title above it; artboards run left to right in the order of `canvas.json`,
80 px apart, and rows 160 px apart. A group's artboards are drawn together
with a shared label.

### Pan and zoom

The trackpad pans (two fingers) and zooms (pinch); dragging the background
pans. The header has Fit, 100%, zoom in, zoom out and a menu of the sections
that moves the view to one. Zoom runs from 5% to 200%. The view is kept per
canvas in memory, so Shrink and Expand do not lose it.

### Live artboards and pictures

An artboard is a live, sandboxed iframe (`sandbox="allow-scripts"`) only when
it is on screen, drawn at 25% zoom or more, and among the 8 such artboards
nearest the middle of the view. Every other artboard is its picture, or a
titled box while its picture is being made. The spike measured why: with
every visible artboard live, mounting them made one frame take 274 ms; with 8
live it took at most 42 ms, the median staying at 17 ms either way.

### Pictures

The backend makes an artboard's picture in a hidden WKWebView at the
artboard's size (no window, as the spike did), 720 px wide at most, one at a
time, under the same CSP and navigation rules as the viewer, and ends that
view's page with `_killWebContentProcess` like `view::end`. A picture is keyed
by the artboard key (`canvas::board_key`): the SHA-256 of the artboard's file's
hash, a digest of the folder's other servable files (each one's relative path,
size and modification time, no contents read; HTML pages and `canvas.json` left
out) and its width and height. So a changed artboard, a changed shared
stylesheet or a new size is drawn again, and the same key in a live frame's
`?v=` reloads it. A failure leaves the titled box and is not retried until the
key changes.

### Selecting and Focus

A click on an artboard's frame or title selects it: an outline and a bar with
its title and actions (Comment, Pick for a variant, Build this, Export).
**Focus** fits the selected artboard to the view, live, with Previous and Next
in canvas order. Inside a live artboard, clicks and hovers reach the page as
on a real screen, except in comment mode.

### Staying current

Zorvo reads `canvas.json` and the size and modification time of each artboard
file again when the agent calls `show_artifact`, when one of the session's
turns ends, and when the window comes to the front. A changed artboard's iframe
reloads and its picture is made again. An artboard whose file is gone shows
"File not found" in its box; a `canvas.json` that no longer parses keeps the
last good layout with a line saying why it could not be read.

## 4. Comments, Pick, Build this, Export

### Comments on an artboard

The artifact comments bridge carries over. `page_script.js` is added to every
frame (`with_initialization_script_for_main_only(script, false)`), and the
wrapper skips it for itself. A message from the page is matched to its
artboard by the frame's URL, which wry passes with every message
(`msg.frameInfo()`), never by what the message says; a message from a frame
that is not an artboard of the canvas on screen is refused. Everything else
in `picks.rs` stays: known kinds, field limits, picks only in comment mode, 5
picks a second, `FloodGuard` for every message.

A comment records the canvas key, the artboard id and the artboard key when it
was written. It reads Current while that key is unchanged and Outdated after; it never moves. Numbers run over the whole
canvas. Comment mode and marks reach an artboard through the wrapper, which
posts them to that frame (the spike's relay); wry offers no way to run a
script in one frame. Besides marking text or an element, the bar's Comment
writes a comment on the whole artboard.

The message names the artboard file relative to the session's folder:
"Comments on `design/checkout/pay-b.html` (Checkout, artboard Payment B)",
with the quote rules of artifact comments. As today, nothing reaches the
agent until Send.

### Pick

On an artboard with a `group`, Pick puts in the composer: "Use variant
Payment B (`design/checkout/pay-b.html`) from the Checkout canvas. Drop the
other pay variants: `pay-a.html`." The agent changes the files and
`canvas.json`. Zorvo stores no pick.

### Build this

On an artboard: "Build the Payment B screen from
`design/checkout/pay-b.html` (1440 × 900) in this repository." On a section's
title, **Build section** lists its artboards in order. Both go to the
composer; the user edits and sends.

### Export

- **PNG**: one artboard, or every artboard into a folder, named
  `<section>-<artboard>.png`, at 2× (Retina) size.
- **PDF**: one artboard, or the whole canvas as one PDF, one artboard per
  page at its own size, in canvas order. Pages are joined with PDFKit.
- The place is chosen in the save dialog. Export renders in the hidden
  WKWebView of the pictures, at full size, with the same CSP and navigation
  rules, and reports how many artboards it wrote and which failed.

## 5. Sandbox

Nothing about the artifact sandbox loosens. An artboard is a page in a
sandboxed iframe: opaque origin, no access to the wrapper (the spike read
`window.parent.document` and failed), no Tauri, no file outside the canvas
folder. Its CSP is `PAGE_CSP` with `zorvo-artifact://localhost` added to
`img-src`, `style-src`, `script-src` and `font-src`, so files of the canvas
folder load and nothing else new does. The navigation handler allows the
wrapper and the artboard URLs of the canvas on screen; the spike's attempt to
send an artboard to `https://example.com/` was stopped by the wrapper's
`frame-src` before it reached the handler. The protocol handler serves a file
only when it is in that canvas folder, inside a known workspace
(`files::ensure_known_workspace`).

## Spike results (2026-11-21)

A throwaway Swift probe (`2026-11-21-design-canvas-spike/Probe.swift`, kept
for the record, not built by anything) ran plain WKWebView, as wry uses it,
with a `zorvo-artifact` scheme handler, in a bundle launched with `open -n`
(a bare executable, or one launched by a shell, could not start WebKit's
content process). macOS 27.2, Apple silicon, backing scale 2.

**Script and messages in sandboxed iframes: works.** A user script added with
`forMainFrameOnly: false` ran in the wrapper and in all four artboard frames.
Each artboard's messages arrived with its own frame URL
(`zorvo-artifact://localhost/a/2/index.html`) and `isMainFrame: false`. A
folder image and CSS file, by relative path, loaded in every frame. A click
in one artboard arrived from that frame alone. `evaluateJavaScript(in:frame)`
reached one frame; a `postMessage` from the wrapper reached each artboard.
`window.parent.document` was not readable from an artboard.

**Pictures and PDF with no window: works.** An artboard 1440 × 900 gave a PNG
of 2880 × 1800 and a one-page PDF of 1440 × 900; one 1440 × 3000 gave 2880 ×
6000 and a 1440 × 3000 page; the chart drawn by a script and the folder image
were in both. The same in a borderless window off the screen. About 0.6 s
each, load included.

**Pan and zoom over 40 artboards** (a five-second scripted pan and zoom, each
artboard animating a chart):

| | median frame | 95th percentile | worst frame | frames over 33 ms | content process |
|---|---|---|---|---|---|
| every visible artboard live (20) | 17 ms | 18 ms | 274 ms | 3 | 40 MB |
| 8 live, the rest placeholders | 17 ms | 18 ms | 42 ms | 1 | 35 MB |

The window must be visible: covered, WebKit throttles `requestAnimationFrame`
and the page reports itself hidden (as the real-app harness already notes).

Not tried in the spike, and tested in the plan's first task: the same through
wry 0.57 (`with_initialization_script_for_main_only` and its IPC handler),
PDFKit joining pages, and pictures drawn while the canvas pans.

## 6. Code layout

- `src-tauri/src/artifacts/canvas.rs`: parsing and checking `canvas.json`,
  the canvas folder rules, the canvas key.
- `src-tauri/src/artifacts/canvas_shell.html` and `canvas_shell.rs`: the
  wrapper and its pinned hash.
- `src-tauri/src/artifacts/render.rs`: the hidden WKWebView for pictures and
  export (`objc2-web-kit` snapshot and PDF), PDFKit joining.
- `protocol.rs`: the canvas URLs and the folder's files; `view.rs`: the frame
  URL check for messages and the all-frames script; `store.rs`: canvases in
  the index; `commands.rs`: `canvas_show`, `canvas_read`, `canvas_export`,
  `canvas_thumbs`, events `canvas-changed`.
- `agent_tools/tools.rs`: `kind` on `show_artifact` and `artifact_guide`.
- Frontend: `lib/canvas.ts` (parsing the backend's answer, layout, which
  artboards are live, messages for Pick and Build), `hooks/useCanvas.ts`,
  `components/artifacts/CanvasViewer.tsx` and its header, canvas rows in
  `ArtifactsPanel` and `ArtifactGallery`, comment targets in
  `lib/artifact-comments.ts`.

## 7. Testing

- Rust: `canvas.json` (every field rule, limits, paths out of the folder,
  links), the files served and refused, a message from a frame that is not an
  artboard refused, the wrapper's hash, the canvas index, an export of a
  fixture artboard (PNG size, PDF page count and size).
- Vitest: layout, the choice of live artboards, comment status by hash,
  numbering over the canvas, the Pick and Build messages, the Tauri contract.
- Real app: a review build with a canvas of 40 artboards written by Qwen Code
  from the guide alone, checked for pan and zoom, comments, Pick, Build this,
  PNG and PDF export, and with a window covering it.

## 8. Order of work

0. Artboards on the "Zorvo redesign v2" canvas, a new section "Design
   canvas": the canvas in the inspector and expanded, a selected artboard
   with its bar, Focus, comment mode on an artboard, export, the Output row.
1. wry check: the all-frames script and frame URLs through wry 0.57; stop if
   it differs from the spike.
2. Format, storage and tools (`canvas.rs`, `kind`, guide).
3. Wrapper, protocol and viewer with layout, pan, zoom and live artboards.
4. Pictures.
5. Comments, Pick and Build this.
6. Export.
7. Docs and the real-app check.

## 9. Documents that change

`CLAUDE.md` (**Artifacts** and **Artifact comments**: the canvas kind, the
wrapper, the frame check), `README.md` (what a canvas is; nothing new reaches
the network), `CHANGELOG.md`, `src/lib/artifact-guide.md` (points to the
canvas guide), the artifacts spec's out-of-scope list.
