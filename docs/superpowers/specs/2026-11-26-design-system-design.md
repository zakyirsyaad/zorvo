# Design systems per project: made by an agent, shown and used by Zorvo

Date: 2026-11-26. Status: design, waiting for review.

## Goal

A project keeps its design system as files in its own folder: a brand book,
tokens with their themes, components with live previews, and its assets. Any
agent Zorvo hosts can make one, from the project's code or from brand
references the user gives it, and reads it before it designs a page or a
canvas. Zorvo shows it beside the chat in the Artifacts tab, the user comments
on a token, a component or a passage of the brand book, and a canvas that
names the system loads its tokens, with a Theme menu that switches every
artboard.

The model is Claude Design's Design System type (now an Artifact type in
Claude), studied on 2026-11-26: a `README.md` brand book, a `tokens.json` of
lists, `components/<Name>/README.md` and `preview.html`, and assets. Zorvo's
own `docs/design-system/` already has that shape and is published to a Claude
design system from it. This spec gives Zorvo its own viewer for the same file
shape, never Claude's runtime files.

It is the "design systems per project and templates (their own spec)" the
canvas spec (`2026-11-21-design-canvas-design.md`) left out of scope, and it
builds on the shared design rules agents already read (`src/lib/design-craft.md`,
pull request zakyirsyaad/zorvo#352).

## Decisions made with the user

- **Both sources from the start:** a system made from the project's code
  (global stylesheet, Tailwind config, components) and one made from brand
  references the user gives (logo, colours, fonts, pictures).
- **A system is any folder holding `design-system.json`**, in the project, in
  git. A project may hold several; one can be its default.
- **The user looks and comments; the agent edits the files.** Zorvo writes no
  file of the system.
- **Zorvo serves the system to a canvas:** it builds `tokens.css` from
  `tokens.json`, the canvas names the system in `canvas.json`, and a Theme menu
  switches every artboard.
- **A system made from code records its source** (paths and commit); Zorvo
  marks it as possibly out of date when those files changed, and **Sync again**
  puts a message for the agent in the composer.
- **Approach: a separate webview, like the canvas.** Chosen over a React view
  in the main webview (component previews could not run their scripts) and
  over showing the system as a canvas (the brand book has no place on
  artboards). The user asked to review every section of the design before the
  next one; the corrections those reviews found are part of this spec.

## Out of scope

Editing tokens inside Zorvo, export or sync to Claude Design, a design system
in a popout window, `_ds/` for motion compositions, looking for systems in the
folders above the session's folder, a system shared across projects, visuals
(`show_visual`) that use a project's system (they keep the chat's tokens), and
keyboard shortcuts (the user declined them for Zorvo).

## 1. Format

### A system is a folder with `design-system.json`

| path in the folder | what | required |
| --- | --- | --- |
| `design-system.json` | the index | yes |
| `README.md` | the brand book; every reader starts here | yes |
| `tokens.json` | the tokens | no |
| `components/<Name>/README.md`, `preview.html` | a component's guideline and live preview | no |
| `components/bundle.css`, `bundle.js`, `index.d.ts`, `lib/*.js` | shared styles, a classic script that assigns `window.<namespace>`, types, libraries | no |
| `assets/<Group>/<file>` | logos, icons, pictures, PDF, video, as plain files | no |
| `fonts/<file>` | font files | no |
| other `*.md` outside `components/` | further sections of the brand book, at most 24 | no |

Claude keeps a system's pictures as uploads in its own asset store; Zorvo
keeps them as files, so git has them. A system downloaded from Claude opens
with its README, tokens, components and stylesheet; an asset its index names
that is not in the folder shows as "Not in this folder" in the viewer.

### `design-system.json`

The index has Claude's shape, so a system made in Zorvo can be uploaded to
Claude unchanged and one made in Claude opens in Zorvo:

```json
{
  "v": 3,
  "layout": "files",
  "createdOnFiles": { "v": 1, "at": "2026-11-26T10:00:00Z" },
  "title": "Acme",
  "namespace": "Acme",
  "libraries": [],
  "sections": {},
  "groups": [],
  "assetGroups": {},
  "blobs": {},
  "docs": { "sections": [] },
  "zorvo": { "default": true }
}
```

- Zorvo reads `title` (required, 1 to 120 visible characters; escaped with
  `escapeVisible` and put in backticks wherever an agent reads it),
  `namespace` (optional, the `bundle.js` global, `[A-Za-z_][A-Za-z0-9_]{0,63}`),
  `libraries` (optional, the names previews load; for `react` and `react-dom`
  the version given is ignored, since Zorvo pins 18.3.1), `groups` and
  `assetGroups` (optional, the order of asset groups only) and
  `zorvo.default`.
- Every other field is ignored, never refused, so Claude's own fields and a
  later version's pass through. The file is at most 256 KiB of UTF-8 JSON.
- `zorvo` is a namespaced key Claude's page keeps; it marks the project's
  default system. Publishing `docs/design-system` to Claude therefore keeps
  the Claude page working (an index without `createdOnFiles` would open it
  read-only).

### `tokens.json`

The grammar is Claude's, read leniently:

- Every family but `type` is `{"tokens": [{"name", "value", "usage"}]}`, and
  may carry other keys (such as a `note`), which are ignored. `color.themes`
  (`[{"id", "name"}]`, the first is the primary; ids `[A-Za-z0-9_-]{1,32}`, a
  bad id is dropped with its reason) names the themes for **every** family: in
  any family a value is a string (every theme) or an object by theme id, and a
  token missing a theme inherits the first theme's value. With no
  `color.themes`, there is one theme, `default`.
- `type` holds `fonts` (`family`, `file` under `fonts/`, `weight`, `style`),
  `families` (name to CSS stack) and `groups` of `styles` (`name`, `fontSize`,
  `lineHeight`, `fontWeight`, optional `letterSpacing`, `family`).
- Names are `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`, each used once across every
  family but `type`.
