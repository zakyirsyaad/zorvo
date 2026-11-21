# Artifacts: pages an agent makes, shown in Zorvo

Date: 2026-11-16. Status: design, waiting for review.

## Goal

An agent can make a web page (a report, a diagram, a dashboard, a mockup) and
Zorvo shows it beside the chat. The user reads it, asks the agent to change it,
looks at older versions and saves it as a file. The model is Claude Code's
artifacts, without the hosting: an artifact stays on this Mac.

This spec is the foundation plus free-form HTML pages. A second spec will add
typed artifacts (a design canvas) on the same foundation.

## Decisions made with the user

- **Local, with export.** No server, no account, no URL. Export writes one
  `.html` file where the user chooses.
- **Scripts from an allow list of CDNs**, the same list Claude uses, so a page
  can use Tailwind, Chart.js, D3 or Mermaid. The main webview still makes no
  network request; only the artifact frame loads from those hosts.
- **Shown in an Artifacts tab of the inspector**, with a card in the chat and
  Expand / Shrink.
- **An artifact belongs to its session.** A gallery lists every session's
  artifacts. Deleting a session deletes its artifacts.
- **The agent hands over a file path**, not the page's text.

## Out of scope

Typed artifacts and the design canvas (the canvas now has its own spec,
`2026-11-21-design-canvas-design.md`), publishing to a URL, comments on an
artifact, a database or storage for pages, supporting files next to the page,
Markdown artifacts, artifacts in a popout window, artifacts for sessions that
get no Zorvo tools (compare runs, delegated sessions, sessions an agent
opened), links from a page to the outside, thumbnails in the gallery.

## 1. Sandbox

### What it protects

The page is written by an agent, which can be wrong or steered by text in the
repository. The sandbox guarantees the page cannot reach Zorvo: no Tauri
command, no state, no other artifact or session, no file on disk.

It does not try to stop an agent from leaking data. The same agent has a shell.
Two channels stay open and are accepted, as Claude accepts them: a page can put
data in the URL of a script request to an allowed CDN, and an exported file
runs with no sandbox at all.

### How a page loads

The page runs in a webview of its own, a child of the main window, placed over
the Artifacts tab's page area. The first spike showed that a frame inside the
main webview shares its process, so a page that loops freezes Zorvo; a second
webview has its own process. (The first design, a sandboxed `<iframe>`, is
kept below in the spike results only.)

1. **A child webview made with wry directly**, not through Tauri
   (`wry::WebViewBuilder … build_as_child(&main_window)`, the crate pinned to
   the version Tauri uses). Tauri never sees it, so it gets no IPC script, no
   invoke key and no message handler: there is nothing in it to call.
   It is made with a non-persistent data store (`with_incognito(true)`).
2. **A custom protocol on that webview only.** `zorvo-artifact` is registered
   on the child, not on the main webview. A URL is
   `zorvo-artifact://localhost/<sessionId>/<artifactId>/<version>`. The handler
   checks the shape of all three parts, answers only GET, and reads the stored
   copy from the data dir. Anything else is 404.
3. **The page's own CSP**, sent by the handler as a response header, with
   `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and
   `Content-Type: text/html; charset=utf-8`:

   ```
   default-src 'none';
   script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com;
   style-src 'unsafe-inline' https://fonts.googleapis.com;
   font-src https://fonts.gstatic.com data:;
   img-src data: blob:;
   media-src data: blob:;
   connect-src 'none'; frame-src 'none'; object-src 'none';
   form-action 'none'; base-uri 'none';
   sandbox allow-scripts
   ```

   `sandbox allow-scripts` gives the top-level page an opaque origin, so
   `localStorage` throws and two artifacts share nothing. No `'unsafe-eval'`.
4. **Navigation.** The child's navigation handler allows only
   `zorvo-artifact://localhost/`. It is the only barrier here (there is no
   parent CSP over a top-level page), and the spike showed it refuses
   `location`, a clicked link and a meta refresh. Links inside the page
   (`#section`) work.
5. **Zorvo's own CSP and `tauri.conf.json` do not change.**

