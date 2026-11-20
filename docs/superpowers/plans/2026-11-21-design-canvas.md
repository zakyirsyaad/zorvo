# Design Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent writes a folder with `canvas.json` and one HTML file per artboard; Zorvo shows the artboards on a pannable, zoomable canvas beside the chat, with comments, Pick, Build this and PNG/PDF export.

**Architecture:** The canvas reuses the artifact page's child wry webview. Zorvo serves its own wrapper page there, which lays the artboards out and keeps at most eight live as sandboxed iframes; the rest are PNG pictures a hidden WebKit view renders. Messages from artboards are matched to their artboard by the frame URL wry passes. Everything the user acts on (comment, pick, build, export) is in Zorvo's React header and composer.

**Tech Stack:** Rust (Tauri 2, wry 0.57.0, objc2-web-kit 0.3.2, objc2-pdf-kit), React 19 + Tailwind 4, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-21-design-canvas-design.md` (with its spike results). Also read `docs/superpowers/specs/2026-11-16-artifacts-design.md` and `2026-11-17-artifact-comments-design.md`: this plan extends their code.

## Global Constraints

- One `wry` in `Cargo.lock`, pinned `=0.57.0` (a test checks). New macOS crates match the versions already in `Cargo.lock` (`objc2` 0.6.5, `objc2-web-kit` 0.3.2, `objc2-app-kit` 0.3.2, `block2` 0.6.2).
- Nothing new reaches the network. The main webview's CSP and `tauri.conf.json` do not change.
- `PAGE_CSP` keeps its pinned text. Artboards get `BOARD_CSP` (below); the wrapper gets `SHELL_CSP` (below).
- Every backend command that reads a folder from the UI calls `files::ensure_known_workspace` first. File I/O commands are `#[tauri::command(async)]`.
- `STATE_VERSION` stays 2; new persisted fields are read leniently in both `persistence.ts` and `store.rs`.
- A refusal sent to an agent never repeats a path or file contents it was not given.
- No keyboard shortcuts. UI copy: sentence case, short declarative sentences, "you", agents by name.
- Design tokens only (no raw colours); `Button`/`IconButton` primitives with `focus-ring`; motion tokens per `CLAUDE.md`.
- Limits from the spec: 200 artboards per canvas, 50 sections, 200 artboards per section, artboard sides 200 to 8000, `canvas.json` at most 256 KiB, each served file at most 16 MiB, ids 1 to 64 of `a-z0-9-`, titles 1 to 120 visible characters, zoom 5% to 200%, live budget 8 at zoom ≥ 25%, pictures at most 720 px wide, picture cache kept 30 days after last use, PNG export at 2×.
- Commit with explicit paths (never `git add -A`); Conventional Commits; a `CHANGELOG.md` line under Unreleased in the last task.

```
SHELL_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; \
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

BOARD_CSP = PAGE_CSP with zorvo-artifact://localhost added to script-src, style-src,
img-src and font-src (written out in full in protocol.rs, pinned by a test)
```

## Rulings (decisions this plan makes where the spec leaves room)

1. **Canvases are kept in `canvases.json` beside `index.json`**, not inside it: `index.json` is an array of artifact records and changing its shape would need a migration. Deleting a session's folder removes both. Cost if wrong: one more file per session.
2. **The selected artboard's actions are in Zorvo's React header**, not drawn inside the wrapper page: the wrapper only reports which artboard is selected. Actions that write to the composer stay in trusted UI. Cost if wrong: the actions sit above the canvas instead of beside the artboard.
3. **A canvas comment is an `ArtifactComment` with a `canvas` field** (`{ key, artboardId, fileHash }`), `artifactId` set to the canvas key and `version` 0, so the composer slot, Sent, Clear sent and the sweep keep working unchanged. Cost if wrong: a later typed artifact may want its own comment type.
4. **Pictures and export use a second, hidden wry child webview** (`with_visible(false)`, same custom protocol and navigation handler), snapshotted through its `WKWebView` (`WebViewExtMacOS::webview()`). The spike showed a hidden view snapshots fully; this avoids a second scheme handler written in objc2. Cost if wrong: one hidden view per render, ended after each.

## Review Focus

1. A `canvas.json` the agent writes while Zorvo reads it (half-written JSON): the viewer keeps the last good layout and says it could not be read; it never blanks the canvas. Test in Task 6.
2. An artboard file that is a symlink to a file outside the canvas folder, or renamed `../x.html` in `canvas.json`: refused when parsed and when served. Tests in Tasks 1 and 2.
3. A message posted by the wrapper's artboards pretending to be the wrapper (`kind: "canvas-select"` from an artboard frame): refused because the frame URL is an artboard's. Test in Task 7.
4. Many artboards changing at once (the agent rewrites the whole canvas): one picture renders at a time, a stale render for an old hash is dropped, and the iframe of a changed live artboard reloads once. Tests in Tasks 6 and 8.
5. A canvas folder deleted, or its workspace removed from Zorvo, while the canvas is open: the protocol serves nothing (`ensure_known_workspace`), the row reads "Folder not found", nothing panics. Tests in Tasks 3 and 4.

---

### Task 0: Artboards (design, before code)

**Files:** none in the repository until the copies below.

