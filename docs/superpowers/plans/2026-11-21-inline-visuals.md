# Inline Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent calls `show_visual` and a static SVG or HTML picture appears inside its reply, themed, exportable as SVG, HTML or PNG.

**Architecture:** The backend cleans the agent's markup with an allowlist sanitizer and keeps it under the session's artifact folder; the transcript holds only `{id, title, visualKind}` as a reply part. The chat shows it in a `srcdoc` iframe with `sandbox="allow-same-origin"` (no scripts), whose document the backend builds from one wrapper generated from `tokens.json`. PNG export reuses the hidden-webview drawing of `artifacts/render.rs` through a route of the artifact protocol.

**Tech Stack:** Rust (Tauri 2, wry 0.57.2, objc2 AppKit, `ammonia`), React 19, Tailwind 4, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-21-inline-visuals-design.md`

## Global Constraints

- A visual's iframe is `sandbox="allow-same-origin"`. Never `allow-scripts`.
- At most 256 KiB (262,144 bytes) per visual, 100 visuals per session.
- The webview sends ids to read, export or copy a visual, never a path. Only `visual_show` carries the agent's `code` or `path`, relayed from the tool call.
- A refusal is a fixed sentence and never repeats what the agent sent.
- `STATE_VERSION` stays 2. Nothing is added to `state.json`.
- Every backend command that takes a folder calls `files::ensure_known_workspace` first.
- Commands that touch disk or draw are `#[tauri::command(async)]`.
- No raw colours in components; use tokens. Focusable controls get `focus-ring`. No `duration-*` on transitions; entrances are `motion-safe:animate-appear` or `animate-menu-in`.
- UI copy: sentence case, short sentences, name the agent, no em dash.
- Run only the targeted test files locally. From `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and the named `cargo test` filters. `pnpm lint` for anything under `src/`.
- A new file in `src-tauri/tests/it/` needs a `mod` line in `tests/it/main.rs`.
- Commit with explicit paths (`git add <paths>`), never `git add -A`. Conventional Commits.

## Review Focus

1. **Markup that tries to leave its frame** (`</iframe>`, `"` in attributes, `</style><script>`): it must show as content or be dropped, never end the wrapper. Tests in Task 2 and Task 8.
2. **A visual shown while its session is not on screen or its transcript is not loaded:** the part must still land in that session's reply. Test in Task 7.
3. **An SVG with a fixed large `width`/`height` or no `viewBox`:** it must fit the column, not overflow it. Test in Task 3.
4. **A rewind sweep racing a visual shown a moment ago:** the sweep must not delete a visual whose part has not rendered yet. Test in Task 4.
5. **Markup that is empty after cleaning** (only a `<script>`, only white space): the agent gets the "nothing to show" refusal and no file is written. Test in Task 5.

---

### Task 0: Spike (gate)

Throwaway code. Nothing from it is kept but the report.

**Files:**
- Create: `experiments/inline-visuals-spike/` (throwaway, not committed)
- Create: `docs/superpowers/specs/2026-11-21-inline-visuals-spike-report.md`
- Modify: `docs/superpowers/specs/2026-11-21-inline-visuals-design.md` (section 6: results)

- [ ] **Step 1:** On a scratch branch, mount one hard-coded `<iframe sandbox="allow-same-origin" srcdoc>` in the chat, whose markup holds: an inline `<script>`, an `onclick`, an `<a href="javascript:…">`, a `<meta http-equiv="refresh" content="0;url=https://example.com">`, a `<form action="https://example.com">` with a submit button, an `<img src="https://example.com/x.png">`, and an `<a href="https://example.com">`.
- [ ] **Step 2:** Build as the release does (`pnpm tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'`), open the app, and record for each item whether it ran, navigated or loaded. Expected: none did.
- [ ] **Step 3:** From the parent, read `iframe.contentDocument.documentElement.scrollHeight`, attach a `click` listener to `contentDocument`, and record whether `navigation_guard.rs` logs a navigation when the plain link is clicked without `preventDefault`.
- [ ] **Step 4:** Replace the markup with 256 KiB of CSS using `filter: blur()` and infinite animations on 2,000 elements; scroll the chat and type in the composer. Record whether the interface stays responsive.
- [ ] **Step 5:** In a scratch Rust test, call `render::snapshot_png` on a URL that serves an HTML fragment with a solid background, and put the PNG on `NSPasteboard`; paste it into Preview.
- [ ] **Step 6:** Write the report (one table: question, result, evidence) and copy the table into the spec's section 6. Commit the report and the spec.

```bash
git add docs/superpowers/specs/2026-11-21-inline-visuals-spike-report.md docs/superpowers/specs/2026-11-21-inline-visuals-design.md
git commit -m "docs: inline visuals spike report"
```

- [ ] **Step 7: STOP.** Show the report to the user. If question 1 or 2 failed, the display approach changes to PNG and Tasks 8 and 9 are re-planned. If question 3 failed, Task 2 also strips `filter` and animation. If question 4 failed, Task 10 ships without PNG and Copy as image.

### Task 1: Artboards (gate)

**Files:**
- Create: `docs/superpowers/specs/2026-11-21-inline-visuals-artboards/` (built from the existing chat artboard files)