**Placing it.** The main webview draws the tab and leaves an empty box where
the page goes. It measures that box and tells the backend, which moves the
child webview: `artifact_view_show(sessionId, artifactId, version, x, y, width,
height)`, `artifact_view_bounds(x, y, width, height)`, `artifact_view_hide`,
`artifact_view_close`. The numbers are window points; the backend refuses
anything not finite or outside the window. There is one child webview at a
time, in the main window only. **Reload** closes it and makes a new one, which
is also how a stuck page is ended; leaving the tab, the session, or closing
the inspector closes it.

**A native layer.** The child webview draws above the main webview's HTML, so
nothing of Zorvo's can be drawn over the page. While a menu, a popover, a
dialog or a toast would overlap the page's box, the child is hidden
(`artifact_view_hide`) and the box shows the sheet's own fill; it comes back
when the overlay closes. The viewer's own version menu, ⋯ menu, export panel
and delete question all do this.

**Comments.** Comments on a page are their own spec,
`2026-11-17-artifact-comments-design.md`. They add a script of Zorvo's own to
the child webview through `with_initialization_script`, not to the served body,
and a message handler that carries data only (never a command). The handler
still serves the stored bytes unchanged, and export always writes them.

A page cannot open a window, download a file, show an `alert`, or keep anything
between two openings.

### Spike: the gate before any other code

Reading the sources of Tauri 2.12.5 and wry 0.57 says the IPC scripts are
injected in the main frame only, and that the navigation handler is called
without a main-frame filter. That is reading, not proof. Step 0 of the plan is
a throwaway build that shows, in the real WKWebView:

1. **IPC is out of reach** from the frame: `window.__TAURI_INTERNALS__` is
   undefined, `fetch('ipc://localhost/…')` is refused, and a message posted
   straight to `window.webkit.messageHandlers.ipc` runs no command.
2. **Navigation out is refused**: `location.href = 'https://example.com'`,
   a clicked link and a `<meta http-equiv="refresh">` load nothing in the frame.
3. **Common libraries work** under the CSP above: Tailwind's CDN build,
   Chart.js, D3, Mermaid, and a Google Font.

4. **A page that never yields** (`while(true){}`): whether Zorvo's own
   interface stays usable, since WKWebView may run the frame in the page's
   process.

If 1 fails, or 4 freezes the app, this design stops and goes back to the user
with an alternative (a separate webview for artifacts). If 2 fails, it is
recorded here as a known hole. The result of 3 fixes the CSP text. The check of 1 stays afterwards as a
permanent real-app test.

### Spike results (2026-11-16)

Run on a debug build with the production CSP (Tauri 2.12.5, wry 0.57, macOS
WKWebView), a throwaway branch `spike/artifacts-sandbox`. Each page reported
through `postMessage`; the log is the evidence.

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | IPC out of reach | **Pass** | `__TAURI_INTERNALS__`, `__TAURI__` and `window.ipc` are undefined in the frame. `fetch('ipc://…')` fails under the page CSP, and without it Tauri answers 500 "Origin header is not a valid URL". `window.webkit.messageHandlers.ipc` **is** reachable from the frame, and a hand-built invoke posted to it was refused only because it did not carry the invoke key; the command never ran. |
| 2 | Navigation out refused | **Pass** | `location.href`, a clicked link and a meta refresh to `https://example.com` all loaded nothing; the page was still there 3.5 s later. Zorvo's own `frame-src zorvo-artifact:` refused them (a `frame-src` violation each time), before the Rust handler was asked. The handler is called for the frame's own loads, so it stays as a second layer. |
| 3 | Libraries without `unsafe-eval` | **Pass** | Tailwind's CDN build applied its classes; Chart.js, D3 and Mermaid drew; lodash and jQuery loaded; a Google Font loaded. No CSP violation but the expected one for `fetch` (`connect-src`). `localStorage` throws `SecurityError`, as designed. The CSP text stands as written. |
| 4 | A page that never yields | **Fail** | The frame runs in the main page's web content process. From the moment the page entered `while(true){}` the main interface stopped completely (its 500 ms timer never fired again in 68 s) until the app was killed. |

What follows from them:

- The invoke key, kept in the main frame, is the only thing between a page and
  Tauri's message handler. Nothing may ever inject Tauri's scripts or the key
  into a frame (`initialization_script_for_all_frames` is forbidden), and the
  real-app test of 1 is permanent.
- Navigation URLs seen on a normal start: `tauri://localhost`, `about:blank`,
  `zorvo-artifact://localhost/…`.
