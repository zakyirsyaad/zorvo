# Redesign phase 5: Files tab git markers and the read-only file viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Files tab marks changed files and the folders holding them, and a click on a file opens it read-only inside the tab. The viewer shows line numbers, changed-line bars and monochrome syntax, and can add a line range to the prompt.

**Architecture:**
- One new async Tauri command, `read_workspace_file(root, relative)` in `files.rs`. It takes a known workspace plus a relative path, never an absolute path from the UI, and returns text, "binary" or "too large".
- The frontend parts are each a pure helper in `src/lib/` with one component on top:
  - markers from the HEAD diff stats the inspector already reads;
  - changed lines from `session_file_diff`;
  - a tiny dependency-free tokenizer;
  - the line-range quote.
- Which file is open lives in `useInspector`, beside the tab, so the inspector can widen to 560px while it shows, exactly like the Terminal tab.

**Tech Stack:** Rust (Tauri 2 command, `#[cfg(test)]` unit tests), React 19, Tailwind 4 tokens, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, read with three sections:
- "Inspector", for **Files** and **File viewer (new)**;
- "Layout", for the Terminal tab and the file viewer widening the inspector to at least 560px;
- "Code impact", for the new Tauri command with Rust tests for the workspace check, size cap and binary detection.

## Global Constraints

- **The backend command.**
  - It is `#[tauri::command(async)]` (CLAUDE.md "Threading rule").
  - It calls `files::ensure_known_workspace` first ("Path checks"), then `resolve_inside_root`, so `..` and symlinks cannot leave the workspace.
  - The UI sends only `root` and `relative`.
- **Never block on a special file.** A path that is not a regular file (folder, named pipe, socket, device) is refused from its metadata, before anything opens it. Opening a pipe with no writer blocks, as `diff_stats.rs`'s `keeps_a_named_pipe_uncounted_without_opening_it` shows.
- **Size cap:** `MAX_VIEW_BYTES = 1_048_576` (1 MiB). A larger file is refused from its metadata, before it is read.
- **Binary:**
  - A NUL byte within the first 8 KiB (`BINARY_SNIFF_BYTES`, the value `diff_stats.rs` uses) means binary.
  - So does text that is not valid UTF-8. No lossy decoding: a replacement character in the viewer would be a lie about the file.
- **Tokens and primitives.**
  - Tokens only: `text-ui` and `text-ui-sm` for rows, `text-caption` for hints, mono for paths and code.
  - No raw colors (`design-tokens.test.ts`).
  - `IconButton` / `Button`, and `focus-ring` on every control.
- **Markers.**
  - "M" for modified or renamed, in `text-status-attention`.
  - "A" for added or untracked, in `text-status-running`.
  - A dot on folders that contain changes, deletions included.
  - Every marker has words for a screen reader (Global "every status is a word"): "Modified", "Added", "Contains changes".
- **Copy:** the spec's own strings:
  - "← Files", "Add to prompt", "Open in editor", "Copy path";
  - "Read only", "Mark changed lines";
  - "Add lines A–B to prompt" (an en dash; one line reads "Add line A to prompt").