- [ ] **Step 1:** Add a section "Inline visuals" to the v2 canvas with these artboards, dark and light: `ChatVisual` (block in a reply between two paragraphs), `ChatVisualMenu` (⋯ open), `ChatVisualFolded`, `ChatVisualExpanded` (dialog), `ChatVisualGone`, `ChatVisualFailed`.
- [ ] **Step 2:** Commit the folder. **STOP** for the user's review. The canvas decides look and copy; later tasks copy strings from it. Where it and this plan differ on wording, the canvas wins.

### Task 2: Sanitizer

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `ammonia`, exact version, newest at least 7 days old)
- Create: `src-tauri/src/artifacts/visual_clean.rs`
- Modify: `src-tauri/src/artifacts/mod.rs` (`pub mod visual_clean;`)

**Interfaces:**
- Produces:
  - `pub const MAX_VISUAL_BYTES: usize = 256 * 1024;`
  - `#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)] #[serde(rename_all = "lowercase")] pub enum VisualKind { Svg, Html }`
  - `pub fn kind_of(markup: &str) -> VisualKind` (`Svg` when the text, after leading white space and an optional `<?xml …?>`, starts with `<svg`)
  - `pub fn clean(markup: &str) -> String`
  - `pub fn is_empty_visual(cleaned: &str) -> bool` (true when no element and no non-white-space text is left)

- [ ] **Step 1: Write the failing tests** in `visual_clean.rs`'s `#[cfg(test)]` module:

```rust
#[test]
fn drops_everything_that_could_run_or_navigate() {
    for bad in [
        "<script>alert(1)</script>", "<p onclick=\"x()\">a</p>", "<a href=\"javascript:x()\">a</a>", "<a href=\"https://e.com\">a</a>",
        "<meta http-equiv=\"refresh\" content=\"0;url=https://e.com\">", "<base href=\"https://e.com\">",
        "<iframe src=\"https://e.com\"></iframe>", "<object data=\"x\"></object>", "<embed src=\"x\">",
        "<form action=\"https://e.com\"><button>go</button></form>", "<link rel=\"stylesheet\" href=\"x\">",
        "<svg><script>alert(1)</script></svg>", "<svg onload=\"x()\"></svg>",
    ] {
        let out = clean(bad).to_lowercase();
        for gone in ["href=\"http", "<script", "onclick", "onload", "javascript:", "http-equiv", "<base", "<iframe", "<object", "<embed", "<form", "<link"] {
            assert!(!out.contains(gone), "{gone} survived in {out}");
        }
    }
}
#[test]
fn keeps_style_and_svg_drawing() {
    let html = clean("<style>.a{color:var(--fg)}</style><div class=\"a\" style=\"padding:8px\">hi</div>");
    assert!(html.contains("<style>") && html.contains("var(--fg)") && html.contains("style=\"padding:8px\""));
    let svg = clean("<svg viewBox=\"0 0 10 10\"><defs><marker id=\"m\"/></defs><rect x=\"1\" y=\"1\" width=\"2\" height=\"2\" fill=\"var(--accent)\"/><path d=\"M0 0L1 1\" marker-end=\"url(#m)\"/><text x=\"1\" y=\"1\">a</text></svg>");
    for kept in ["viewBox", "<rect", "<path", "<text", "<marker", "marker-end", "var(--accent)"] { assert!(svg.contains(kept), "{kept}"); }
}
#[test]
fn text_that_looks_like_a_closing_frame_stays_text() {
    let out = clean("<p>&lt;/iframe&gt;&lt;script&gt;</p>");
    assert!(!out.contains("</iframe>") && !out.contains("<script"));
}
#[test]
fn kind_follows_the_first_tag() {
    assert_eq!(kind_of("  <svg></svg>"), VisualKind::Svg);
    assert_eq!(kind_of("<?xml version=\"1.0\"?>\n<svg></svg>"), VisualKind::Svg);
    assert_eq!(kind_of("<div><svg></svg></div>"), VisualKind::Html);
}
#[test]
fn only_a_script_leaves_nothing() {
    assert!(is_empty_visual(&clean("<script>1</script>  ")));
    assert!(!is_empty_visual(&clean("<p>a</p>")));
}
```

- [ ] **Step 2:** Run `cargo test visual_clean::` from `src-tauri/`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** One `ammonia::Builder` built once (`OnceLock`): start from an empty tag set and add HTML layout and text tags (`div span p h1`-`h6 ul ol li table thead tbody tr th td br hr strong em b i code pre small sub sup blockquote figure figcaption img style`) and SVG tags (`svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath marker linearGradient radialGradient stop clipPath mask pattern title desc`). Generic attributes: `class id style title role aria-label aria-hidden`. SVG presentation and geometry attributes per tag (include `viewBox`, `marker-end`, `marker-start`, `fill`, `stroke`, `transform`, `d`, `points`, `x y x1 y1 x2 y2 cx cy r rx ry width height`, `text-anchor`, `dominant-baseline`, `font-size`, `font-weight`, `opacity`, `stop-color`, `offset`, `gradientUnits`, `href` on `use` restricted to `#fragment`). `a` is allowed with no `href` (a visual has no links; the spike showed Zorvo cannot catch a click in the frame). `img` `src` limited to `data:`. `clean_content_tags`: `script`. Keep `<style>` content.
- [ ] **Step 4:** Run `cargo test visual_clean::`. Expected: PASS.
- [ ] **Step 5:** Commit.

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/artifacts/visual_clean.rs src-tauri/src/artifacts/mod.rs
git commit -m "feat: clean an inline visual's markup with an allowlist"
```

### Task 3: Wrapper document

One wrapper serves the iframe, the HTML export and the PNG, so they cannot drift.

**Files:**
- Create: `src-tauri/src/artifacts/visual_wrapper.rs`
- Modify: `src-tauri/src/artifacts/mod.rs`

**Interfaces:**
- Consumes: `VisualKind` (Task 2)
- Produces:
  - `#[derive(Deserialize, Clone, Copy, PartialEq, Debug)] #[serde(rename_all = "lowercase")] pub enum Theme { Dark, Light }`
  - `pub fn document(markup: &str, fixed: Option<Theme>) -> String`: a whole HTML document. `None` follows `prefers-color-scheme` on a transparent background; `Some(theme)` uses that theme's values only and paints `body` with the `sheet` token.
  - `pub fn token_names() -> Vec<String>`