- Result 4 stopped the frame design: a sandboxed frame cannot protect Zorvo's
  interface from a page that loops. The user chose a separate webview inside
  the window; the second spike below tested it.

### Second spike: the child webview (2026-11-16)

Same build and pages, with the page in a wry child webview and a ping from
Rust to the main page every 500 ms.

| Question | Result | Evidence |
| --- | --- | --- |
| IPC out of reach | **Pass** | `__TAURI_INTERNALS__`, `window.ipc` and `window.webkit` are all undefined in the child; there is no handler to post to. |
| Navigation out refused | **Pass** | The handler was asked for each of the three ways and refused; the page was still there 3.5 s later. |
| Libraries | **Pass** | As in the first spike, also with `sandbox allow-scripts` in the CSP. |
| Storage | **Pass after a fix** | Without the `sandbox` directive the page's origin was `zorvo-artifact://localhost` and `localStorage` worked. With it the origin is `null` and it throws `SecurityError`. |
| A page that never yields | **Pass** | The main page answered all 16 pings during 8 s of `while(true){}` in the child. Closing the child and opening another worked. |
| Moving it | **Partly** | `set_bounds` succeeded and reported the new rectangle. **Not seen on screen**: the spike window was behind another window, so where it draws, how it follows a resize, the native layer over HTML, focus and scrolling are unverified until Task 8 checks them in a build in front. |

**Found in the final review, then measured (2026-11-16):** closing the child
did not end a looping page. wry keeps the `WKWebView` alive when its own view is
dropped, so the page's web content process went on at 98% of a core, 16 s after
the close, until the app quit. WebKit has no public call that ends the process
of a page that does not yield. The view is therefore ended by sending the
`WKWebView` `_killWebContentProcess`, only when it answers that selector; with
it the process was gone within 13 s, the main page kept answering pings, and a
new page opened. On a macOS where the selector is missing the page is only
hidden, as before.