- **Rust checks:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` run, because `src-tauri/**` changes. `pnpm build` must have produced `dist/` first.
- **Light checks:** targeted test files while working, and the full `pnpm test` once at the end.

## Decisions taken here (the spec leaves them open)

- **"Open in editor" is `open_path`.** That is the existing command that opens a workspace file with its default app. No editor setting is added.
- **The tree's click changes.** A click on a file now opens the viewer, where it used to call `open_path`; "Open in editor" in the viewer does that. Add to prompt stays on the row.
- **"Mark changed lines"** shows only for a file with a marker, is on by default, and is not remembered.
- **The tokenizer.**
  - Hand-written in `lib/code-tokens.ts`, with no new dependency.
  - It knows keywords for TypeScript/JavaScript, Rust, Python, Go, Swift, shell, CSS, JSON and Markdown, and also strings, numbers, and line and block comments.
  - Anything unknown is plain text.
  - "Monochrome" per the spec: keywords `text-fg`, plain text `text-fg-secondary`, strings `text-fg-muted`, comments `text-fg-subtle italic`.
- **The quote.** "Add lines A–B to prompt" inserts `` `<path>` lines A–B: `` followed by a fenced block whose fence is longer than any backtick run inside it. The language tag comes from the file's extension. The text is cut at `MAX_QUOTE_CHARS` (from `lib/reply-quote.ts`) with "…" when longer.
- **Re-reading.**
  - The viewer reads the file again when `changes.version` moves (a turn ended, Refresh), so an agent's edit shows.
  - A file that is gone reads "This file is no longer here." with "← Files" still there.

## Review Focus

1. **A named pipe, socket or folder** given as `relative` returns an error at once and never blocks the command's thread (Task 1).
2. **A symlink inside the workspace pointing outside it** is refused, like `..` (Task 1).
3. **Switching folder or session while a file is open** closes the viewer. The new folder's tree shows, not a path from the old one (Task 3).
4. **Line counting.** CRLF and a missing or trailing newline do not add a phantom last line, and the numbers match the editor. The changed-line bars and "Add lines A–B" use the same numbering (Tasks 4 and 5).
5. **A file in a subfolder workspace.** When the Files tab's folder is below the repository root, markers and changed lines still match: stats paths are repository-relative, so strip `DiffTargets.prefix` (Tasks 2 and 5).

---

### Task 1: The `read_workspace_file` command

**Files:**
- Modify: `src-tauri/src/files.rs`, `src-tauri/src/lib.rs` (register it in `generate_handler!` next to `files::open_path`)
- Test: `src-tauri/src/files.rs` `#[cfg(test)] mod tests` (reuse `TempWorkspace`)

**Interfaces:**
- Produces:
  - `pub const MAX_VIEW_BYTES: u64 = 1_048_576;`
  - `#[derive(Serialize)] #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")] pub enum FileContent { Text { text: String, size: u64 }, Binary { size: u64 }, TooLarge { size: u64, limit: u64 } }`
  - `pub fn read_view_file(root: &str, relative: &str) -> Result<FileContent, String>`
  - `#[tauri::command(async)] pub fn read_workspace_file(store: State<'_, AppStore>, root: String, relative: String) -> Result<FileContent, String>`
  - The JSON the frontend sees: `{kind: "text", text, size}`, `{kind: "binary", size}`, `{kind: "tooLarge", size, limit}`.

- [ ] **Step 1: Write the failing tests** in `files.rs`'s test module:
  - `reads_a_text_file_with_its_size`: `"a\r\nb\n"` gives `Text { text: "a\r\nb\n", size: 5 }`.
  - `calls_a_file_with_a_nul_binary`: `b"PNG\0data"` gives `Binary { size: 8 }`.
  - `calls_invalid_utf8_binary`: `[0xff, 0xfe, 0x41]` gives `Binary`.
  - `refuses_a_file_over_the_cap_without_reading_it`: `set_len(MAX_VIEW_BYTES + 1)` on a sparse file gives `TooLarge { size: MAX_VIEW_BYTES + 1, limit: MAX_VIEW_BYTES }`.
  - `refuses_a_folder`: `Err` containing "is not a file".
  - `refuses_a_named_pipe_without_opening_it`: `mkfifo` as in `diff_stats.rs` gives `Err` containing "is not a file". Returning at all proves it was not opened.
  - `refuses_a_path_outside_the_workspace`: both `"../x"` and a symlink inside the root that points at a file outside give `Err` containing "outside the workspace".
- [ ] **Step 2:** Run `cd src-tauri && cargo test --lib files::tests`. Expected: FAIL (does not compile: `read_view_file` not found).
- [ ] **Step 3: Implement.**
  - `read_view_file` calls `resolve_inside_root`, then `std::fs::metadata(&target)`.
  - It rejects with `"{relative:?} is not a file"` unless `metadata.is_file()`.
  - It returns `TooLarge` when `len > MAX_VIEW_BYTES`.
  - Otherwise it calls `std::fs::read`, sniffs the first `BINARY_SNIFF_BYTES` for `0`, then calls `String::from_utf8`; an `Err` means `Binary`.
  - The command calls `ensure_known_workspace(&root, |r| store.is_known_workspace(r))?` first. Move `BINARY_SNIFF_BYTES` to `files.rs` as `pub const`, and import it in `diff_stats.rs`.
- [ ] **Step 4:** Run `cd src-tauri && cargo test --lib files::tests && cargo clippy --all-targets -- -D warnings && cargo fmt --check`. Expected: PASS, no warnings.
- [ ] **Step 5:** Commit `feat: a command that reads a workspace file for the viewer`.

### Task 2: Git markers in the tree

**Files:**
- Create: `src/lib/file-markers.ts`
- Modify:
  - `src/components/FilesPanel.tsx`
  - `src/hooks/useInspector.ts` (expose `filesPrefix`)
  - `src/App.tsx` (passes `markers`)
- Test: `src/test/file-markers.test.ts` (new), `src/test/files-panel.test.tsx` (existing file; create it if absent)

**Interfaces:**
- Produces:
  - `export type FileMarker = "modified" | "added";`
  - `export interface FileMarkers { files: ReadonlyMap<string, FileMarker>; folders: ReadonlySet<string> }`
  - `export function markersOf(stats: readonly FileStat[] | null, prefix: string): FileMarkers`. Paths come out relative to the Files tab's folder. Stats outside `prefix` are dropped. Every ancestor folder of a changed or deleted path is in `folders`.
  - `export const MARKER_LETTER: Record<FileMarker, "M" | "A">` and `MARKER_WORD: Record<FileMarker, "Modified" | "Added">`.
  - `FilesPanelProps.markers?: FileMarkers`.
  - `InspectorState.filesPrefix: string`: `useDiffTargets(folderPath, isRepository, changes.version, onError).targets.prefix`, `""` until it loads.

- [ ] **Step 1: Write the failing tests.**
  - `markersOf([{path:"app/src/a.ts",kind:"modified"},{path:"app/src/new.ts",kind:"untracked"},{path:"app/old.ts",kind:"deleted"},{path:"other/x.ts",kind:"added"}], "app/")`:
    - `files` = `{"src/a.ts" → modified, "src/new.ts" → added}`;
    - `folders` = `{"src"}`.
    - `old.ts` sits at the folder's root, so it adds no folder. Only folders strictly above a path count.
  - A renamed file is `modified`.
  - `markersOf(null, "")` is empty.
  - In `files-panel.test.tsx`:
    - the row for `src/a.ts` shows "M" with `text-status-attention`, and the sr-only word "Modified" inside the treeitem's name;
    - the `src` folder row has an element named "Contains changes";
    - an unchanged file has no marker.
- [ ] **Step 2:** Run `pnpm vitest run src/test/file-markers.test.ts src/test/files-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `FileRow` puts `<span className="ml-auto mr-1 font-mono text-caption {color}" aria-hidden>M</span><span className="sr-only">Modified</span>` before the Add button.
  - `FolderRow` puts a `size-1.5 rounded-full bg-status-attention` dot with `role="img" aria-label="Contains changes"`.
  - `App` passes `markers={markersOf(inspector.headStats, inspector.filesPrefix)}`, memoized on both.
  - While touching `FilesPanel`, move its `text-[11px]` and `text-xs` to `text-caption` and `text-ui-sm`.
  - Set the tree's names in `font-mono`, since the spec says "the tree in mono". Add a test assertion that a file row's name span has `font-mono`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the Files tab marks changed files and the folders holding them`.

### Task 3: The open file and the wide inspector

**Files:**
- Modify: `src/lib/inspector.ts`, `src/hooks/useInspector.ts`, `src/components/inspector/Inspector.tsx`, `src/App.tsx`
- Test: `src/test/inspector.test.ts` (the `lib/inspector` tests; find the file with `grep -l shownInspectorWidth src/test`), `src/test/inspector-app.test.tsx`

**Interfaces:**
- Produces:
  - `shownInspectorWidth(tab: InspectorTab | null, width: number, isViewingFile = false): number` and `minInspectorWidth(tab: InspectorTab, isViewingFile = false): number`. The Files tab with a file open counts as wide, like Terminal.
  - `InspectorState.viewedFile: string | null` (relative to the Files tab's folder), `viewFile(relative: string): void` and `closeFile(): void`.
  - `InspectorProps.isViewingFile?: boolean`.
  - `viewFile` runs the same crowding check as a tab switch (`onCrowded` when the wider inspector would crowd the sidebar).

- [ ] **Step 1: Write the failing tests.**
  - `shownInspectorWidth("files", 380, true)` is 560; `shownInspectorWidth("files", 380)` is 380; `minInspectorWidth("files", true)` is 560.
  - In `inspector-app.test.tsx`:
    - with the Files tab open, `viewFile("src/a.ts")` makes the inspector `style.width` 560px;
    - `closeFile()` brings it back to 380px.
    - **Review Focus 3:** with a file open, switching to another session in another folder leaves `viewedFile` null and shows that folder's tree.
- [ ] **Step 2:** Run `pnpm vitest run <the lib inspector test> src/test/inspector-app.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Keep `viewedFile` as `{ folder, path } | null` in state. It reads as null when `folder !== folderPath`, the same derive-not-effect trick `expandedView` uses.
  - `Inspector` passes `isViewingFile` into both width functions.
  - `App` passes `isViewingFile={inspectorTab === "files" && inspector.viewedFile !== null}`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the inspector remembers the open file and widens for it`.

### Task 4: The viewer: reading, header, info line, numbered lines

**Files:**
- Create:
  - `src/lib/file-content.ts`
  - `src/hooks/useFileContent.ts`
  - `src/components/files/FileViewer.tsx`
- Modify:
  - `src/lib/files.ts` (`readWorkspaceFile`)
  - `src/components/FilesPanel.tsx` (a click opens the viewer; the viewer takes the header's and tree's place)
  - `src/App.tsx`
  - `src/test/setup.ts` (a fake `read_workspace_file` returning `{kind:"text", text:"", size:0}` unless a test spies)
- Test: `src/test/file-content.test.ts` (new), `src/test/file-viewer.test.tsx` (new)

**Interfaces:**
- Consumes: `viewedFile`, `viewFile`, `closeFile` (Task 3), `markers` (Task 2).
- Produces:
  - In `lib/file-content.ts`:
    - `export type FileContent = { kind: "text"; text: string; size: number } | { kind: "binary"; size: number } | { kind: "tooLarge"; size: number; limit: number };`
    - `export function parseFileContent(value: unknown): FileContent`, which throws on any other shape;
    - `export function splitLines(text: string): string[]`, which splits on `\r?\n` and drops one trailing empty element (`""` gives `[]`);
    - `export function languageOf(path: string): { name: string; fence: string }`, e.g. `.ts` gives `{name:"TypeScript", fence:"ts"}`, and an unknown extension gives `{name:"Plain text", fence:""}`.
  - `readWorkspaceFile(root: string, relative: string): Promise<FileContent>` in `lib/files.ts`.
  - `useFileContent(root: string, relative: string, version: number)` returns `{ status: "loading" } | { status: "ready"; content: FileContent } | { status: "failed"; message: string }`. A stale answer for an earlier path is ignored.
  - `FileViewerProps { rootPath; relativePath; marker?: FileMarker; version: number; onBack(): void; onInsertPath(absolute: string): void; onInsertText?(text: string): void }`.
  - `FilesPanelProps` gains:
    - `viewedFile?: string | null`;
    - `onViewFile?(relative: string): void`;
    - `onCloseFile?(): void`;
    - `version?: number`;
    - `onInsertText?(text: string): void`.

- [ ] **Step 1: Write the failing tests.**
  - `file-content.test.ts`:
    - `splitLines("a\r\nb\n")` is `["a","b"]`, `splitLines("a\nb")` is `["a","b"]`, `splitLines("")` is `[]`, and `splitLines("\n")` is `[""]`;
    - `parseFileContent({kind:"text"})` throws;
    - `languageOf("src/App.tsx").name` is `"TypeScript"`, and `languageOf("Makefile").name` is `"Plain text"`.
  - `file-viewer.test.tsx`, with `read_workspace_file` stubbed to `"const a = 1;\nlet b;\n"`:
    - A button "Files" goes back.
    - The path shows as a mono breadcrumb `src` / `a.ts` with the sr word "Modified" when `marker="modified"`.
    - Buttons "Add to prompt", "Open in editor" (calls `open_path` with `{root, relative}`) and "Copy path" exist. Copy path writes the absolute path via `navigator.clipboard.writeText`, and its label reads "Path copied" until 2 s pass.
    - The info line reads "TypeScript · 2 lines · Read only".
    - Two rows with line numbers 1 and 2. Each row carries `data-line`.
    - `{kind:"binary", size:2048}` shows "This file is binary (2 KB), so it is not shown." with "Open in editor".
    - `{kind:"tooLarge", size, limit}` shows "This file is too large to show (1.5 MB; the limit is 1 MB)."
    - A rejected read shows "This file is no longer here." when the error says "not accessible", else the error through `errorMessage`.
    - Bumping `version` reads again.
  - `files-panel.test.tsx`: clicking a file row calls `onViewFile("src/a.ts")` and no longer calls `open_path`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/file-content.test.ts src/test/file-viewer.test.tsx src/test/files-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The body is a `role="region" aria-label="Contents of <name>"` element with `overflow-auto font-mono text-ui-sm`.
  - One `<div data-line={n}>` per line holds a `select-none` number column (`text-fg-subtle`, right-aligned, `tabular-nums`) and `whitespace-pre` code in `text-fg-secondary`. Tokens come in Task 6.
  - Sizes format with the existing `formatBytes` if `src/lib` has one (`grep -rn "function format.*Bytes" src/lib`), else a local `kb/mb` helper.
  - `FilesPanel` renders `FileViewer` in place of `PanelHeader` and the tree while `viewedFile` is set, so the tree's state (expanded folders, filter) survives "← Files".
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: a read-only file viewer in the Files tab`.

### Task 5: Changed lines

**Files:**
- Create: `src/lib/changed-lines.ts`, `src/hooks/useChangedLines.ts`
- Modify: `src/components/files/FileViewer.tsx`
- Test: `src/test/changed-lines.test.ts` (new), `src/test/file-viewer.test.tsx`

**Interfaces:**
- Consumes:
  - `unifiedDiffRows(diff)` from `lib/git-changes.ts`;
  - `readFileDiff(rootPath, file, "head", undefined, signal)` from `lib/diff-read.ts`. `file` is repository-relative: `filesPrefix + relativePath`.
- Produces:
  - `export type LineChange = "added" | "modified";`
  - `export function changedLines(rows: readonly UnifiedRow[]): ReadonlyMap<number, LineChange>`, keyed by `newLine`. Within one run of consecutive non-context rows, the added lines are `modified` when the run holds a removed row, else `added`.
  - `useChangedLines(rootPath, repoPath, isEnabled, version): ReadonlyMap<number, LineChange>`. It returns an empty map while loading, on failure, or when disabled.
  - `FileViewerProps` gains `filesPrefix: string`.

- [ ] **Step 1: Write the failing tests.**
  - `changedLines(unifiedDiffRows("@@ -1,3 +1,4 @@\n a\n-b\n+B\n+C\n d\n+e\n"))` gives `{2 → modified, 3 → modified, 5 → added}`.
  - A pure-deletion hunk marks nothing.
  - In `file-viewer.test.tsx`, with `session_file_diff` stubbed for `marker="modified"`:
    - line 2's row has a gutter element with `bg-status-attention`;
    - an added line's gutter has `bg-status-running`;
    - unticking the checkbox "Mark changed lines" removes the gutter bars;
    - a file without a marker shows no checkbox and calls no `session_file_diff`.
  - **Review Focus 5:** with `filesPrefix = "app/"`, the diff is read for `app/src/a.ts`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/changed-lines.test.ts src/test/file-viewer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The gutter is a 2px `w-0.5` bar between the number and the code, `aria-hidden`. The info line's checkbox is a real `<input type="checkbox">` with a `<label>`, checked by default.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the file viewer marks the lines that changed`.

### Task 6: Monochrome syntax

**Files:**
- Create: `src/lib/code-tokens.ts`
- Modify: `src/components/files/FileViewer.tsx`
- Test: `src/test/code-tokens.test.ts` (new), `src/test/file-viewer.test.tsx`

**Interfaces:**
- Produces:
  - `export type TokenKind = "keyword" | "string" | "comment" | "number" | "plain";`
  - `export interface Token { kind: TokenKind; text: string }`
  - `export function tokenizeLines(lines: readonly string[], fence: string): Token[][]`. One token list per line, whose texts join back to the line exactly. It carries `/* … */` (and Python `"""` strings) across lines.
  - `export const TOKEN_STYLE: Record<TokenKind, string>`: keyword `text-fg`, string `text-fg-muted`, comment `text-fg-subtle italic`, number `text-fg`, plain `""` (the row's `text-fg-secondary`).

- [ ] **Step 1: Write the failing tests.**
  - For `"ts"`, `tokenizeLines(['const a = "x"; // note'], "ts")[0]` gives `[keyword "const", plain " a = ", string "\"x\"", plain "; ", comment "// note"]`.
  - `["/* a", "b */ let c"]` gives the comment over line 1 and `"b */"` on line 2, then `let` as a keyword.
  - An escaped quote `"a\"b"` stays one string.
  - `"#"` starts a comment for `"py"` and `"sh"`, not for `"ts"`.
  - For an unknown fence `""`, every line is one plain token.
  - **Property:** for 50 lines of this repository's own `src/lib/diff-stats.ts`, `tokens.map(t => t.text).join("") === line` on every line.
  - In `file-viewer.test.tsx`, the keyword `const` is in a span with `text-fg`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/code-tokens.test.ts src/test/file-viewer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - A per-language table: keywords set, line comment markers, block comment pair, string quotes.
  - Scan each line left to right with `indexOf` and character checks, never a regex built from input.
  - `FileViewer` memoizes `tokenizeLines(splitLines(text), fence)` on the text.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: monochrome syntax in the file viewer`.

### Task 7: Add a line range to the prompt

**Files:**
- Create: `src/lib/line-quote.ts`, `src/hooks/useLineSelection.ts`
- Modify: `src/components/files/FileViewer.tsx`, `src/App.tsx` (`onInsertText` is `composerRef.current?.insertText`, only in the main window, like Reply)
- Test: `src/test/line-quote.test.ts` (new), `src/test/file-viewer.test.tsx`

**Interfaces:**
- Consumes: `MAX_QUOTE_CHARS` from `lib/reply-quote.ts`, `languageOf` (Task 4).
- Produces:
  - `export function lineQuote(path: string, first: number, last: number, lines: readonly string[], fence: string): string`. `path` is relative to the Files tab's folder, `lines` are the selected lines' text, and `first`/`last` are 1-based.
  - `export function lineRangeLabel(first: number, last: number): string`: "Add line 4 to prompt" or "Add lines 4–9 to prompt".
  - `useLineSelection(body: RefObject<HTMLElement>)` returns `{ range: { first: number; last: number } | null; clear(): void }`. It reads the selection on `mouseup` and `keyup` inside `body`, and maps the anchor and focus to their closest `[data-line]`, smaller first. It is null when collapsed or outside `body`.

- [ ] **Step 1: Write the failing tests.**
  - `lineQuote("src/a.ts", 2, 3, ["let b;", "b = 2;"], "ts")` equals `` "`src/a.ts` lines 2–3:\n\n```ts\nlet b;\nb = 2;\n```" ``.
  - When a line holds three backticks, the fence is four.
  - A single line reads `` "`src/a.ts` line 2:" ``.
  - Over `MAX_QUOTE_CHARS` the body is cut and ends in "…".
  - In `file-viewer.test.tsx`:
    - selecting from line 1's code to line 2's code (a DOM `Range` on the `[data-line]` children, then `mouseUp` on the body) shows a button "Add lines 1–2 to prompt";
    - clicking it calls `onInsertText` with `lineQuote(...)` and hides the button;
    - without `onInsertText` no button shows.
  - **Review Focus 4:** with a CRLF file, the quoted text has no `\r`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/line-quote.test.ts src/test/file-viewer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The button floats at the body's top right (`absolute right-2 top-2`, `Button variant="outline"`). It uses `onMouseDown={e => e.preventDefault()}` so the click still sees the selection (the `SelectionToolbar` trick). Clearing it on Escape follows the same pattern.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add a file's lines to the prompt from the viewer`.

### Task 8: Docs, changelog and the full run

**Files:**
- Modify:
  - `docs/design-system/components/Inspector/README.md` (the Files section: markers and the viewer) and its `preview.html` (a Files tab with a marker and a viewer header)
  - `CLAUDE.md` (one sentence under "Workspace terminal"'s sibling area, or a new short "**File viewer.**" paragraph): `read_workspace_file` (`files.rs`), known workspace plus relative path, regular files only, 1 MiB cap, NUL or invalid UTF-8 means binary, never an absolute path from the UI
  - `CHANGELOG.md`
- Test: the full suite and the Rust checks

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**Read a file without leaving Zorvo.** The Files tab marks changed files (M, A) and the folders that hold them. Click a file to read it in the inspector, with its changed lines marked; select lines to add them to your message."
- [ ] **Step 3:** Run `pnpm lint`. Expected: clean.
- [ ] **Step 4:** Run `pnpm build` and `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`. Expected: all pass.
- [ ] **Step 5:** Run `pnpm test > <workspace>/full.log 2>&1`, then read its last 20 lines. Expected: every file passes. Migrate tests that pinned the tree's old click (`open_path` on a file row) and record a ruling for each.
- [ ] **Step 6:** Commit `docs: the file viewer in the design system and CLAUDE.md`.