- [ ] **Step 1: Write the failing tests:**

```rust
#[test]
fn every_variable_comes_from_tokens_json() {
    let names = token_names();
    assert!(names.contains(&"fg".to_string()) && names.contains(&"sheet".to_string()));
    let doc = document("<p>a</p>", None);
    for name in &names { assert!(doc.contains(&format!("--{name}:")), "{name}"); }
}
#[test]
fn follows_the_scheme_unless_fixed() {
    let live = document("<p>a</p>", None);
    assert!(live.contains("prefers-color-scheme: light") && live.contains("background: transparent"));
    let light = document("<p>a</p>", Some(Theme::Light));
    assert!(!light.contains("prefers-color-scheme") && light.contains("background: var(--sheet)"));
}
#[test]
fn ends_motion_and_fits_media_to_the_column() {
    let doc = document("<svg width=\"4000\" height=\"10\"></svg>", None);
    assert!(doc.contains("prefers-reduced-motion: reduce"));
    assert!(doc.contains("svg, img { max-width: 100%; height: auto; }"));
    assert!(doc.contains("overflow-x: hidden"));
}
#[test]
fn has_no_script_and_starts_as_a_document() {
    let doc = document("<p>a</p>", None);
    assert!(doc.starts_with("<!doctype html>") && !doc.to_lowercase().contains("<script"));
}
```

- [ ] **Step 2:** Run `cargo test visual_wrapper::`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read `include_str!("../../../docs/design-system/tokens.json")`, take `color.tokens[]` (`name`, `value.dark`, `value.light`), and emit `:root{--<name>: <dark>}` with a light block or the fixed theme's values. Base rules: `html,body{margin:0}`, `body{font: 14px/1.5 -apple-system, system-ui, sans-serif; color: var(--fg); overflow-x: hidden}`, the two rules the test names, and `@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}`. The markup goes inside `<body>` unchanged (it is already cleaned).
- [ ] **Step 4:** Run `cargo test visual_wrapper::`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: one wrapper document for inline visuals`.

### Task 4: Store

**Files:**
- Create: `src-tauri/src/artifacts/visuals.rs` (an `impl ArtifactStore` block and its types)
- Modify: `src-tauri/src/artifacts/mod.rs`, `src-tauri/src/artifacts/store.rs` (make the session-lock and session-dir helpers `pub(super)` if they are private)

**Interfaces:**
- Consumes: `VisualKind`, `MAX_VISUAL_BYTES`, `clean`, `is_empty_visual`, `kind_of`
- Produces:
  - `pub const MAX_VISUALS: usize = 100;`
  - `pub const SWEEP_GRACE: Duration = Duration::from_secs(60);`
  - Refusals: `VISUAL_TOO_LARGE = "The visual is over 256 KB."`, `VISUAL_NOT_TEXT = "The visual is not valid UTF-8 text."`, `VISUAL_EMPTY = "There is nothing to show in that visual."`, `TOO_MANY_VISUALS = "This session already has 100 visuals."`, `VISUAL_FAILED = "Zorvo could not keep that visual."`, `VISUAL_GONE = "That visual is no longer available."`
  - `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")] pub struct VisualEntry { pub id: String, pub title: String, pub kind: VisualKind, pub bytes: u64, pub shown_at: u64 }` (`shown_at` in ms since the epoch)
  - `pub fn is_visual_id(id: &str) -> bool` (`v-` then 16 lowercase hex)
  - `impl ArtifactStore { pub fn put_visual(&self, session_id: &str, title: &str, raw: &[u8], now_ms: u64) -> Result<VisualEntry, String>; pub fn visual(&self, session_id: &str, id: &str) -> Result<(VisualEntry, String), String>; pub fn keep_visuals(&self, session_id: &str, keep: &[String], now_ms: u64) -> Result<usize, String>; }`

Layout: `<root>/<sessionId>/visuals/<id>.html|.svg` (0600, written aside and renamed) and `<root>/<sessionId>/visuals.json` (the entries, oldest first), under the session's lock.

- [ ] **Step 1: Write the failing tests** (tempdir store, `is_session_id`-valid session id):