- Values by family:
  - `color`: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()`,
    `lab()`, `lch()` with no function inside, or an alias `"{other-token}"` of
    a colour token that exists;
  - `spacing`, `radius`, `size`: a length (`px`, `rem`, `em`, `%`) or a number;
  - `shadow`: lengths, colours as above, `inset` and commas, nothing else;
  - `motion`: a time (`ms`, `s`), `cubic-bezier()` of four numbers, or one of
    `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`;
  - any other family: printable text without `;`, `{`, `}`, `<`, `\`,
    `url(`, `var(` or `expression(`, since it lands in a stylesheet.
- A value Zorvo cannot read drops that token, never the system. Each drop has
  a reason (`named colour`, `var()`, `color-mix()`, `missing alias`,
  `alias of itself`, `duplicate name`, `bad length`, `no value`), the viewer
  lists them ("2 tokens could not be read: `brand` (var())"), and
  `artifact_guide` repeats them to the agent.
- A name-to-value map (the W3C token format) reads as an empty family with the
  reason `not a list`.
- `meta.source`, optional, says where the system came from:
  - `{"kind": "code", "paths": ["src/styles/globals.css"], "commit": "a1b2c3d"}`,
  - `{"kind": "references", "files": ["brand/logo.svg"]}`,
  - and the shape `docs/design-system/tokens.json` already uses: `meta.source`
    is a string (`"github"`) with `meta.ref` (`"main@8b5a02f"`) and
    `meta.paths` (`{"tokens": [...], "brand": [...]}`) beside it, read as kind
    `code`: the commit is the part of `ref` after `@`, the paths are every
    array in `paths`.
  - Paths in `meta.source` are relative to the repository root.
- At most 1 MiB.

### Finding systems

- Zorvo looks for `design-system.json` in the session's folder and its
  subfolders, at most 4 levels deep, skipping `node_modules`, `.git`,
  `target`, `dist` and hidden folders, reading at most 5,000 entries, and
  keeps at most 20 systems. Each folder is read in name order, so a large
  project always stops at the same entries. A folder that is a symbolic link
  is never followed.
- Each system's key is derived, not issued: `d-` and 16 hex characters of the
  SHA-256 of its canonical folder. The same folder always has the same key,
  whether or not it was shown, so a canvas can name a system that was never
  shown and the frontend can still key its theme by it.
- The search starts at the session's folder, never above it: the repository
  root is not always a known workspace (`ensure_known_workspace`), so a session
  in a subfolder does not see a system at the repository's root. Said plainly
  to the agent and in the README.
- **The default** is the system whose index has `zorvo.default: true`; with
  exactly one system and none marked, that one. Two or more marked, or several
  with none marked: no default, and the agent and the viewer get one line that
  names them.
- A cloned repository's system is untrusted data: its README and tokens are
  shown and read as data, never as instructions (the guides say so).

### Limits

`README.md` and each other section at most 256 KiB, at most 400 components,
each served file at most 16 MiB (as for a canvas), each folder read through
`read_bytes_checked`.

## 2. Tools

No new tool: two existing tools take a new kind, and `canvas.json` takes one
field.

### `artifact_guide` with `kind: "design-system"`

Returns `src/lib/design-system-guide.md`, imported as text:

- the format of section 1, with a complete small example;
- **from code:** enumerate every token in the global stylesheet or the
  Tailwind config before writing, copy exact values, give every token a
  `usage`, copy logos and fonts as files, and record `meta.source` with the
  paths and `git rev-parse --short HEAD`;
- **from references:** copy the logos, pictures and fonts the user gave into
  `assets/<Group>/` and `fonts/`, use only colours and fonts the user named or
  that are in their files, and make a small first system (6 to 10 colours,
  5 to 7 text styles, 4 spacing steps, 3 radii) when there is little to go on;
- the README as a brand book (voice and copy, visual foundations, iconography,
  usage rules that name tokens), and the preview rules (line 1
  `<!-- @dsCard group="Actions" height=120 -->`, a small document that shows
  the component, no network);
- the index in Claude's shape, with `zorvo.default` when the user wants it as
  the project's default;
- last, `show_artifact` with `kind: "design-system"`.

It ships with the viewer (section 6, step 2), never before, so the guide never
names a kind the tool does not take yet.

### The systems a folder holds, in every design guide

Every `artifact_guide` answer for `page`, `canvas`, `motion` and
`design-system` ends with one line the webview asks the backend for
(`design_systems_list(sessionId)`): "Design systems in this folder:
`docs/design-system` (Zorvo, default). Read its README.md and tokens.json
before you design." With none: "No design system in this folder." A failed
search leaves the line out and never refuses the guide. `visual` gets no line:
a visual keeps the chat's colours.

### `show_artifact` with `kind: "design-system"`

- `path` is the system's folder or its `design-system.json`, inside the
  session's folder (never a temporary folder).
- The answer gives the system's key and counts ("Shown: Acme, 42 tokens,
  12 components. 2 tokens could not be read: ...").
- `store.rs` records it in `design-systems.json` beside `canvases.json`
  (`DesignSystemEntry`: the derived `d-<16 hex>` key, the canonical folder,
  its path relative to the session's folder, the title and counts last read,
  when it was shown; 50 a session). `artifact_list` returns these entries
  beside the canvases and marks the session `failed` when `design-systems.json`
  cannot be read, as it does for `canvases.json`. Zorvo keeps no copy
  of the files; deleting the session or **Remove** forgets the entry only.
- Refusals are fixed sentences mirrored in `lib/design-systems.ts`
  (`DESIGN_SYSTEM_REFUSALS`, kept equal to the Rust by a test): no or an
  unreadable `design-system.json`, no `README.md` beside it, a folder outside
  the session's folder, a file over its limit. None repeats the path's
  contents.

### `designSystem` in `canvas.json`

- An optional top-level string, in version 1 (`parse_canvas` learns it; a
  canvas without it is unchanged): the system's folder relative to the canvas
  folder, such as `"../../docs/design-system"`. An older Zorvo refuses a canvas
  that has it (`only_known`), which is acceptable since the app updates itself.
- `parse_canvas` reads bytes only, so it checks the syntax alone: a relative
  path of 1 to 512 characters with no NUL, no leading `/` and no `\`; anything
  else is refused with its field (`designSystem: ...`).
- Whether the path stays inside the session's folder after canonicalising and
  holds a `design-system.json` is checked when the canvas is read and on every
  `_ds/` request. A path that fails is not a refusal: the canvas shows with a
  header line (section 4, "A system that is gone").
- It is written explicitly: the canvas guide tells the agent to set it to the
  default system. Zorvo never links a system by itself, so an older canvas
  keeps its look.

### Telling agents

The descriptions of `show_artifact` and `artifact_guide` in
`agent_tools/tools.rs`, `MCP_PATH_CONTEXT` and `COMMAND_PATH_CONTEXT` each gain
one sentence: "To make or update a design system, call artifact_guide with
kind design-system." Qwen Code loads tools on demand and does not read their
descriptions first, so the context note must say it.

A one-file page is unchanged: it cannot load files, so the agent copies the
token values into its `<style>`.

## 3. Viewer

### Where it shows

A row in the Artifacts tab and the gallery (title, "Design system", the token
and component counts), and a chat card (`ArtifactCard` kind `design-system`)
whose Open shows it. The viewer is the same shared child wry webview as a page
and a canvas (`claimed` and `live`, the call queue, `useBoxCovered`, Expand and
Shrink), as `ShownView::DesignSystem`. The header is React, outside the box,
like `CanvasHeader`: the title and path, **Theme** (section 4), **Comment**
(section 5), the out-of-date line and **Sync again** (section 5), and
**Show in Finder**.

### The shell

- Zorvo's own `ds_shell.html` (`ds_shell.rs`) at
  `zorvo-artifact://localhost/ds/<session>/<key>/`. A test pins its SHA-256 and
  that it names no `http` address; its colours are the app's tokens, dark with
  a `prefers-color-scheme: light` set, and a test fails on a colour
  `tokens.json` does not hold, as for the canvas shell.
- `DS_SHELL_CSP`: its own inline script and style, images, fonts and frames
  only from the scheme, fonts also from `fonts.gstatic.com`, stylesheets from
  `fonts.googleapis.com`, nothing in `connect-src`, `sandbox allow-scripts`.
  The shell file itself names no `http` address: the Google Fonts stylesheet
  URL for the system's hosted families is built in Rust and handed over in
  `ds_view_apply`, and the shell adds the `<link>`.
- The shell never gets a path. React hands it what to show with
  `ds_view_apply` (one JSON object of at most 1 MiB, written out again by serde
  before `evaluate_script`, kept and run again when a new view of that system
  loads), as `canvas_view_apply` does. When the object would pass 1 MiB, the
  last markdown sections are left out and the viewer says so.
- The view loads the shell once and then only that system's files
  (`DesignSystemNavigation`); the protocol serves a file only for a remembered
  system whose folder is inside a known workspace.

### What Rust prepares

`ds_read(sessionId, key)`, after `ensure_known_workspace`:

- the index fields of section 1 and the tokens, normalised, with the dropped
  ones and their reasons;
- the components (name, group and height from the `@dsCard` line, whether a
  README and a preview exist, the preview file's hash), grouped by their
  `@dsCard` group in the order a group is first seen, then by name (the index's
  `groups` orders asset groups only);
- the assets and fonts, each marked when missing from the folder;
- the README and the other sections rendered to HTML in Rust with
  `pulldown-cmark` (a new dependency, MIT, pinned with `=` like `ammonia`) and
  cleaned with `ammonia` (as for visuals): no script, no handlers, no `name`
  attribute, every `id` prefixed `ds-u-` (and every `#fragment` link with it),
  so the README cannot clobber the shell script's globals; no `href` but such
  a `#fragment`; an `<img src>` kept only when it names a file inside the
  system, rewritten to the scheme.

### Reading it again

The viewer runs `ds_read` again on `artifacts-changed` (emitted by a
`show_artifact` of that system), at each turn end and on window focus, as
`useCanvas` does. A preview frame's URL carries its file's hash (`?v=`), so a
changed preview reloads, and a changed `tokens.json` or `bundle.*` changes the
system digest the preview URLs also carry, so every preview reloads.

### Layout

- An index on the left: Overview (the README), the other sections, Colours,
  Type, Spacing, Radius, Shadow, Components by group, Assets, Fonts. Each
  entry is an `<a href="#...">`.
- Colours: a swatch per token in the chosen theme, with its name, value and
  usage. Type: each style drawn in its own font (from `fonts/` through the
  scheme, or Google Fonts). Spacing and radius: drawn to scale. Assets: a grid
  of pictures (served under `FILE_CSP`), and PDF and video as rows with their
  size.
- The shell's own chrome follows the app's theme; the system's Theme changes
  only swatches, type samples and previews.
- Every control is a real `<button>` or `<a href>`, reachable by keyboard.

### Live previews

- Each `preview.html` is an iframe with `sandbox="allow-scripts"` at
  `.../ds/<session>/<key>/t/<theme>/f/components/<Name>/preview.html?v=<file
  hash>&d=<system digest>`, under `BOARD_CSP`. `f/<path>` mirrors the system's
  folder exactly, and `f/tokens.css` is the one reserved virtual path: it is
  built from `tokens.json` for the `<theme>` in the URL (section 4) and wins
  over a real `tokens.css` (Claude systems carry a generated one).
- Claude's previews expect the system loaded around them, so Zorvo inserts,
  in order: `tokens.css`, the `@font-face` rules for `fonts/`, `components/bundle.css`,
  the libraries (React and React DOM `18.3.1` from jsDelivr when `libraries`
  names them, unless the system carries both in `components/lib/`), then
  `components/bundle.js`, each by its real path under `f/`, so relative
  `url()`s inside the bundle resolve as they do on disk. The tags go right after `<head ...>`; with no `<head>`, after
  `<html ...>` or `<!doctype ...>`; never before the doctype, which would put
  the page in quirks mode. A test covers each of the three.
- At most 12 previews are live: those on screen, nearest the middle first; the
  rest show a titled box, as `LIVE_BUDGET` does for a canvas.
- No new network host: the CDNs are the ones `PAGE_CSP` already allows.

## 4. Theme and canvases

### The theme is in the URL

The review found that a theme kept as backend state races the picture queue:
a picture queued under one theme and drawn after a pick of another would be
saved under the wrong key. So the theme travels in the URL instead, as a path
segment, and relative links inherit it:

- a canvas that names a system serves its files at
  `.../canvas/<session>/<key>/t/<theme>/f/<file>` (the plain `.../f/<file>`
  stays for a canvas with no system);
- a system's own files at `.../ds/<session>/<key>/t/<theme>/f/<path>`;
- the theme id is validated (`[A-Za-z0-9_-]{1,32}` and one of the system's
  themes; another answers 404) before it reaches a path.

The theme the user picks is frontend memory, per session and system key
(`useDesignSystemTheme`; the first theme until the user picks another), shared
by the system's viewer and every canvas of that session that names it. A
picture job and an export carry the theme they were asked with, so nothing
can mix them up, and the hidden picture view, which runs no Zorvo script,
draws whatever theme its URL names. `page_script.js` does not change.

### `tokens.css`

Built in Rust from `tokens.json` for the theme in the URL, the same variables
`docs/design-system/viewer/tokens-css.ts` makes today, which `bundle.css` and
previews read:

- `--<name>: <value>;` for every token of every family but `type` (`color`,
  `spacing`, `radius`, `shadow`, `size`, `motion` and any other list family),
  the name escaped as a CSS identifier;
- `--font-<family>: <stack>;` for every entry of `type.families`, and an
  `@font-face` rule for every `type.fonts` entry with a file under `fonts/`;
- the URL's theme on `:root`, with `color-scheme: dark` or `light` when the
  theme id is `dark` or `light`;
- then `[data-theme="<id>"] { ... }` for every theme, so a subtree can pin
  another theme (a swatch, a logo tile), as `themeCss` does. No
  `prefers-color-scheme` block: the theme is chosen, not followed.

Like every canvas response today, it is served with `Cache-Control: no-store`.

### A canvas names its system

When `canvas.json` has `designSystem`, the canvas protocol also serves
`.../t/<theme>/f/_ds/<path>` from that system's folder:

- `_ds/<path>` mirrors the system's folder exactly, with no aliases
  (`_ds/components/bundle.css`, `_ds/assets/Logos/mark.svg`,
  `_ds/fonts/Acme.woff2`), so relative `url()`s in the bundle work, plus one
  reserved virtual file, `_ds/tokens.css`;
- the permission is checked on each request (the canvas is remembered, its
  `canvas.json` names the folder, the folder is inside the session's folder,
  found with `is_inside_known_session_folder`, and in a known workspace), so
  reading a canvas records nothing;
- the path follows the canvas file rules (no `..`, no leading `/`, resolved
  inside the system's folder, read through `read_bytes_checked`).

Artboards link it explicitly and relatively, as they already link
`shared.css`: `<link rel="stylesheet" href="_ds/tokens.css">`,
`<link rel="stylesheet" href="_ds/components/bundle.css">`,
`<img src="_ds/assets/Logos/mark.svg">`, `../_ds/...` from a subfolder. Zorvo
inserts nothing into an artboard: its bytes are served as written. A real
folder named `_ds` in the canvas folder is hidden by the virtual one; the
canvas still shows, with "A folder named `_ds` in this canvas is hidden by the
design system." in the header.

### Theme on a canvas

`CanvasHeader` shows **Theme** when the linked system has two themes or more.
A pick changes the frame URLs (their `t/<theme>` segment), so live frames
reload and pictures are drawn for that theme; the system's own viewer follows
the same pick. **Export** draws in the chosen theme, and with two themes or
more adds the theme to each file name (`checkout-pay-dark.png`).

### Pictures and comments

- `BoardState` gains `pictureKey`: the artboard's key plus, when the canvas
  names a system, a digest of the system's folder (relative path, size and
  modification time; at most 5,000 entries 8 levels deep, as for the canvas
  folder) and the theme id.
- `pictureKey` replaces `sha256` in the frame URL's `?v=`, in the
  `canvas-thumb` event and in the thumbnail file's name, so a new token value
  or logo reloads the live frame and draws a new picture. `draw_thumbs`
  checks the `pictureKey` again before saving, as it checks `board_key` today.
- `sha256` stays the artboard's own hash and is still what a canvas comment
  records as `fileHash`, so a token or theme change never makes the canvas's
  comments Outdated.

### A system that is gone

If the folder moved or its index no longer parses, the canvas still shows,
`_ds/...` answers 404, and the header says "Design system not found:
`../../docs/design-system`".

## 5. Comments, out of date, Sync again

### Comments

With **Comment** on, the user picks:

- **a token**: its row;
- **a component**: its card as a whole, or an element or text inside a live
  preview, through `page_script.js` with `picks.rs`'s rules and rate limit;
- **a passage of the brand book**: text selected in the README or a section.

`page_script.js` runs in every frame, the shell's own included, since wry
cannot leave the main frame out, and it takes its mode and marks only by
`postMessage` from its parent frame. So, as the canvas wrapper does:

- `ds_comment_mode(sessionId, key, on)` and `ds_view_marks(sessionId, key,
  marks)` call the shell (`__zorvoDs.mode`, `__zorvoDs.marks`), which posts
  `{zorvo: "mode"}` or `{zorvo: "marks"}` to each live preview frame, and sends
  them again to a preview when its frame loads and reports
  `ds-preview-loaded`;
- the marks for a preview are its Current comments on an element or a text
  (`dsMarksFor`); a token, a whole component and a section are marked by the
  shell itself on its own rows and cards;
- the shell's own `page_script.js` comment mode is never turned on; the shell
  reports `ds-pick-token`, `ds-pick-section` and `ds-pick-component` itself,
  accepted only from the shell's exact URL, at most 20 a second;
- a preview's messages are matched to their frame by the URI wry hands the IPC
  handler, accepted only for a component the system has, under `picks.rs`'s
  rules and 5 a second, and counted by `FloodGuard` first, as for a canvas.
  An accepted pick makes the main webview first responder, as for a page.

A comment is an `ArtifactComment` whose `artifactId` is the system key,
`version` 0, and `designSystem` is `{key, target, hash}`:

- `target` is `{kind: "token", name}`, `{kind: "component", name, anchor?}` or
  `{kind: "section", file, anchor}`;
- `hash` is the token's value, the preview file's hash, or the section file's
  hash, read when the pick arrived;
- it reads Current while that hash is the same, Outdated otherwise (a token
  gone, a preview or a section changed) and never moves. A section comment is
  coarse on purpose: any change to its file outdates it, as a page comment is
  tied to its version.

Lenient readers in `persistence.ts` and `store.rs` keep the new field;
`STATE_VERSION` stays 2. The strip, the numbers, Add to message and Sent work
as for artifact comments. The message (`designSystemMessage`) is headed
"Comments on design system `docs/design-system` (Zorvo)" and grouped by target
("Token `accent`", "Component `Button` (`components/Button/preview.html`)",
"`README.md`"), with the quoting and escaping rules of artifact comments.

The sweep (`withoutMissingArtifacts`) today sends every comment without
`canvas` to the artifact-id check, which would remove a design-system comment
at once. It learns a third branch: a comment with `designSystem` is removed
when no listed design system has its key, only for sessions read without
failure.

### Out of date

Only for a system whose `meta.source` is kind `code` with a commit and paths.
`ds_source_state(sessionId, key)` runs read-only git in the repository that
holds the system's folder:

- The session's folder is checked with `ensure_known_workspace` first.
- `commit` must match `^[0-9a-f]{7,40}$`; each path must be relative, hold no
  `..`, not start with `-` or `:`, and stay inside the repository. A source
  that fails these is ignored, and the header says "Source paths could not be
  read."
- git runs through `changes::run_git` in the repository's top folder (from
  `git rev-parse --show-toplevel`), since the paths are relative to it, with
  `-c core.fsmonitor=false` (a cloned repository's `.git/config` is not
  trusted) and `--literal-pathspecs`, so no path is read as pathspec magic;
  the paths come after `--`.
- `git log --format=%H <commit>..HEAD -- <paths>` counts the commits that
  changed the source, `git diff --quiet HEAD -- <paths>` notices uncommitted
  changes.
- It is read when the system shows, on window focus and at each turn end.
- The header says "Source changed since a1b2c3d: `src/styles/globals.css`,
  3 commits." (or "has uncommitted changes"), or "Source commit a1b2c3d is not
  in this repository." A system made from references is never out of date.

### Sync again

A button beside that line. It sends nothing: it puts a message in the
composer, as Build this and Pick do, and the user presses Send: "Update the
design system `docs/design-system` from its source. `src/styles/globals.css`
changed since a1b2c3d. Change only the tokens that changed, keep their usage
notes, and record the new commit in `meta.source`."

## 6. Order of work

Each step is one pull request; `CLAUDE.md`, the README and `CHANGELOG.md`
change in the step that changes behaviour.

1. **Core.** `artifacts/design_system.rs` (index, tokens grammar, finding,
   default, derived keys), `tokens.css` building, `design_systems_list`, the
   line in every design guide, `docs/design-system/design-system.json`
   (Claude's current index of the Zorvo Design System, read from its artifact
   on 2026-11-26, plus `zorvo.default`; already written, untracked, in the
   feature worktree), and `docs/design-system/**` added to `rust.yml`'s paths,
   since the Rust tests read that folder as a fixture.
2. **Viewer.** `show_artifact` and `artifact_guide` kind `design-system` (the
   `kind` enums in `agent_tools/tools.rs` and `put_kind`),
   `design-system-guide.md`, `design-systems.json`, the shell, the protocol
   routes, live previews, the header, the Artifacts row, the gallery and the
   chat card. The viewer shows the first theme.
3. **Canvas and Theme.** `designSystem` in `canvas.json`, `_ds/`, the theme
   in the URL (viewer and canvas), `pictureKey`, export per theme. After step 2,
   since both change `protocol.rs`.
4. **Comments** on a design system.
5. **Out of date and Sync again.**

## 7. Testing

Rust:

- the index read leniently, with a Claude index fixture and the real
  `docs/design-system`;
- the tokens grammar: each reason a token drops, aliases, the W3C map, the
  `meta.source` shapes;
- finding: depth, skipped folders, the entry limit, name order, and the
  default with none, one and two marked;
- `tokens.css` per theme, aliases resolved, `no-store`;
- preview insertion after `<head>`, after `<html>`, after the doctype;
- markdown cleaning: `<script>`, `on*`, `javascript:`, outside links, `<img>`
  rewriting, `name` stripped and `id` and `#fragment` prefixed `ds-u-`;
- theme ids in a URL: an unknown or malformed id answers 404;
- `_ds/` routing, traversal and a missing system; `designSystem` refusals;
- `pictureKey` changing with a token, an asset and the theme while `sha256`
  (the comment's `fileHash`) stays, and a picture job drawn for the theme it
  was asked with;
- `tokens.css` matching what `tokens-css.ts`'s `themeCss` declares for the
  same tokens, for `docs/design-system`;
- `ds_source_state` refusing a path starting with `:`, and never reading
  `core.fsmonitor`;
- `ds_source_state` in a temporary repository: unchanged, committed change,
  uncommitted change, unknown commit, a path `-x`, a path `../x`;
- the refusal sentences, pinned.

Render test (`harness = false`, `ZORVO_RENDER_TEST=1`): a fixture system with
two themes and a canvas that names it; a picture of one artboard differs
between the themes, and a component preview draws with its bundle.

Frontend (Vitest):

- the shell: SHA pinned, no `http`, colours from `tokens.json`, and its
  behaviour in jsdom (index, theme, picks, keyboard);
- `lib/design-systems.ts`: parsers, refusals equal to the Rust, comment
  status, `designSystemMessage`;
- the hook and the header: Theme, the out-of-date line, the text Sync again
  puts in the composer;
- the guide: its key phrases and no em dash (`design-craft.test.ts` extended);
- `tauri-contract.test.ts` for every new command and event.

## 8. Documents that change

`CLAUDE.md` (Artifacts, Canvas, Artifact comments), `README.md` (what agents
can show; no new host, but its privacy section says that opening a design
system, like a page, may load Google Fonts and React from jsDelivr on its
own, a cloned repository's system included), `CHANGELOG.md`, `src/lib/canvas-guide.md`
(`designSystem` and `_ds/`), `src/lib/design-craft.md` (names
`design-system.json` as the place to look), and `docs/design-system/README.md`
(the index file and the default).