- [ ] **Step 1:** On the "Zorvo redesign v2" canvas (https://claude.ai/artifact/NkShdh56RavBM73MEb9WbU), add a section "Bagian 15 · Design canvas", built from the existing `ArtifactsMain`/`ArtifactsInspector` artboard files: `CanvasInspector` (canvas in the Output tab, header with Fit/zoom/sections), `CanvasExpanded` (expanded, one artboard selected with the header's actions: Comment, Pick, Build this, Export, Focus), `CanvasComments` (comment mode on an artboard with numbered marks and the strip), `CanvasStates` (Output row, card in the chat, "Folder not found", "canvas.json could not be read", picture still rendering).
- [ ] **Step 2:** Show them to the user and wait for approval. Copy the approved files to `docs/superpowers/specs/2026-11-21-design-canvas-artboards/` and commit:

```bash
git add docs/superpowers/specs/2026-11-21-design-canvas-artboards
git commit -m "docs: design canvas artboards"
```

Tasks 9 to 12 follow these artboards for look and copy; the spec decides behaviour.

---

### Task 1: Parse `canvas.json`

**Files:**
- Create: `src-tauri/src/artifacts/canvas.rs`
- Modify: `src-tauri/src/artifacts/mod.rs` (`pub mod canvas;`)
- Test: unit tests in `canvas.rs`

**Interfaces:**
- Produces:
  - `pub struct Canvas { pub title: String, pub sections: Vec<Section> }`
  - `pub struct Section { pub id: String, pub title: String, pub artboards: Vec<Artboard> }`
  - `pub struct Artboard { pub id: String, pub title: String, pub file: String, pub width: u32, pub height: u32, pub group: Option<String> }`
  - All `Serialize, Clone, Debug, PartialEq`, `rename_all = "camelCase"`. Never `Deserialize` from agent data: parsing goes through `parse_canvas`.
  - `pub fn parse_canvas(bytes: &[u8]) -> Result<Canvas, String>`
  - `pub fn is_relative_file(file: &str) -> bool`
  - Constants `MAX_CANVAS_JSON_BYTES = 256 * 1024`, `MAX_SECTIONS = 50`, `MAX_ARTBOARDS = 200`, `MIN_SIDE = 200`, `MAX_SIDE = 8000`, `MAX_CANVAS_TITLE_CHARS = 120`, `MAX_ID_CHARS = 64`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn parses_the_spec_example() // the JSON in the spec's "canvas.json, version 1": 1 section, 3 artboards, pay-a/pay-b group "pay"
#[test] fn refuses_another_version() // {"version":2,…} → Err("version: must be 1")
#[test] fn names_the_field_that_is_wrong() // width 100 → Err("sections[0].artboards[2].width: must be a whole number from 200 to 8000")
#[test] fn refuses_unknown_top_level_fields() // {"version":1,"title":"x","sections":[…],"extra":1} → Err starting "extra:"
#[test] fn refuses_duplicate_ids_across_sections() // artboard id "a" twice → Err ending "must be unique in the canvas"
#[test] fn refuses_a_group_of_one() // group "pay" on one artboard → Err("sections[0].artboards[0].group: a group needs two artboards or more")
#[test] fn refuses_files_that_leave_the_folder() // "../x.html", "/x.html", "a/../../x.html", "x.txt", "" → each Err
#[test] fn accepts_a_file_in_a_subfolder() // "screens/cart.html" → Ok
#[test] fn cleans_titles_and_refuses_invisible_ones() // "Cart\u{202E}" → "Cart"; "\u{200B}" → Err("…title: must hold visible text")
#[test] fn refuses_more_than_200_artboards_and_more_than_256_kib() // 201 artboards → Err; 256 KiB + 1 bytes → Err("canvas.json: over 256 KB")
#[test] fn refuses_invalid_utf8_and_non_objects() // [0xff] → Err("canvas.json: not valid UTF-8"); "[]" → Err("canvas.json: must be a JSON object")
#[test] fn never_repeats_the_files_text() // a title of 500 "secret" chars → the error holds no "secret"
```

- [ ] **Step 2: Run them; they fail** — `cd src-tauri && cargo test --lib artifacts::canvas` → FAIL (`parse_canvas` not defined).
- [ ] **Step 3: Implement `parse_canvas`** by reading `serde_json::Value` and checking field by field (the error path is built as the walk goes); titles go through the existing `clean_title` used for artifact titles; ids match `^[a-z0-9-]{1,64}$`; sides are integers (`as_u64`, no floats).
- [ ] **Step 4: Run them; they pass** — same command → PASS, then `cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 5: Commit** — `git add src-tauri/src/artifacts/canvas.rs src-tauri/src/artifacts/mod.rs && git commit -m "feat: parse canvas.json"`

---

### Task 2: The canvas folder and its files

**Files:**
- Modify: `src-tauri/src/artifacts/canvas.rs`, `src-tauri/src/artifacts/source.rs` (make `read_checked` `pub(crate)`)
- Test: unit tests in `canvas.rs` with `artifacts::tests::Temp`

**Interfaces:**
- Consumes: `source::read_checked(path: &Path) -> Result<Vec<u8>, String>` (16 MiB cap, `O_NOFOLLOW | O_NONBLOCK`).
- Produces:
  - `pub struct CanvasFolder { pub root: PathBuf, pub relative: String }` (canonical root; `relative` to the session's folder, `/`-separated)
  - `pub fn resolve_canvas(session_folder: &Path, path: &str) -> Result<CanvasFolder, String>` — `path` is the folder or its `canvas.json`; must be inside `session_folder` (no temporary folder). Refusal: `NOT_A_CANVAS = "The canvas must be a folder with a canvas.json inside this folder."`
  - `pub fn read_canvas(root: &Path) -> Result<Canvas, String>` (reads `canvas.json` through `read_checked`, then `parse_canvas`)
  - `pub fn canvas_file(root: &Path, relative: &str) -> Option<(PathBuf, &'static str)>` — canonical path inside `root` and its content type, or `None`.
  - `pub fn file_sha256(path: &Path) -> Option<String>` (lowercase hex of the bytes read through `read_checked`)
  - `pub const SERVED_TYPES: &[(&str, &str)]`: `html htm → text/html; charset=utf-8`, `css → text/css`, `js mjs → text/javascript`, `json → application/json`, `png jpg jpeg gif webp avif → image/*`, `svg → image/svg+xml`, `woff woff2 ttf otf → font/*`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn resolves_the_folder_or_its_canvas_json() // "design/c" and "design/c/canvas.json" → same root, relative "design/c"
#[test] fn refuses_a_folder_outside_the_session_or_in_temp() // "/tmp/x", "../other" → Err(NOT_A_CANVAS)
#[test] fn serves_only_listed_types_inside_the_root() // "a.png" Some(image/png); "a.exe" None; "../a.png" None
#[test] fn refuses_a_link_out_of_the_root() // symlink root/x.png → /etc/hosts: canvas_file None, and read through read_checked fails
#[test] fn hashes_a_file_and_none_for_a_missing_one() // known bytes → known sha256; missing → None
```

- [ ] **Step 2:** `cargo test --lib artifacts::canvas` → FAIL.
- [ ] **Step 3:** Implement. `canvas_file` refuses `..`, a leading `/`, an empty segment and backslashes before canonicalizing, then requires `starts_with(root)`.
- [ ] **Step 4:** Same command → PASS; clippy clean.
- [ ] **Step 5: Commit** — `feat: canvas folder rules and served files`

---

### Task 3: Remember shown canvases

**Files:**
- Modify: `src-tauri/src/artifacts/store.rs`
- Test: unit tests in `store.rs`

**Interfaces:**
- Produces:
  - `pub struct CanvasEntry { pub key: String, pub folder: String, pub relative: String, pub title: String, pub shown_at: u64 }` (`Serialize, Deserialize, Clone, Debug, PartialEq`, camelCase; read from Zorvo's own file only)
  - `pub fn is_canvas_key(id: &str) -> bool` — `c-` + 16 lowercase hex
  - `ArtifactStore::remember_canvas(&self, session_id: &str, folder: &CanvasFolder, title: &str, now: u64) -> Result<CanvasEntry, String>` — same canonical folder → same key, title and `shown_at` updated; at most `MAX_CANVASES = 50` per session (`TOO_MANY_CANVASES = "This session already has 50 canvases. The user can remove one in Zorvo."`)
  - `ArtifactStore::canvases(&self, session_id: &str) -> Result<Vec<CanvasEntry>, String>` (newest `shown_at` first; a missing file is an empty list; an unreadable one is `Err`)
  - `ArtifactStore::canvas(&self, session_id: &str, key: &str) -> Option<CanvasEntry>`
  - `ArtifactStore::forget_canvas(&self, session_id: &str, key: &str) -> Result<(), String>`
  - Kept in `<root>/<sessionId>/canvases.json` (Ruling 1), written atomically under the session's lock like `index.json`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn the_same_folder_keeps_its_key() // remember twice → same key, second title wins, shown_at updated
#[test] fn lists_newest_first_and_forgets() // two folders → order by shown_at desc; forget one → one left
#[test] fn refuses_a_51st_canvas() // 50 folders then one more → Err(TOO_MANY_CANVASES)
#[test] fn delete_session_removes_canvases() // remember, delete_session → canvases() == []
#[test] fn an_unreadable_canvases_file_is_an_error_not_empty() // write "{" to canvases.json → canvases() is Err
```

- [ ] **Step 2:** `cargo test --lib artifacts::store` → FAIL.
- [ ] **Step 3:** Implement beside `read_index`/`write_index`.
- [ ] **Step 4:** PASS; clippy clean.
- [ ] **Step 5: Commit** — `feat: remember the canvases a session showed`

---

### Task 4: Commands and the agent's tool

**Files:**
- Modify: `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs` (`generate_handler!`), `src-tauri/src/agent_tools/tools.rs`, `src/hooks/useAgentTools.ts`, `src/lib/agent-tools-context.ts`
- Create: `src/lib/canvas-guide.md`, `src/lib/canvas.ts`
- Test: `commands.rs` unit tests, `tools.rs` tests, `src/test/canvas.test.ts`, `src/test/agent-tools.test.ts`, `src/test/agent-tools-context.test.ts`, `src/test/tauri-contract.test.ts` (must stay green)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (Rust):
  - `pub struct BoardState { pub id: String, pub sha256: Option<String> }` (`None` when the file is missing)
  - `pub struct CanvasRead { pub entry: CanvasEntry, pub canvas: Option<Canvas>, pub error: Option<String>, pub boards: Vec<BoardState> }` — `canvas: None` with `error` when `canvas.json` cannot be read now; `error: Some("Folder not found")` when the folder is gone or no longer in a known workspace
  - `pub fn show_canvas(artifacts: &ArtifactStore, is_known: impl Fn(&Path) -> bool, session_id: &str, cwd: &str, path: &str, now: u64) -> Result<CanvasRead, String>` — refuses an unknown `cwd`; an unreadable canvas is `Err` with the parse error (the agent must fix it), unlike `canvas_read`
  - Commands: `canvas_show(session_id, cwd, path) -> CanvasRead` (emits `artifacts-changed`), `canvas_read(session_id, key) -> CanvasRead`, `canvas_forget(session_id, key) -> ()` (emits `artifacts-changed`)
  - `SessionArtifacts` gains `pub canvases: Vec<CanvasEntry>` (`artifact_list` fills it; a failed read marks the session `failed` as today)
- Produces (agent tools):
  - `show_artifact` schema: `kind` enum `["page","canvas"]`, description "page (default): one .html file. canvas: a folder with canvas.json and one .html file per artboard; path names the folder or its canvas.json." The tool's description adds: "For several screens, a flow or variants, make a canvas: call artifact_guide with kind canvas first."
  - `artifact_guide` schema: optional `kind` enum `["page","canvas"]`.
  - `validate` allows `kind` on both and refuses another value with "kind must be page or canvas."
- Produces (frontend, `src/lib/canvas.ts`):
  - Types `CanvasEntry`, `Canvas`, `CanvasSection`, `CanvasArtboard`, `BoardState`, `CanvasRead` mirroring the Rust ones.
  - `parseCanvasRead(value: unknown): CanvasRead | null` (strict: unknown shapes → `null`)
  - `canvasResultText(read: CanvasRead): string` → `{"shown":true,"canvas":"<key>","artboards":<n>}` as JSON text
  - `CANVAS_GUIDE: string` (the markdown, imported as text like `ARTIFACT_GUIDE`)
  - `CANVAS_REFUSALS: ReadonlySet<string>` holding `NOT_A_CANVAS` and `TOO_MANY_CANVASES`, kept equal to the Rust sentences by a test (as `ARTIFACT_REFUSALS` is). A parse error (`<field>: <rule>`) is passed to the agent too: it names only the field.
- `useAgentTools.handleShowArtifact`: `kind === 'canvas'` → `invoke('canvas_show', { sessionId, cwd, path })`, `onArtifactShown` gets `{ kind: 'canvas', key }`; `artifact_guide` with `kind: 'canvas'` answers `CANVAS_GUIDE`.
- `MCP_PATH_CONTEXT` gains: "Several screens, a flow or variants of one screen go on a canvas: call artifact_guide with kind canvas, then show_artifact with kind canvas." `COMMAND_PATH_CONTEXT` names `"kind":"canvas"` in its `show_artifact` example.

`src/lib/canvas-guide.md` covers, in this order: what a canvas is; the folder (`design/<name>/`); `canvas.json` with the spec's example and every rule of the spec's format section; common sizes 1440 × 900, 390 × 844, 1024 × 768; one self-contained HTML file per artboard and shared CSS in one file of the folder, linked relatively; variants as a `group` of two or more; Zorvo places artboards in order, sections as rows; what the sandbox allows (the artifact guide's CDN list, files of the folder, no network); call `show_artifact` with `kind: "canvas"` again after every change.

- [ ] **Step 1: Write the failing tests**

```rust
// commands.rs
#[test] fn show_canvas_refuses_an_unknown_workspace() // is_known false → Err
#[test] fn show_canvas_reads_hashes_and_remembers() // fixture folder → boards with Some(sha) and None for a missing file; canvases() has it
#[test] fn show_canvas_returns_the_parse_error_to_the_agent() // width 1 → Err("sections[0].artboards[0].width: …")
#[test] fn canvas_read_keeps_the_entry_when_the_json_breaks() // remember, then write "{" → canvas None, error Some(..)
#[test] fn canvas_read_says_folder_not_found() // remember, delete the folder → error Some("Folder not found")
// tools.rs
#[test] fn show_artifact_takes_a_kind() // {"path":"d","kind":"canvas"} Ok; {"kind":"sheet"} Err("kind must be page or canvas.")
#[test] fn artifact_guide_takes_a_kind()
```

```ts
// src/test/canvas.test.ts
it("parses a canvas read and refuses other shapes")
it("words the answer to the agent") // canvasResultText → '{"shown":true,"canvas":"c-0123456789abcdef","artboards":3}'
it("keeps CANVAS_REFUSALS equal to the Rust sentences") // reads canvas.rs / store.rs source like the artifacts refusal test
// src/test/agent-tools.test.ts
it("routes show_artifact kind canvas to canvas_show and answers with the key")
it("answers artifact_guide kind canvas with the canvas guide")
// src/test/agent-tools-context.test.ts
it("names the canvas in the MCP note")
```

- [ ] **Step 2:** `cd src-tauri && cargo test --lib artifacts:: agent_tools::` and `pnpm vitest run src/test/canvas.test.ts src/test/agent-tools.test.ts src/test/agent-tools-context.test.ts src/test/tauri-contract.test.ts` → FAIL.
- [ ] **Step 3:** Implement; register the three commands in `lib.rs`.
- [ ] **Step 4:** Same commands → PASS; `pnpm lint`; clippy.
- [ ] **Step 5: Commit** — `feat: agents show a canvas with show_artifact kind canvas`

---

### Task 5: Protocol for the wrapper, files and pictures

**Files:**
- Modify: `src-tauri/src/artifacts/protocol.rs`, `src-tauri/src/artifacts/view.rs` (`show` takes `Arc<Served>` instead of `Arc<ArtifactStore>`), `src-tauri/src/lib.rs` (build and manage `Served`)
- Create: `src-tauri/src/artifacts/canvas_shell.html`, `src-tauri/src/artifacts/canvas_shell.rs`
- Test: unit tests in `protocol.rs`, `canvas_shell.rs`

**Interfaces:**
- Produces:
  - `pub enum CanvasUrl { Shell { session_id: String, key: String }, File { session_id: String, key: String, relative: String }, Thumb { sha256: String } }`
  - `pub fn canvas_shell_url(session_id: &str, key: &str) -> String` → `zorvo-artifact://localhost/canvas/<session>/<key>/`
  - `pub fn canvas_file_url(session_id: &str, key: &str, relative: &str) -> String` → `…/canvas/<session>/<key>/f/<relative, each segment percent-encoded>`
  - `pub fn thumb_url(sha256: &str) -> String` → `zorvo-artifact://localhost/thumb/<sha256>.png`
  - `pub fn parse_canvas_url(uri: &str) -> Option<CanvasUrl>` (query and fragment ignored; `relative` decoded and then checked by `canvas_file`)
  - `pub struct Served { pub store: Arc<ArtifactStore>, pub thumbs: PathBuf, pub is_known: Arc<dyn Fn(&Path) -> bool + Send + Sync> }` — what every view of the scheme serves from; built once in `lib.rs` (`is_known` wraps `AppStore::is_known_workspace`) and managed as Tauri state.
  - `pub fn respond(served: &Served, method: &str, uri: &str) -> Response<Vec<u8>>` — the page route as today; the shell with `SHELL_CSP`; a file only when the canvas entry exists, `is_known(folder)` holds and `canvas_file` accepts it (HTML with `BOARD_CSP`, others with their type and `X-Content-Type-Options: nosniff`); a thumb only when `<thumbs>/<sha256>.png` is a regular file.
  - `pub fn is_allowed_canvas_navigation(url: &str, session_id: &str, key: &str) -> bool` — the shell and files of that canvas only.
  - `pub const SHELL_CSP`, `pub const BOARD_CSP` (text above).
  - `canvas_shell.rs`: `pub const CANVAS_SHELL: &str = include_str!("canvas_shell.html");` and a test pinning its SHA-256 (update the pin when the file changes, in the same commit).

The wrapper (`canvas_shell.html`, one file, inline script and style, no network) defines on `window`, each not writable:
- `__zorvoCanvas.apply(state)` — `state = { boards: [{ id, title, section, group?, width, height, url, thumb? , missing? }], sections: [{ id, title }], selected?: string, error?: string }`; lays out and redraws.
- `__zorvoCanvas.command(name)` — `"fit"`, `"actual"`, `"in"`, `"out"`, `"section:<id>"`, `"focus:<id>"`, `"prev"`, `"next"`.
- `__zorvoCanvas.mode(on)` and `__zorvoCanvas.marks(artboardId, marks)` — post `{zorvo:'mode',on}` / `{zorvo:'marks',marks}` to that artboard's iframe (Task 10 uses them).
- `__zorvoCanvas.layout(state)` and `__zorvoCanvas.liveIds(state, view, viewport, budget)` — pure, exposed for tests.
- Layout: sections top to bottom, title band 48 px, artboards left to right 80 px apart, rows 160 px apart; a group's artboards share a label above them.
- Live choice: on screen, zoom ≥ 0.25, the `budget` (8) nearest the viewport's centre; the rest draw `thumb` as `<img>` or a titled box ("Rendering…" while `thumb` is absent, "File not found" when `missing`).
- Pan by two-finger scroll and background drag; pinch zoom (`gesturechange` on WebKit, `wheel` with `ctrlKey`); zoom clamped 0.05 to 2.
- Posts to `window.webkit.messageHandlers.ipc` (wry's handler): `{kind:'canvas-select', artboardId: string|null}` on a click of an artboard's frame or title; `{kind:'canvas-zoom', zoom: number}` after a zoom change (at most 10 a second).
- `error` draws a one-line bar at the top ("canvas.json could not be read: <error>") over the last layout.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn parses_canvas_urls() // shell, file with "screens/cart.html", thumb; "/canvas/s/c-…/f/../x" → File with relative "../x" (refused later)
#[test] fn serves_the_shell_with_its_csp()
#[test] fn serves_a_board_with_board_csp_and_an_image_with_nosniff()
#[test] fn serves_nothing_outside_a_known_workspace() // is_known false → 404
#[test] fn serves_nothing_for_a_link_out_of_the_folder() // symlink → 404
#[test] fn allows_navigation_only_inside_the_shown_canvas()
#[test] fn board_csp_is_page_csp_plus_the_scheme() // pinned text
#[test] fn canvas_shell_hash_is_pinned()
```

```ts
// src/test/canvas-shell.test.ts — loads canvas_shell.html into jsdom (like artifact-page-script.test.ts)
it("lays sections out as rows with 80 px between artboards and 160 px between rows")
it("keeps at most 8 live artboards, nearest the centre, and none under 25% zoom")
it("draws a picture, a rendering box or a missing box for the others")
it("posts canvas-select on a click of an artboard's title")
it("keeps the last layout and shows the error bar when apply gets an error")
it("cannot have its functions replaced") // assigning __zorvoCanvas.apply throws or is ignored
```

- [ ] **Step 2:** `cargo test --lib artifacts::protocol artifacts::canvas_shell` and `pnpm vitest run src/test/canvas-shell.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Keep the existing page route and its tests untouched.
- [ ] **Step 4:** PASS; clippy; `pnpm lint`.
- [ ] **Step 5: Commit** — `feat: serve the canvas wrapper, artboards and pictures`

---

### Task 6: Show a canvas in the artifact view

**Files:**
- Modify: `src-tauri/src/artifacts/view.rs`, `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs`, `src/hooks/useArtifactView.ts`
- Create: `src/hooks/useCanvas.ts`, `src/components/artifacts/CanvasViewer.tsx`, `src/components/artifacts/CanvasHeader.tsx`
- Modify: `src/components/artifacts/ArtifactsPanel.tsx`, `src/components/artifacts/ArtifactGallery.tsx`, `src/lib/artifacts.ts` (`galleryRows` lists canvases), `src/lib/canvas.ts`
- Test: `view.rs` unit tests, `src/test/canvas.test.ts`, `src/test/use-canvas.test.tsx`, `src/test/canvas-viewer.test.tsx`, `src/test/artifacts-panel.test.tsx`, `src/test/tauri-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces (Rust):
  - `pub enum ShownView { Page(ShownPage), Canvas(ShownCanvas) }`, `pub struct ShownCanvas { pub session_id: String, pub key: String }`; `close_for` and `is_showing` work for both.
  - `pub fn show_canvas(app: &AppHandle, served: Arc<Served>, canvas: ShownCanvas, bounds: Bounds) -> Result<(), String>` — like `show`, with `with_initialization_script_for_main_only(PAGE_SCRIPT, false)` and `is_allowed_canvas_navigation`.
  - `pub fn apply_canvas(app: &AppHandle, canvas: ShownCanvas, state_json: String)` and `pub fn canvas_command(app: &AppHandle, canvas: ShownCanvas, name: String)` — `evaluate_script` on the main frame, only while that canvas is shown; `state_json` at most 1 MiB; `name` must match the command list of Task 5.
  - Commands: `canvas_view_show(session_id, key, x, y, width, height)`, `canvas_view_apply(session_id, key, state: String)`, `canvas_view_command(session_id, key, name: String)`. Bounds, hide and close reuse `artifact_view_bounds/hide/close`.
  - Event `canvas-view` (`{sessionId, key, kind: "select"|"zoom", artboardId?, zoom?}`) from the wrapper's messages: accepted only when the frame URL is the shell URL of the shown canvas (`request.uri()` in wry's IPC handler), through `FloodGuard` and a rate of 20 a second.
- Produces (frontend):
  - `canvasShellState(read: CanvasRead, thumbs: ReadonlyMap<string, string>, selected?: string): string` in `lib/canvas.ts` — the JSON for `apply`, with board URLs from a `canvasFileUrl(sessionId, key, file)` mirror of the Rust function (same encoding; a test compares them on fixtures) plus `?v=<first 12 hex of the board's sha256>`, so a changed artboard gets a new URL and its iframe reloads once (`parse_canvas_url` ignores the query).
  - `useCanvas(sessionId: string, key: string | null): { read: CanvasRead | null; lastGood: Canvas | null; refresh(): void; selected: string | null; zoom: number }` — reads with `canvas_read`; refreshes on `artifacts-changed` for the session, on the session's turn end and on window focus; keeps `lastGood` when a read has `canvas: null`.
  - `ArtifactViewTarget` becomes `{ kind: 'page'; … } | { kind: 'canvas'; sessionId: string; key: string }`; the queue, claims and Expand/Shrink keep one view for both.
  - `CanvasViewer` — the box (same `ArtifactPageBox` mechanics and `useBoxCovered`), sends `canvas_view_apply` whenever `canvasShellState(...)` changes, and holds `CanvasHeader`: back, title, artboard count, Fit, 100%, −, +, the zoom as a percentage, a Sections menu, Expand. With an artboard selected the header also shows its title and Focus, Previous, Next (Comment, Pick, Build this, Export arrive in Tasks 10–12).
  - Output tab and gallery rows for canvases: title, "Canvas · N artboards", the folder relative to the session, ⋯ with Remove (`canvas_forget`). A canvas opens itself in the tab when shown by the agent of the session on screen (`openingFor` gains canvases).
  - `ChatMessage.artifactCard` gains `kind?: 'canvas'` and `canvasKey?: string` (lenient in `persistence.ts`); `ArtifactCardRow` draws "Canvas · N artboards".

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn canvas_messages_are_taken_only_from_the_shell_frame() // pure fn `canvas_message_source(frame_url, &ShownCanvas) -> Source { Shell, Board(String), Other }`
#[test] fn close_for_closes_a_canvas_of_that_session_only()
#[test] fn refuses_a_command_outside_the_list() // "eval:1" → not sent
```

```ts
it("builds the shell state with file URLs equal to the backend's")        // canvas.test.ts
it("gives a changed artboard a new URL and an unchanged one the same")     // canvas.test.ts
it("keeps the last good canvas when a read cannot parse")                 // use-canvas.test.tsx
it("reads again on artifacts-changed, turn end and focus")                // use-canvas.test.tsx
it("sends apply when the read or the pictures change, not on every render") // canvas-viewer.test.tsx
it("shows the selected artboard's title with Focus, Previous and Next")   // canvas-viewer.test.tsx
it("lists a canvas in the Output tab and opens it")                       // artifacts-panel.test.tsx
it("draws a canvas card in the chat")                                     // artifact-card-row test
```

- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm lint`; clippy.
- [ ] **Step 5: Manual check (stop if it fails):** `pnpm tauri dev`, a session whose folder holds a fixture canvas of 40 artboards (`src-tauri/tests/fixtures/canvas-40/`, add it in this step: `canvas.json` plus 40 small HTML files with a chart script), show it with `zorvo tools show_artifact '{"path":"…","kind":"canvas"}'` from that session's agent, then: the canvas lays out; Fit and pinch work; selecting reports in the header; an artboard posts nothing the backend accepts as the shell (`canvas-select` sent from an artboard's console is refused). Record what you saw in the commit message. If wry delivers the all-frames script or the frame URL differently from the spike, stop and report.
- [ ] **Step 6: Commit** — `feat: show a canvas in the artifact view`

---

### Task 7: Refuse artboards pretending to be the wrapper

**Files:**
- Modify: `src-tauri/src/artifacts/view.rs`, `src-tauri/src/artifacts/picks.rs`
- Test: `picks.rs` and `view.rs` unit tests

**Interfaces:**
- Consumes: `canvas_message_source` (Task 6).
- Produces: `pub enum CanvasIntake { Shell(ShellMessage), Board { artboard_id: String, message: PageMessage }, Refused }` and `pub fn canvas_intake(frame_url: &str, raw: &str, shown: &ShownCanvas, canvas: &Canvas, state: ViewState, rate: &mut RateLimit, now: Instant) -> CanvasIntake` — shell kinds only from the shell frame; `PageMessage` kinds only from an artboard frame of this canvas whose file is an artboard of `canvas`; everything else `Refused`. `FloodGuard` counts every message, as today.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn a_board_cannot_send_shell_kinds() // frame = board URL, raw = {"kind":"canvas-select","artboardId":"x"} → Refused
#[test] fn the_shell_cannot_send_picks() // frame = shell URL, raw = pick-element → Refused
#[test] fn a_board_of_another_canvas_is_refused()
#[test] fn a_file_that_is_not_an_artboard_is_refused() // frame URL of an asset html not listed in canvas.json
#[test] fn picks_from_a_board_name_that_board() // pick-text in comment mode → Board { artboard_id: "pay-b", .. }
```

- [ ] **Step 2:** `cargo test --lib artifacts::` → FAIL.
- [ ] **Step 3:** Implement; `view.rs` routes canvas IPC through `canvas_intake` and emits `canvas-view` (Shell) or `canvas-pick` (`{sessionId, key, artboardId, message}`; Board).
- [ ] **Step 4:** PASS; clippy.
- [ ] **Step 5: Commit** — `feat: match canvas messages to their frame`

---

### Task 8: Pictures

**Files:**
- Create: `src-tauri/src/artifacts/render.rs`
- Modify: `src-tauri/Cargo.toml` (macOS: `objc2-web-kit = { version = "=0.3.2", features = ["WKWebView", "WKSnapshotConfiguration", "WKPDFConfiguration", "block2", "objc2-app-kit"] }`, `objc2-app-kit = { version = "=0.3.2", features = ["NSImage", "NSBitmapImageRep", "NSImageRep", "NSGraphics"] }`, `block2 = "=0.6.2"`), `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs` (start-up sweep of thumbs), `src/hooks/useCanvas.ts`
- Test: `render.rs` unit tests (pure parts), `src-tauri/tests/it/canvas_render_test.rs` (`#[ignore]`, run by hand: needs a window server), `src/test/use-canvas.test.tsx`

**Interfaces:**
- Produces:
  - `pub fn snapshot_png(app: &AppHandle, served: Arc<Served>, url: String, width: u32, height: u32, out_width: u32) -> Result<Vec<u8>, String>` — a hidden child wry webview at `width × height` (Ruling 4) with the canvas protocol and navigation rules, waits for load plus 300 ms, `takeSnapshotWithConfiguration` (`rect` the full artboard, `snapshotWidth = out_width`, `afterScreenUpdates = true`), PNG bytes, then ends the view through `view::end`'s `_killWebContentProcess` path. Times out after 15 s with `RENDER_FAILED = "Zorvo could not draw that artboard."`
  - `pub fn render_pdf(app: &AppHandle, served: Arc<Served>, url: String, width: u32, height: u32) -> Result<Vec<u8>, String>` — same view, `createPDFWithConfiguration` with `rect` the full artboard.
  - `pub struct ThumbQueue` (one render at a time; a job for a hash already in the cache or already queued is skipped; a job whose artboard's hash changed before its turn is dropped)
  - Command `canvas_thumbs(session_id, key) -> Vec<BoardThumb>` (`BoardThumb { id, sha256, ready: bool }`), queueing the missing ones at `out_width = min(720, width)`; event `canvas-thumb` (`{sessionId, key, artboardId, sha256}`) when one is ready.
  - Cache `<data dir>/canvas-thumbs/<sha256>.png`; the file's modification time is touched when listed; `sweep_thumbs(dir, now)` at start removes files older than 30 days.
  - `useCanvas` adds `thumbs: ReadonlyMap<artboardId, url>` from `canvas_thumbs` and `canvas-thumb`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn queue_skips_cached_and_queued_hashes()
#[test] fn queue_drops_a_job_whose_hash_changed()
#[test] fn sweep_removes_only_old_pngs_named_by_a_hash() // keeps "notes.txt" and a fresh one
// tests/it/canvas_render_test.rs (#[ignore])
#[test] #[ignore] fn renders_a_fixture_artboard_to_a_full_png_and_one_pdf_page() // 1440×900 → PNG 1440 wide at out_width 1440 (2880 at scale 2 is the export case), PDF 1 page 1440×900
```

```ts
it("shows a picture when canvas-thumb arrives for the current hash only") // use-canvas.test.tsx: an old hash is ignored
```

- [ ] **Step 2:** `cargo test --lib artifacts::render` and the Vitest file → FAIL.
- [ ] **Step 3:** Implement. Add `mod canvas_render_test;` to `tests/it/main.rs`.
- [ ] **Step 4:** PASS; run the ignored test by hand once (`cargo test --test it canvas_render_test -- --ignored`) and note the result in the commit; clippy.
- [ ] **Step 5: Commit** — `feat: draw canvas artboards as pictures`

---

### Task 9: Comments on artboards

**Files:**
- Modify: `src/types.ts` (`ArtifactComment.canvas?: { key: string; artboardId: string; fileHash: string }`), `src/lib/persistence.ts`, `src-tauri/src/store.rs` (lenient readers), `src/lib/artifact-comments.ts`, `src/hooks/useArtifactComments.ts`, `src/components/artifacts/CanvasViewer.tsx`, `CanvasHeader.tsx`, `src-tauri/src/artifacts/commands.rs` (`canvas_comment_mode`, `canvas_view_marks`), `src-tauri/src/artifacts/view.rs`
- Test: `src/test/artifact-comments.test.ts`, `src/test/use-artifact-comments.test.tsx`, `src/test/persistence.test.ts`, `src-tauri/src/store.rs` tests, `src/test/canvas-viewer.test.tsx`

**Interfaces:**
- Consumes: `canvas-pick` (Task 7), `__zorvoCanvas.mode/marks` (Task 5), `ArtifactCommentStrip`.
- Produces:
  - Commands `canvas_comment_mode(session_id, key, on: bool)` (turns comment mode on in every live artboard through the wrapper; the backend's `COMMENTING` flag gates picks as today) and `canvas_view_marks(session_id, key, artboard_id, marks: Vec<PageMark>)` (`checked_marks`, then `__zorvoCanvas.marks`).
  - `canvasCommentStatus(comment: ArtifactComment, boards: readonly BoardState[]): ArtifactCommentStatus` — `current` when the board's `sha256` equals `comment.canvas.fileHash`, else `outdated` (a missing file is outdated).
  - `commentNumbers` numbers canvas comments over the whole canvas, oldest first.
  - `canvasMarksFor(comments, key, artboardId, sha256): PageMark[]` — only Current comments of that artboard.
  - `canvasHeading(entry: CanvasEntry, canvas: Canvas, board: CanvasArtboard, cwd: string): string` → ``Comments on `design/checkout/pay-b.html` (Checkout, artboard Payment B)``, the path relative to `cwd` as artifact headings do.
  - `artifactMessage` groups canvas comments under one heading per artboard.
  - Header: **Comment** toggles comment mode for the canvas; with an artboard selected and comment mode off, **Comment on artboard** opens the candidate box with a whole-artboard anchor (`{ kind: 'artboard' }`, added to `ArtifactAnchor`, summary "Whole artboard").
  - Marks are sent for each live artboard when it loads (the wrapper reports `canvas-board-loaded`, a shell kind added to Task 7's list) and when comments change.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads a canvas comment Current while the hash matches and Outdated after")
it("numbers canvas comments over the whole canvas, oldest first")
it("marks only Current comments of the artboard asked for")
it("words the heading with the artboard's file relative to the session folder")
it("keeps a canvas comment through save and load, and drops a malformed canvas field") // persistence.test.ts
it("turns a canvas-pick into a candidate on that artboard")             // use-artifact-comments.test.tsx
it("offers Comment on artboard for the selected artboard")              // canvas-viewer.test.tsx
```

```rust
#[test] fn keeps_a_canvas_comment_and_drops_a_bad_one() // store.rs lenient reader
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; lint; clippy.
- [ ] **Step 5: Commit** — `feat: comment on canvas artboards`

---

### Task 10: Pick and Build this

**Files:**
- Modify: `src/lib/canvas.ts`, `src/components/artifacts/CanvasHeader.tsx`, `src/components/artifacts/CanvasViewer.tsx`, `src/App.tsx` (pass `insertText` from `ComposerHandle`, the same path Reply uses, gated by `replyBlockedReason`)
- Test: `src/test/canvas.test.ts`, `src/test/canvas-viewer.test.tsx`

**Interfaces:**
- Produces:
  - `pickMessage(canvas: Canvas, folder: string, board: CanvasArtboard): string` → ``Use variant Payment B (`design/checkout/pay-b.html`) from the Checkout canvas. Drop the other pay variants: `pay-a.html`.`` (other variants' files in canvas order, comma-separated; titles and files through `escapeVisible`)
  - `buildMessage(folder: string, board: CanvasArtboard): string` → ``Build the Payment B screen from `design/checkout/pay-b.html` (1440 × 900) in this repository.``
  - `buildSectionMessage(canvas: Canvas, folder: string, section: CanvasSection): string` → "Build the screens of the Flow section of the Checkout canvas in this repository, in this order:" then one line per artboard `- Cart: `design/checkout/cart.html` (1440 × 900)`.
  - Header: **Pick** (selected artboard has a `group`), **Build this** (an artboard is selected), **Build section** in the Sections menu; disabled with the `replyBlockedReason` sentence when the composer cannot take text.

- [ ] **Step 1: Write the failing tests** — the three messages with the spec's exact wording on the spec's example canvas; a title with U+202E is escaped; Pick is absent for an artboard without a group; Build this inserts once into the composer and does not send.
- [ ] **Step 2:** `pnpm vitest run src/test/canvas.test.ts src/test/canvas-viewer.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; lint.
- [ ] **Step 5: Commit** — `feat: pick a variant and hand an artboard to the agent`

---

### Task 11: Export

**Files:**
- Modify: `src-tauri/Cargo.toml` (macOS: `objc2-pdf-kit = { version = "0.3", features = ["PDFDocument", "PDFPage"] }`, the version resolved must use `objc2` 0.6.5), `src-tauri/src/artifacts/render.rs`, `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs`, `src/components/artifacts/CanvasHeader.tsx`, `src/lib/canvas.ts`
- Test: `render.rs` unit tests, `commands.rs` unit tests, `tests/it/canvas_render_test.rs` (`#[ignore]`), `src/test/canvas-viewer.test.tsx`

**Interfaces:**
- Produces:
  - `pub fn join_pdfs(pages: Vec<Vec<u8>>) -> Result<Vec<u8>, String>` (PDFKit: a `PDFDocument`, each page's first page inserted in order)
  - `pub fn export_file_stem(section_id: &str, artboard_id: &str) -> String` → `"<section>-<artboard>"`
  - `pub enum ExportFormat { Png, Pdf }`, `pub struct ExportOutcome { pub written: u32, pub failed: Vec<String> }` (`failed` holds artboard ids)
  - Command `canvas_export(session_id, key, artboard_ids: Option<Vec<String>>, format: String) -> Option<ExportOutcome>` (`None` when the dialog is cancelled): PNG of one artboard → save dialog `<stem>.png`; PNG of several → folder dialog, one `<stem>.png` each (an existing file of that name is not overwritten: `<stem> 2.png`); PDF → save dialog `<canvas title>.pdf`, one page per artboard in canvas order. PNG at 2× (`out_width = 2 × width`).
  - Header: **Export** menu — "This artboard as PNG", "This artboard as PDF" (with a selection), "All artboards as PNG", "Whole canvas as PDF"; a notice "Exported N artboards." or "Exported N artboards. M could not be drawn." (names of the failed ones in the notice).

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn export_names_files_by_section_and_artboard()
#[test] fn a_taken_name_gets_a_number() // "flow-cart.png" exists → "flow-cart 2.png"
#[test] fn export_keeps_canvas_order_for_pdf_pages() // pure: the order of ids handed to render
#[test] #[ignore] fn joins_three_pages_into_one_pdf() // tests/it: page count 3, sizes kept
```

```ts
it("offers the export menu items for a selection and for the whole canvas")
it("says how many were exported and which could not be drawn")
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; ignored test by hand; clippy; lint.
- [ ] **Step 5: Commit** — `feat: export canvas artboards as PNG and PDF`

---

### Task 12: Docs and the real-app check

**Files:**
- Modify: `CLAUDE.md` (**Artifacts**, **Artifact comments**: the canvas kind, `canvases.json`, the wrapper and its CSP, frame matching, pictures and their cache, export; the fake agent's fixture canvas), `README.md` (what a canvas is, that it stays in the project folder, nothing new reaches the network), `CHANGELOG.md` (Unreleased, Added: "**Design canvas.** …"), `src/lib/artifact-guide.md` (one line pointing to `artifact_guide` with `kind: "canvas"`), `docs/superpowers/specs/2026-11-16-artifacts-design.md` (out of scope: the canvas now has its spec)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Real app (review build, `pnpm tauri build --debug --bundles app --config '{"identifier":"xyz.zorvo.desktop.review","productName":"ZorvoReview","bundle":{"createUpdaterArtifacts":false}}'`): ask Qwen Code, with no mention of canvas, for "three variants of a checkout payment screen and the screens before and after it"; confirm it makes a canvas from the guide alone, then check pan and zoom (window in front), live artboards versus pictures, a comment on an element and on a whole artboard sent to the agent, Pick, Build this, the four export items, a window covering the canvas, and `canvas.json` broken by hand while open. Record what was seen and what was not in the PR body.
- [ ] **Step 3:** `pnpm lint`, the Vitest files of Tasks 4–11, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib artifacts:: agent_tools::`, `cargo test --test it acp_ agent_tools`.
- [ ] **Step 4: Commit** — `docs: the design canvas`