```rust
#[test] fn keeps_the_cleaned_markup_and_lists_it() {
    let e = store.put_visual(S, "Flow", b"<svg><script>1</script><rect/></svg>", 1_000).unwrap();
    assert!(is_visual_id(&e.id)); assert_eq!(e.kind, VisualKind::Svg); assert_eq!(e.title, "Flow");
    let (entry, markup) = store.visual(S, &e.id).unwrap();
    assert_eq!(entry, e); assert!(markup.contains("<rect") && !markup.contains("script"));
}
#[test] fn refuses_by_rule_without_writing() {
    assert_eq!(store.put_visual(S, "T", &vec![b'a'; MAX_VISUAL_BYTES + 1], 0).unwrap_err(), VISUAL_TOO_LARGE);
    assert_eq!(store.put_visual(S, "T", &[0xff, 0xfe], 0).unwrap_err(), VISUAL_NOT_TEXT);
    assert_eq!(store.put_visual(S, "T", b"<script>1</script>", 0).unwrap_err(), VISUAL_EMPTY);
    assert_eq!(store.put_visual(S, "  ", b"<p>a</p>", 0).unwrap_err(), NEEDS_TITLE_VISUAL);
    assert!(!root.join(S).join("visuals").exists() || fs::read_dir(root.join(S).join("visuals")).unwrap().next().is_none());
}
#[test] fn stops_at_one_hundred() { /* 100 puts succeed, the 101st is TOO_MANY_VISUALS */ }
#[test] fn sweep_keeps_named_and_recent_ones() {
    let old = store.put_visual(S, "A", b"<p>a</p>", 0).unwrap();
    let kept = store.put_visual(S, "B", b"<p>b</p>", 0).unwrap();
    let fresh = store.put_visual(S, "C", b"<p>c</p>", 100_000).unwrap();
    assert_eq!(store.keep_visuals(S, &[kept.id.clone()], 100_000 + 59_000).unwrap(), 1);
    assert_eq!(store.visual(S, &old.id).unwrap_err(), VISUAL_GONE);
    assert!(store.visual(S, &kept.id).is_ok() && store.visual(S, &fresh.id).is_ok());
}
#[test] fn an_unknown_or_malformed_id_is_gone() {
    assert_eq!(store.visual(S, "v-0000000000000000").unwrap_err(), VISUAL_GONE);
    assert_eq!(store.visual(S, "../x").unwrap_err(), VISUAL_GONE);
}
#[test] fn deleting_the_session_removes_its_visuals() { /* put, delete_session(S), visual(...) is VISUAL_GONE */ }
```

Add `pub const NEEDS_TITLE_VISUAL: &str = "Give the visual a title.";` to Produces. The title goes through the existing `clean_title`.

- [ ] **Step 2:** Run `cargo test artifacts::visuals::`. Expected: FAIL.
- [ ] **Step 3: Implement** the three methods. `keep_visuals` deletes an entry only when its id is not in `keep` and `now_ms - shown_at >= SWEEP_GRACE`; it returns the number deleted.
- [ ] **Step 4:** Run `cargo test artifacts::visuals::`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: keep inline visuals with the session's artifacts`.

### Task 5: The tool and its commands

**Files:**
- Modify: `src-tauri/src/agent_tools/tools.rs` (`TOOL_NAMES` to 11, `tool_list`, `validate`, `put_kind`)
- Modify: `src-tauri/src/agent_tools/protocol.rs` (only if a test there pins the count)
- Modify: `src-tauri/src/artifacts/source.rs`, `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs` (`generate_handler!`)
- Create: `src-tauri/tests/it/visuals_e2e_test.rs`; modify `src-tauri/tests/it/main.rs`

**Interfaces:**
- Consumes: Task 3 `document`, `Theme`; Task 4 store methods
- Produces:
  - `tools.rs`: `show_visual` takes `title`, `code`, `path`; `VISUAL_ONE_SOURCE = "Give show_visual either code or path, not both."`; `put_kind` accepts `"visual"` for `artifact_guide` only.
  - `source.rs`: `pub fn read_visual_source(session_folder: &Path, temp_roots: &[PathBuf], path: &str) -> Result<Vec<u8>, String>` (`.html`, `.htm`, `.svg`; refuses over `MAX_VISUAL_BYTES` with `VISUAL_TOO_LARGE`; otherwise `NOT_ALLOWED`)
  - Commands (camelCase keys from the webview):
    - `visual_show(session_id: String, cwd: String, title: String, code: Option<String>, path: Option<String>) -> Result<VisualEntry, String>`
    - `visual_read(session_id: String, id: String) -> Result<VisualRead, String>` with `#[serde(rename_all = "camelCase")] pub struct VisualRead { pub entry: VisualEntry, pub document: String }` (`document(markup, None)`)
    - `visual_sweep(session_id: String, keep: Vec<String>) -> Result<usize, String>`

- [ ] **Step 1: Write the failing unit tests** in `tools.rs`:

```rust
#[test] fn there_are_eleven_tools_and_show_visual_is_one() { assert_eq!(TOOL_NAMES.len(), 11); assert!(TOOL_NAMES.contains(&"show_visual")); }
#[test] fn show_visual_takes_exactly_one_source() {
    assert!(validate("show_visual", &json!({"title": "A", "code": "<p>a</p>"})).is_ok());
    assert!(validate("show_visual", &json!({"title": "A", "path": "a.svg"})).is_ok());
    assert_eq!(validate("show_visual", &json!({"title": "A"})).unwrap_err(), VISUAL_ONE_SOURCE);
    assert_eq!(validate("show_visual", &json!({"title": "A", "code": "<p>", "path": "a.svg"})).unwrap_err(), VISUAL_ONE_SOURCE);
    assert!(validate("show_visual", &json!({"code": "<p>a</p>"})).is_err());
}
#[test] fn show_visual_caps_code_by_bytes_without_repeating_it() {
    let big = "a".repeat(256 * 1024 + 1);
    let refused = validate("show_visual", &json!({"title": "A", "code": big})).unwrap_err();
    assert_eq!(refused, "The visual is over 256 KB.");
}
#[test] fn artifact_guide_takes_kind_visual_and_show_artifact_does_not() {
    assert_eq!(validate("artifact_guide", &json!({"kind": "visual"})).unwrap(), json!({"kind": "visual"}));
    assert!(validate("show_artifact", &json!({"path": "d", "kind": "visual"})).is_err());
}
#[test] fn show_visual_says_nothing_runs_and_names_the_guide() {
    let d = description_of("show_visual");
    for part in ["inside your reply", "No script runs", "artifact_guide with kind visual"] { assert!(d.contains(part), "{part}"); }
}
```

The tool's description: "Show the user a picture inside your reply: a flow or architecture diagram, or a mockup of a card or screen. Use it without being asked when a picture explains the answer better than a list. Pass an SVG document or an HTML fragment with its CSS as code, or write a .svg or .html file in this folder or the temporary folder and pass its path. No script runs and nothing loads from the network. For a page the user keeps and reopens, use show_artifact. Call artifact_guide with kind visual before your first visual."