**Seen on screen (2026-11-16)**, in a review build with its own identifier and
seeded pages: the page draws exactly in its box (markers in the page's four
corners sat on the box's corners); it follows a window resize and Expand /
Shrink; it scrolls; keyboard focus goes into a field of the page and back to
the composer; the version menu, the ⋯ menu and the export panel hide it and it
returns; it is not drawn over Settings or the gallery and returns after them; a
looping page left Zorvo usable, and going back to the list ended its process.
Three faults were found and fixed: a new webview flashed white in a dark window
before the page painted (the view is now made invisible and shown when the page
has loaded, or after 3 s); the page's square corners covered the sheet's
rounded bottom corners (the box now ends a panel radius above the sheet's
edge); and the version menu cut "Version 2" short beside a long date (short
dates, a wider menu). Not seen: a 2× / 1× display change, the inspector's own
resize handle (the drag did not take), and a toast over the page. A page's own
state (a typed field, a scroll position) was lost on Expand and Shrink at
first, since each made a new view. It is kept now: the one view is shared by
every box (`claimed` and `live` in `useArtifactView.ts`), a box that leaves
only gives up its claim, and the view is closed only when no box claimed the
page by the time the close's turn comes in the queue. The box that arrives
with the same session, artifact and version moves the view to itself
(`artifact_view_bounds`). Reload still makes a new view. Seen on screen on
2026-11-17 with a page Codex wrote: a note typed in the page and its scroll
position stayed through Expand and then Shrink.

Real agents, same day, review build: Codex (codex-acp 2.2.2) called
`artifact_guide`, wrote the page to a temporary folder and called
`show_artifact`; the tab opened by itself, and a second `show_artifact` for
the same path gave "Version 2 of 2" and a second card. Qwen Code 0.25.2 did
the same in its Default mode, asking permission for each tool call. Google
Antigravity could not be tried: the catalog offered it only from 23 November
(the 7-day rule for a newly listed version).

Also learned: a window behind another has its page timers throttled, so a
real-app test must not time anything with timers in the page.

## 2. Tools

Two tools join the five in `agent_tools/tools.rs`. Both are answered by the
webview through the existing `agent-tool-call` path, need no grant and show no
permission card. A session gets them exactly when it gets the other tools
(`sessionGetsAgentTools`, the **Agent tools** setting). Pi uses them as
`zorvo tools show_artifact …`, and `COMMAND_PATH_CONTEXT` names both.

### `show_artifact`

| Argument | Rule |
| --- | --- |
| `path` | Required. An `.html` or `.htm` file the agent has written. At most 4096 characters. |
| `title` | Required the first time a path is shown, optional later (it renames). At most 60 characters, cleaned with `escapeVisible`. |

The same path is the same artifact: a second call for it makes a new version, a
different path a new artifact. The answer is JSON with the title, the version
number and `shown: true`. Its description holds the hard rules (one
self-contained HTML file, the CDN list with exact versions, no `fetch`, images
as data URIs) and tells the agent to call `artifact_guide` before its first
page.

### `artifact_guide`

No arguments. Returns Zorvo's own design system, written for a page, so a page
looks like part of Zorvo whichever agent wrote it. Every agent gets the same
text: Claude Code, Codex, Qwen Code and Antigravity through the MCP server, Pi
through `zorvo tools artifact_guide`. The text ships with Zorvo
(`src/lib/artifact-guide.md`, imported as text) and is written for Zorvo, not
copied.

What it holds:

1. **A block to paste.** A `:root` block with Zorvo's colour tokens as CSS
   variables under their names in `docs/design-system/tokens.json` (`--sheet`,
   `--fg-muted`, `--border-strong`), light values in `:root` and dark values in
   `@media (prefers-color-scheme: dark)`, plus `--radius-md`, `--radius-lg`,
   `--radius-panel`, `--font-sans` and `--font-mono`. Only the tokens a page
   needs: `sheet`, `ground`, `surface-2`, `surface-hover`, `chip`, `border`,
   `border-strong`, `fg`, `fg-secondary`, `fg-muted`, `fg-subtle`, `primary`,
   `on-primary`, `focus-ring`, the status colours (`status-running`,
   `status-attention`, `status-unread`, `status-merged`, `danger`),
   `danger-surface`, `attention-surface`, `attention-border`, `diff-added`,
   `diff-removed` and `selection`. Not the terminal, overlay or old surfaces.
2. **Type.** Zorvo's sans stack (`-apple-system, BlinkMacSystemFont, …`), which
   on a Mac is the face Zorvo's interface uses and needs no download. Geist
   Mono for code, with the Google Fonts link to add; without it the stack falls
   back to SF Mono. The app styles' sizes (`title` 20/28 600, `heading` 16/24
   600, `body` 14/22, `ui` 13/18, `caption` 11/16).