- [ ] **Step 2:** Run `cargo test agent_tools::tools::`. Expected: the new tests FAIL; fix the existing count assertions the change breaks (`TOOL_NAMES: [&str; 11]`).
- [ ] **Step 3: Implement** the tool, `read_visual_source` (with a unit test that `.svg` passes, `.txt` is `NOT_ALLOWED`, and a file of `MAX_VISUAL_BYTES + 1` is `VISUAL_TOO_LARGE`), and the three commands. `visual_show` calls `ensure_known_workspace(cwd)`, takes the bytes from `code` or from `read_visual_source`, calls `put_visual`, and emits `artifacts-changed` (`{sessionId}`). Register the commands in `lib.rs`.
- [ ] **Step 4: Write the end-to-end test** `visuals_e2e_test.rs`, modelled on `agent_tools_e2e_test.rs`: the fake agent with `FAKE_ACP_MCP_CALL={"tool":"show_visual","args":{"title":"Flow","code":"<svg><rect/></svg>"}}` and `FAKE_ACP_MCP_LOG`; the test answers the emitted `agent-tool-call` with `ok: true, text: "{\"shown\":true}"` and asserts the log holds `tools/list` naming `show_visual` and the call's result text. Add `mod visuals_e2e_test;`.
- [ ] **Step 5:** Run `cargo test agent_tools::tools:: artifacts::` and `cargo test --test it visuals_e2e_test::`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: show_visual tool and its commands`.

### Task 6: Frontend rules and the reply part

**Files:**
- Modify: `src/types/index.ts` (`ChatMessagePart`)
- Create: `src/lib/visuals.ts`, `src/lib/visual-guide.md`, `src/lib/visual-part.ts`
- Modify: `src/lib/persistence.ts` (part validation), `src/lib/acp-subagents.ts` and `src/lib/task-view.ts` (only where a switch over part kinds must ignore `visual`)
- Test: `src/test/visuals.test.ts`, `src/test/visual-part.test.ts`, `src/test/visual-guide.test.ts`; extend `src/test/persistence.test.ts`

**Interfaces:**
- Produces:
  - `ChatMessagePart |= { kind: 'visual'; id: string; title: string; visualKind: 'svg' | 'html' }`
  - `visuals.ts`: `VISUAL_GUIDE: string`; `VISUAL_REFUSALS: ReadonlySet<string>` (the seven an agent can get: `VISUAL_TOO_LARGE`, `VISUAL_NOT_TEXT`, `VISUAL_EMPTY`, `TOO_MANY_VISUALS`, `VISUAL_FAILED`, `NEEDS_TITLE_VISUAL`, `VISUAL_ONE_SOURCE`; not `VISUAL_GONE`, which only the webview sees); `interface VisualEntry { id; title; kind: 'svg' | 'html'; bytes: number; shownAt: number }`; `isVisualId(value: unknown): value is string`; `parseVisualEntry(value: unknown): VisualEntry | null`; `parseVisualRead(value: unknown): { entry: VisualEntry; document: string } | null`; `VISUAL_SHOWN_TEXT = '{"shown":true}'`; `visualIdsOf(messages: readonly ChatMessage[]): string[]`
  - `visual-part.ts`: `withVisualPart(messages: ChatMessage[], entry: VisualEntry, ctx: AcpReducerContext): ChatMessage[]` (appends the part to the open reply's `parts` through `withOpenReply`; a reply with no `parts` yet gets its text as a first `text` part when it has content)

- [ ] **Step 1: Write the failing tests.**

```ts
// visuals.test.ts
test('the refusals are the sentences Rust returns', () => {
  const rust = [readFileSync('src-tauri/src/artifacts/visuals.rs', 'utf8'), readFileSync('src-tauri/src/agent_tools/tools.rs', 'utf8')].join('\n');
  for (const sentence of VISUAL_REFUSALS) expect(rust).toContain(`"${sentence}"`);
  expect(VISUAL_REFUSALS.size).toBe(7);
});
test('parses an entry and refuses a wrong shape', () => {
  expect(parseVisualEntry({ id: 'v-0123456789abcdef', title: 'Flow', kind: 'svg', bytes: 10, shownAt: 1 })).not.toBeNull();
  for (const bad of [null, {}, { id: 'x', title: 'a', kind: 'svg', bytes: 1, shownAt: 1 }, { id: 'v-0123456789abcdef', title: 'a', kind: 'png', bytes: 1, shownAt: 1 }]) expect(parseVisualEntry(bad)).toBeNull();
});
test('lists the visuals a transcript names, once each', () => { /* two messages, three parts, one id repeated: two ids */ });
// visual-part.test.ts
test('puts the visual after the text already in the open reply', () => { /* reply with parts [text] → [text, visual] */ });
test('starts a reply when none is open', () => { /* last message is the user's → a new agent message with one visual part */ });
test('a reply written before parts existed keeps its text first', () => { /* content "a", no parts → [text "a", visual] */ });
// persistence.test.ts
test('keeps a well-formed visual part and drops a malformed one', () => { /* id not a visual id, missing title, visualKind "png" are dropped; the rest of the message stays */ });
// visual-guide.test.ts
test('the guide names only variables tokens.json holds, and says what cannot be done', () => {
  const names = new Set(tokens.color.tokens.map((t) => t.name));
  for (const [, name] of VISUAL_GUIDE.matchAll(/--([a-z0-9-]+)/g)) expect(names.has(name)).toBe(true);
  for (const part of ['No script runs', 'transparent', 'data:', '[name]']) expect(VISUAL_GUIDE).toContain(part);
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/test/visuals.test.ts src/test/visual-part.test.ts src/test/visual-guide.test.ts src/test/persistence.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Write `visual-guide.md` with the five points of the spec's section 1 ("The guide"), the tokens an agent is most likely to need (`fg`, `fg-muted`, `border`, `border-strong`, `sheet`, `chip`, the accent and status tokens as `tokens.json` names them) each with one line on its use, and the rule that a diagram's boxes use `chip` fills and `border` strokes.
- [ ] **Step 4:** Run the same command, then `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: visual parts in a reply and their rules`.

### Task 7: Answering the tool call

**Files:**
- Modify: `src/hooks/useAgentTools.ts`, `src/lib/agent-tools-context.ts`, `src/App.tsx` (pass `onVisualShown`)
- Test: `src/test/use-agent-tools-visuals.test.tsx`; extend `src/test/agent-tools-context.test.ts`

**Interfaces:**
- Consumes: Task 5 `visual_show`; Task 6 `parseVisualEntry`, `VISUAL_REFUSALS`, `VISUAL_SHOWN_TEXT`, `VISUAL_GUIDE`, `withVisualPart`
- Produces: `useAgentTools` option `onVisualShown: (sessionId: string, entry: VisualEntry) => void`; `App.tsx` applies `withVisualPart` to that session's messages the way `withArtifactCard` is applied today (same path, so a session whose transcript is not loaded is handled as an artifact card is).

- [ ] **Step 1: Write the failing tests** (model on `use-agent-tools-artifacts.test.tsx`):

```tsx
test('show_visual keeps the visual and answers shown', async () => { /* invoke('visual_show') called with { sessionId, cwd, title, code }, no path key; respond(ok, '{"shown":true}'); onVisualShown called with the entry */ });
test('a refusal from the backend goes to the agent as it is', async () => { /* visual_show rejects 'The visual is over 256 KB.' → respond(not ok, that sentence) */ });
test('any other failure is one plain sentence and a notice', async () => { /* rejects 'ENOENT /Users/x' → agent gets 'Zorvo could not do that.', onNotice gets 'Zorvo could not show the visual an agent made.' */ });
test('artifact_guide with kind visual returns the visual guide', async () => {});
test('a session with no tools is told so', async () => { /* a compare-run session → NO_SESSION */ });
test('a visual for a session that is not on screen still lands in it', async () => { /* active session is B, call from A → onVisualShown('A', …) */ });
// agent-tools-context.test.ts
test('both contexts say when to show a visual', () => { for (const c of [MCP_PATH_CONTEXT, COMMAND_PATH_CONTEXT]) expect(c).toContain('show_visual'); });
```

- [ ] **Step 2:** Run `pnpm vitest run src/test/use-agent-tools-visuals.test.tsx src/test/agent-tools-context.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add to each context one sentence: "When a picture explains your answer better than a list (a flow, an architecture, a mockup), show it inside your reply with show_visual."
- [ ] **Step 4:** Run the same command, `pnpm vitest run src/test/tauri-contract.test.ts`, and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: answer show_visual and put the visual in the reply`.

### Task 8: The block in the chat

**Files:**
- Create: `src/hooks/useVisualDocument.ts`, `src/components/chat/VisualFrame.tsx`, `src/components/chat/VisualBlock.tsx`
- Modify: `src/components/chat/MessageRow.tsx` (both part switches, lines near 79 and 157)
- Test: `src/test/VisualBlock.test.tsx`, `src/test/VisualFrame.test.tsx`

**Interfaces:**
- Consumes: `visual_read`, `parseVisualRead`, `VISUAL_REFUSALS`
- Produces:
  - `useVisualDocument(sessionId: string, id: string, isNear: boolean): { status: 'idle' | 'loading' | 'ready' | 'gone' | 'failed'; document?: string; retry(): void }` (reads once when `isNear` first turns true; `gone` when the backend answers `VISUAL_GONE`)
  - `VisualFrame({ document, title, maxHeight, onHeight })`: the iframe; measures height on `load` and on its own width change; it adds no listener inside the frame (none would fire)
  - `VisualBlock({ sessionId, part, agentName, isPopout, isArriving })`
  - `export const VISUAL_SANDBOX = 'allow-same-origin'`, `export const MAX_VISUAL_HEIGHT = 2000`

Copy (the canvas wins where it differs): header second line `"{Agent} made this visual"`; gone `"This visual is no longer available."`; failed `"Zorvo could not show this visual."` with `Try again`; popout `"Shown in the main window."`; buttons named `Expand`, `Fold visual` / `Unfold visual`, `Visual actions`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// VisualFrame.test.tsx
test('the sandbox allows same origin and never scripts', () => {
  render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" maxHeight={2000} onHeight={() => {}} />);
  const frame = screen.getByTitle('Flow');
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
  expect(VISUAL_SANDBOX).not.toContain('allow-scripts');
});
test('markup that names a closing frame stays inside srcdoc', () => { /* document containing </iframe> and a double quote: one iframe in the DOM, its srcdoc equals the string */ });
test('measures the height again when the frame gets narrower', () => { /* ResizeObserver callback: a new scrollHeight becomes the height */ });
test('a tall document is capped and scrolls inside', () => { /* scrollHeight 5000 → style height 2000px */ });
// VisualBlock.test.tsx
test('reads the visual only once it is near the screen', () => {});
test('shows the title, who made it, and the frame', async () => {});
test('a visual that is gone says so and offers nothing else', async () => { /* no Expand, no menu */ });
test('a failed read offers Try again and reads again', async () => {});
test('folding hides the frame and keeps the header', async () => { /* aria-expanded on the toggle */ });
test('a popout shows the title and one line, and no frame', () => {});
test('unmounts the frame when it leaves and keeps its height', () => {});
```

- [ ] **Step 2:** Run `pnpm vitest run src/test/VisualBlock.test.tsx src/test/VisualFrame.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Nearness comes from one `IntersectionObserver` with a `rootMargin` of `600px`. The block is a `sheet`-level frame with a hairline `border-border`; the iframe has `className` `block w-full border-0` and `style={{ height }}`. `MessageRow` renders a `visual` part with `<VisualBlock>` and `motion-safe:animate-appear` only for an arrived key (`useArrivedKeys`).
- [ ] **Step 4:** Run the two test files, `pnpm vitest run src/test/design-tokens.test.ts src/test/motion.test.ts src/test/sheet-fills.test.ts`, and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: show an inline visual in the reply`.

### Task 9: Expand

**Files:**
- Create: `src/components/chat/VisualDialog.tsx`
- Modify: `src/components/chat/VisualBlock.tsx`
- Test: extend `src/test/VisualBlock.test.tsx`

**Interfaces:**
- Consumes: `VisualFrame`
- Produces: `VisualDialog({ title, document, onClose })`: a `role="dialog"` with `aria-modal`, `shadow-dialog`, the visual's title as its heading, a `Close` button, and the frame at up to the window's height.

- [ ] **Step 1: Write the failing tests:** Expand opens a dialog named by the title; Escape closes it and focus is on the Expand button; the dialog's frame has the same `sandbox` value; Expand is not offered while the visual is `gone`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/VisualBlock.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement,** following the dialog pattern `ImagePreviewDialog` uses.
- [ ] **Step 4:** Run it again and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: expand an inline visual`.

### Task 10: Export

**Files:**
- Modify: `src-tauri/src/artifacts/protocol.rs` (route and CSP), `src-tauri/src/artifacts/render.rs` (if `snapshot_png`'s `Served` needs a visual variant), `src-tauri/src/artifacts/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (`objc2-app-kit` feature `NSPasteboard`)
- Create: `src-tauri/src/artifacts/visual_export.rs`, `src/components/chat/VisualMenu.tsx`, `src/lib/visual-export.ts`
- Modify: `src/components/chat/VisualBlock.tsx`
- Test: unit tests in `protocol.rs` and `visual_export.rs`; `src/test/VisualMenu.test.tsx`; extend `src-tauri/tests/canvas_render.rs` (runs only with `ZORVO_RENDER_TEST=1`)

**Interfaces:**
- Consumes: Task 3 `document`, `Theme`; Task 4 `visual`
- Produces:
  - `protocol.rs`: `pub const VISUAL_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";` and the route `zorvo-artifact://localhost/visual/<session>/<id>?theme=dark|light`, served only on the hidden drawing view, body `document(markup, Some(theme))`
  - `visual_export.rs`: `pub fn export_name(title: &str, format: Format) -> String` (through `clean_file_stem(title, "visual")`); `pub enum Format { Svg, Html, Png }` parsed from `"svg" | "html" | "png"`; `pub fn offered(kind: VisualKind) -> [Format; 2]` (`[Svg, Png]` or `[Html, Png]`)
  - Commands: `visual_export(session_id: String, id: String, format: String, width: u32, height: u32, theme: String) -> Result<bool, String>` (`false` when the save dialog is cancelled); `visual_copy_image(session_id: String, id: String, width: u32, height: u32, theme: String) -> Result<(), String>`
  - `VISUAL_EXPORT_FAILED = "Zorvo could not save that visual."`, `VISUAL_COPY_FAILED = "Zorvo could not copy that visual."`
  - `visual-export.ts`: `menuItemsFor(kind: 'svg' | 'html'): { id: 'copy' | 'svg' | 'html' | 'png'; label: string }[]`; `themeNow(): 'dark' | 'light'`

`width` must be 200 to 2000 and `height` 1 to 8000, else the failed sentence. SVG writes the stored markup; HTML writes `document(markup, None)`; PNG is `snapshot_png` at `out_width = width * 2`.

- [ ] **Step 1: Write the failing Rust tests:** `VISUAL_CSP` equals the string above and holds no `script-src`; the route answers 404 for an unknown id, for a malformed id, and on any view but the drawing one; `offered(Svg)` is `[Svg, Png]` and `offered(Html)` is `[Html, Png]`; `export_name("Alur / bot", Png)` ends in `.png` and holds no `/`; a width of 199 or a height of 8001 is refused.
- [ ] **Step 2:** Run `cargo test artifacts::protocol:: artifacts::visual_export::`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, the two commands (save dialog as `artifact_export` does it; clipboard through `NSPasteboard::generalPasteboard`, `clearContents`, `setData:forType:` with `NSPasteboardTypePNG`, on the main thread), and register them.
- [ ] **Step 4: Write the failing frontend tests** in `VisualMenu.test.tsx`: an SVG visual offers Copy as image, Download as SVG, Download as PNG in that order; an HTML visual offers Download as HTML in the second place; the menu is `role="menu"`, opens on the first item, moves with the arrow keys, closes on Escape with focus back on the button; choosing Download as PNG invokes `visual_export` with `{ sessionId, id, format: 'png', width, height, theme }` and no other key; a rejected call raises the plain sentence as a notice.
- [ ] **Step 5:** Run `pnpm vitest run src/test/VisualMenu.test.tsx`. Expected: FAIL. Implement `VisualMenu` (panel style `POPOVER_PANEL_STYLE`, `animate-menu-in`) and wire it into `VisualBlock`.
- [ ] **Step 6:** Run the Rust filters, `pnpm vitest run src/test/VisualMenu.test.tsx src/test/tauri-contract.test.ts`, `pnpm lint`, and once by hand `ZORVO_RENDER_TEST=1 cargo test --test canvas_render` with a new case that draws a visual to a PNG and checks its width is `2 * width`. Expected: PASS.
- [ ] **Step 7:** Commit `feat: copy and download an inline visual`.

### Task 11: Sweep after a rewind

**Files:**
- Create: `src/hooks/useVisualSweep.ts`
- Modify: `src/App.tsx` (mount it, main window only)
- Test: `src/test/use-visual-sweep.test.tsx`

**Interfaces:**
- Consumes: `visual_sweep`, `visualIdsOf`
- Produces: `useVisualSweep(sessionId: string | null, messages: readonly ChatMessage[] | null)`: when the loaded transcript of the session on screen names fewer visual ids than it did, call `visual_sweep(sessionId, keep)` once with the ids it names now.

- [ ] **Step 1: Write the failing tests:** nothing is called on first load, on a switch of session, or when ids are added; removing a message with a visual calls `visual_sweep` with the remaining ids; `messages === null` (not loaded) never calls it; a failed call is silent.
- [ ] **Step 2:** Run `pnpm vitest run src/test/use-visual-sweep.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run it and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: remove a visual when its message is rewound`.

### Task 12: Records

**Files:**
- Modify: `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1:** In `CLAUDE.md`, add an **Inline visuals** paragraph after **Artifacts** (the tool, the store, the wrapper, the sandbox value and why, export, what is not built) and change "ten tools" and "The ten tools" to eleven.
- [ ] **Step 2:** Add under `Unreleased` in `CHANGELOG.md`: "An agent can show a diagram or a mockup inside its reply, and you can copy it or save it as SVG, HTML or PNG."
- [ ] **Step 3:** Run `pnpm vitest run src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit `docs: inline visuals`.

### Before the pull request

- [ ] From `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`.
- [ ] `pnpm lint`.
- [ ] In a release build, with the fake agent or Qwen Code: ask for a diagram and a mockup in one answer. Check, and write down what happened for each: both show in order between the text; the theme switch recolours them; an `<a>` in one is plain text and a right-click in the frame offers nothing that navigates; Tab reaches Expand, the fold and the menu with a visible focus ring; each export action; fold; Expand and Escape; a rewind removes the visual and its file after a minute.
- [ ] Review the diff (`/code-review --fix`), then push with SSH keepalive.