3. **Surfaces and text.** The page's background is `sheet` (the box it sits in
   is a sheet); cards are `surface-2` with a `border` edge and `radius-lg`;
   wells (code, a table's header band) are `ground`; tags are `chip`. Headings
   `fg`, body `fg-secondary`, labels `fg-muted`, hints `fg-subtle`. One
   `primary` action at most.
4. **The rules from `docs/design-system/README.md` that a page can break.**
   Monochrome; status colours only for a state and always next to a word;
   sentence case; no emoji, no exclamation marks.
5. **Charts and diagrams.** Series in the grey steps (`fg`, `fg-muted`,
   `fg-subtle`, `border-strong`), labelled on the chart or with a legend; a
   status colour only when a series is a state (passed, failed). More than four
   series: label them directly or split the chart. Text on a chart stays
   readable in both themes, so it uses the tokens, never a library's default
   colours. Inline SVG for diagrams.
6. **Tailwind.** For a page that loads Tailwind's CDN build, a
   `tailwind.config` snippet that maps the same names to the variables, so
   `bg-sheet`, `text-fg-muted` and `border-border-strong` mean what they mean
   in Zorvo.
7. **Limits.** One self-contained file with a `<title>`; a layout that holds
   from 320 px (the inspector's narrow width) to expanded, with no horizontal
   scroll; the CDN list with exact versions; no `fetch`, no `localStorage`, no
   links that leave the page.

**Why a block to paste and not a stylesheet Zorvo adds.** Export writes the
stored bytes, and the served body is kept for the comments script (see "Room
for comments later"). A page styled by something Zorvo injects would lose its
colours once exported. With the tokens in the file, the page is the same in
the tab and in a browser.

**Kept in step with the app.** `src/test/artifact-guide.test.ts` reads the
guide's `:root` and dark blocks and fails when a variable's value differs from
the light or dark value of the token of the same name in `tokens.json`, when a
token in the list above is missing, or when `--font-sans` or `--font-mono`
differs from `type.families`. `design-system-docs.test.ts` already ties
`tokens.json` to `globals.css`, so a colour changed in the app fails until the
guide follows.

**The theme.** The page follows `prefers-color-scheme`. Zorvo's Appearance
setting (System, Light, Dark) goes through Tauri's `setTheme`, which sets the
appearance for the whole app, and the child webview is expected to follow it.
Task 11's real-app check confirms it with Appearance set against the Mac's
own; if the child does not follow, the backend sets the child view's
appearance to match whenever the setting changes.

**What it does not guarantee.** It is guidance, as Claude's is: an agent can
ignore it, and Zorvo never rewrites a page. The guide is tested with real
agents (Claude Code, Codex, Antigravity) and revised from what they produce;
that revision is part of the work.

### Checks on the path, in Rust

The webview answers `show_artifact` by calling
`artifact_show(sessionId, cwd, path, title)`. The backend:

1. checks `cwd` with `files::ensure_known_workspace`, and the session id's
   shape (`[A-Za-z0-9_-]`, 1 to 80 characters);
2. resolves `path` against `cwd` and canonicalises it; it must lie inside the
   canonical session folder or a temporary folder (the canonical
   `std::env::temp_dir()` or `/private/tmp`);
3. reads only a regular file, judged from its metadata, with an `.html` or
   `.htm` name, at most 16 MiB (bounded read), valid UTF-8.

A refusal is a fixed sentence for the agent and never repeats the path.

## 3. Storage

The backend owns artifacts completely; nothing about them is in `state.json`,
so `STATE_VERSION` stays 2 and the main window's role as the only writer of
state is untouched.

```
<data dir>/artifacts/<sessionId>/
  index.json                       the session's artifacts
  <artifactId>/<version>.html      a stored copy, mode 0600
```

`index.json` lists, per artifact: `id` (random, made by the backend), `title`,
`sourcePath` (canonical), and `versions` (`n`, `at`, `bytes`, newest last).
Every write is atomic (write, then rename): the page first, then the index. One
lock per session orders the writes.

Rules:

- Content equal to the newest version makes no new version.
- An artifact keeps its newest 20 versions and at most 64 MiB in all; older
  versions go first, the newest always stays.
- A session holds at most 50 artifacts; the next one is refused with a reason.
- Version numbers never repeat within an artifact.

Commands (all `#[tauri::command(async)]`): `artifact_show` (above; returns the
artifact with its new version), `artifact_list(sessionIds)` (each session's
index, for the tab and the gallery), `artifact_rename`, `artifact_delete`,
`artifact_delete_session` and `artifact_export`. Each change emits
`artifacts-changed` (`{ sessionId }`).

Lifecycle: archiving a session keeps its artifacts; deleting it calls
`artifact_delete_session`. At start, on its own thread, the backend removes
artifact folders whose session id is not in `state.json` and that are over a
day old.

## 4. Screens

Copy is sentence case. No keyboard shortcuts. Look follows the v2 surfaces and
`components/ui/` primitives. The canvas "Zorvo redesign v2" has four artboards
for these screens (section 10: `ArtifactsMain`, `ArtifactsGallery`,
`ArtifactsInspector`, `ArtifactsStates`), with local copies in
`2026-11-16-artifacts-artboards/`. They decide look and wording; this spec
decides behaviour. The page inside the viewer is a stand-in drawn as markup, and a board that
shows a menu or a question over the page's box shows that box empty, as the
app does (see "A native layer").

### Artifacts tab

Offered only while the session has an artifact, main window only.

- **Tab strip**: Artifacts sits between Files and Terminal, with the number of
  artifacts. Five tabs need about 370 px, so the strip's tabs use 8 px side
  padding (they fit the default 380 px inspector), and below that width the
  strip scrolls sideways; no tab is hidden or cut.
- **List**: title, version, time. A click opens the viewer in the list's place,
  as the file viewer does. A session with one artifact opens straight on it.
- **Viewer**: the page's box fills the tab and the inspector widens like the
  Terminal tab. Its header has Back, the title, a version menu ("Version 3 of
  5"; an older version is marked as older), **Reload**, **Expand** / **Shrink**
  (the page takes the chat's place and comes back), **Export**, and a ⋯ menu
  with **Rename** and **Delete artifact** (which asks first).

### When the agent calls the tool

- A **new artifact** in the session on screen: the inspector shows the
  Artifacts tab on it. Typing focus stays in the composer.
- A **new version** of the artifact the viewer shows: the page is replaced in
  place.
- Anything else: nothing moves. Zorvo never switches sessions for an artifact.

### Card in the chat

At the call, the chat gets a row Zorvo makes: the title, "Version 2" and
**Open**, which shows that version. A card whose artifact was deleted reads
"Removed". Rewinding removes the card with its message; the artifact stays.

### Gallery

**Artifacts** in the sidebar, a row under New session and above the filter,
with the number of artifacts and shown while any session has one, opens a page
in the chat's place: every artifact
of every session, newest first, with a search by title. A row shows the title,
the session's name, the agent and the time; an archived session's artifacts are
marked. A click selects the session and opens its tab. It is derived from
`artifact_list` joined with the sessions; it stores nothing.

### Export

`artifact_export(sessionId, artifactId, version)` opens the macOS save dialog
from Rust and writes the stored copy, byte for byte, to the place chosen. The
webview sends no destination. **Export** first opens a small panel under its
button: "Export this page", then "Saves Version 3 as one HTML file. An exported
page opens in a browser without Zorvo's limits.", with **Cancel** and **Choose
where to save**; only the second calls the command.

### Other states

A version whose file is gone says it is no longer on this Mac, never an empty
frame. A broken or blank page is shown as it is. A failed command becomes a
notice in plain words, never a path or an error from the backend.

## 5. Code layout

- Rust: `src-tauri/src/artifacts/` (`store.rs`, `source.rs` for the path
  checks, `protocol.rs` for the scheme and its CSP, `commands.rs`), two entries
  in `agent_tools/tools.rs`.
- Frontend: `lib/artifacts.ts` (pure rules: gallery order, card text, limits'
  wording), `hooks/useArtifacts.ts`, `components/artifacts/` (`ArtifactsPanel`,
  `ArtifactViewer`, `ArtifactCard`, `ArtifactGallery`), the two answers in
  `useAgentTools`, an `artifacts` tab in `useInspector`.

## 6. Testing

- **Rust unit**: the path rules (inside the session folder and the temporary
  folder accepted; outside, a symlink that leaves, a pipe, another extension,
  over 16 MiB, invalid UTF-8 refused); versions (equal content, the 21st
  version, the 64 MiB cap); the protocol (bad ids are 404, and a test pins the
  CSP text so loosening it is a visible change); the start-up sweep.
- **Rust integration**: `tools/list` offers the two tools; the fake agent as
  an MCP client through a real bridge (`FAKE_ACP_MCP_CALL`) and through
  `zorvo tools` gets the call parked and answered.
- **Vitest**: `lib/artifacts.ts`; opening rules (a new artifact shows the tab,
  a new version does not change tabs, another session is never selected); the
  card; the gallery. The Tauri contract test covers the new commands and the
  `artifacts-changed` event.
- **Real app**: with the existing harness and the build in front, a page shows
  in its box and follows a resize and Expand, a CDN script runs, `fetch` is
  blocked, the IPC attempts of the spike find nothing to call, a looping page
  leaves Zorvo usable and Reload ends it, and a menu over the box hides the
  page. Nothing in it is timed by a timer in a page.

## 7. Order of work

| # | Step | Done when |
| --- | --- | --- |
| 0 | Sandbox spike | The three questions have evidence; the code is thrown away |
| 1 | Backend | Store, path checks, protocol with its CSP, sweep, export |
| 2 | Tools | `show_artifact`, `artifact_guide`, Pi's command path |
| 3 | Screens | Tab, viewer, versions, chat card, opening rules |
| 4 | Gallery and guide | Gallery page; the guide revised from real agents' pages, its tokens kept equal to `tokens.json` |

## 8. Documents that change

`src-tauri/Cargo.toml` (wry as a direct dependency, pinned), the README's privacy section and CLAUDE.md
(the artifact's own webview loads scripts and fonts from the listed hosts; the main
webview still makes no request), `CHANGELOG.md` under `Unreleased`.
