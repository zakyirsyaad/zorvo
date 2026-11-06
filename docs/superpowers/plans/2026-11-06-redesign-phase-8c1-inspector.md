# Redesign phase 8c1: the inspector's frame, Activity, Files, file view and Terminal as drawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inspector's frame and its Activity, Files, file view and Terminal tabs match the design canvas. Also close the three review notes left over from PR #149.

**Architecture:** This is mostly a restyle, as in 8a and 8b. Behavior changes only where an artboard draws something the code has no data for:
- Activity entries grouped by turn, derived from the transcript's user messages, with no new state;
- **Show in Changes**;
- the selected-line tint;
- the terminal's shell name and its cols × rows readout.

Each task pins the artboard's values with Testing Library class and text assertions in a new test file, and migrates the old assertions it breaks. The Changes tab and the full diff review are **8c2**, a separate plan, because both are built on `FileDiff`/`DiffView` and the review comments.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react; Rust (one field on `OpenedTerminal`).

**Spec:**
- **Audit:** `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, section "8c", the bullets **Frame**, **Activity**, **Files**, **File view** and **Terminal**.
- **Artboards:** `InspectorActivity.dc.html`, `InspectorFiles.dc.html`, `InspectorFileView.dc.html` and `InspectorTerminal.dc.html`; the frame comes from the tab strip that all of them share. They are in the "Zorvo redesign layouts" Design artifact (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz, `project/`).
- **Behavior:** CLAUDE.md "Activity log" and "Workspace terminal", and `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md` ("Inspector").
- **Leftovers:** V14, L8 and the window height, from the reviews of PR #147 and #149 (`.claude/reviews/pr-147-review.md`).

## Global Constraints

- **Authority.** The artboard decides the look; the spec and CLAUDE.md decide behavior. The user's earlier choices stand: the terminal stays an inspector tab that widens to 560px, and chips use radius 6.
- **Canvas variable → token.**
  - Surfaces and lines: `--bg` `bg`, `--s1` `surface-1`, `--s2` `surface-2`, `--s3` `surface-3`, `--hover` `surface-hover`, `--line` `border`, `--strong` `border-strong`.
  - Text: `--fg` `fg`, `--fg2` `fg-secondary`, `--muted` `fg-muted`, `--subtle` `fg-subtle`.
  - Status: `--run` `status-running`, `--att` `status-attention`, `--danger` `danger`, `--atts` `attention-surface`, `--attb` `attention-border`.
  - Type: 13/18 `text-ui`, 12/16 `text-ui-sm`, 11/16 `text-caption`, 10/14 `text-micro`.
- **No raw colours in components** (`design-tokens.test.ts`). The four new colour tokens (Tasks 6 and 7) go into `globals.css` and `docs/design-system/tokens.json` together (`design-system-docs.test.ts`), with light values where the canvas gives them.
- **Focus.** Every focusable control keeps `focus-ring`.
- **Primitives first.** Use `ui/Button`, `ui/IconButton` (sizes `xs` 22, `sm` 24, `md` 28; tones `muted`, `secondary`) and `ui/Tabs` before hand-styling. In Tailwind 4, two utilities for one property on one element have no reliable winner, so add an option instead of overriding a primitive's class.
- **The Activity rule (CLAUDE.md).** A row claims an action only when its tool completed: a kept `running` tool reads "Did not finish" once the session is idle. Past-tense verbs appear only at `completed`.
- **Copy.** Sentence case, "you", name the agents. There are no keyboard shortcuts and no voice input.
- **Checks.** Run the targeted test files while working, and the full suite once, at the end. Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` for Task 7 (`src-tauri/**` changes).

## Review Focus

1. **A turn from before the first prompt.** An imported or `historyElsewhere` session can hold tool calls before any user message. Those entries must still show, under a heading "Earlier", never dropped or put into Turn 1. Task 3, test "entries before the first prompt go under Earlier".
2. **The 500-row cap with turns.** The cap keeps the newest 500 entries before grouping, so a long session never renders a turn cut in the middle without saying so. The "N older entries are not shown." line stays, under the last group. Task 4, test "the cap keeps the newest entries and says how many are hidden".
3. **A selection in the file view that scrolls.** The **Add lines A–B to prompt** popover sits under the selection's last line and scrolls with the code. It is not fixed to the viewport. Task 6, test "the add-lines popover sits under the last selected line".
4. **The terminal readout before the first fit.** Until xterm has reported a size, the readout shows nothing. It never shows "0 × 0" or a stale size from another tab. Task 7, test "the size readout follows the selected tab and is empty before a fit".
5. **Sign-in and install panels at once.** In the draft's slot the install panel always sits above the sign-in panel, whichever mounted first. Task 1, test "install sits above sign-in in either mount order".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/components/ui/Highlighted.tsx`, `src/components/composer/OptionDropdown.tsx`, `src/lib/match-segments.ts` | V14: a highlight that crosses the tag, and highlighted descriptions | 1 |
| `src/components/ComposerDock.tsx`, `src/App.tsx`, `src/components/SignInLayer.tsx` | L8: two fixed sub-slots above the draft's card | 1 |
| `src-tauri/tauri.conf.json`, `src-tauri/src/windows.rs` | Minimum window sizes | 1 |
| `src/components/inspector/Inspector.tsx` | 48px strip, close X, resize line and grip | 2 |
| `src/lib/activity-turns.ts` (new) | Turns, verbs, results, dot tones | 3 |
| `src/components/activity/ActivityPanel.tsx`, `ActivityEntryRow.tsx` | The tab as drawn | 4 |
| `src/components/FilesPanel.tsx`, `src/components/ui/IconButton.tsx` | Header, filter, tree rows, markers, Add to prompt pill; a 26px size | 5 |
| `src/components/files/FileViewer.tsx`, `src/lib/code-tokens.ts`, `src/styles/globals.css` | Path bar, meta bar, body, selected lines, floating add-lines | 6 |
| `src/components/terminal/TerminalDrawer.tsx`, `src/lib/terminal-labels.ts`, `src/lib/xterm-options.ts`, `src/components/TerminalView.tsx`, `src/hooks/useWorkspaceTerminals.ts`, `src-tauri/src/workspace_terminal.rs` | Terminal strip, labels, readout, xterm look | 7 |
| `docs/design-system/components/{Inspector,Composer,Popover}/README.md`, `docs/design-system/tokens.json`, `CHANGELOG.md` | Docs | 8 |

---

### Task 1: Leftovers from PR #149's review

**Files:**
- Modify: `src/components/ui/Highlighted.tsx`, `src/lib/match-segments.ts`, `src/components/composer/OptionDropdown.tsx`
- Modify: `src/components/ComposerDock.tsx:462`, `src/App.tsx` (around 209, 224, 1157–1168, 1233), `src/components/SignInLayer.tsx:61`
- Modify: `src-tauri/tauri.conf.json:13-24`, `src-tauri/src/windows.rs:21-22,86-88`
- Test: `src/test/review-leftovers.test.tsx` and `src/test/window-config.test.ts` (new)

**Interfaces:**
- Produces:
  - `Highlighted({ text, query, ranges }: { text: string; query?: string; ranges?: ReadonlyArray<readonly [number, number]> })`. `ranges`, as [start, end) offsets into `text`, wins over `query`.
  - `matchRanges(text: string, query: string): Array<[number, number]>` in `lib/match-segments.ts`: every case-insensitive occurrence of the trimmed query, with no overlaps.
  - `ComposerDock`'s `aboveCardSlots?: { install: (el: HTMLDivElement | null) => void; signIn: (el: HTMLDivElement | null) => void }` replaces `aboveCardRef`.

**V14.**
- **Projection.** For a model option the search matches the full label ("[OpenRouter] kimi-k2") or the description. Project `matchRanges(option.label, query)` onto the parts shown:
  - the heading shows the tag, which starts at offset 1;
  - the row shows the name, which starts after `] ` (from `splitTag`).
  - A range that crosses `]` highlights the end of the tag and the start of the name.
  - The heading takes its ranges from the first option in its group whose label matches.
- **Descriptions.** The row's description is `<Highlighted text={detailOf(option)} query={query} />` whenever a query is typed (`PopoverOption.description` already takes a `ReactNode`). The `isWide` check stays on `detailOf(option) !== undefined`.

**L8.** The slot `div` at `ComposerDock.tsx:462` holds two fixed children, `<div ref={aboveCardSlots.install} data-slot="install" />` and then `<div ref={aboveCardSlots.signIn} data-slot="sign-in" />`.
- The parent keeps `mb-3 w-full`, with `flex flex-col gap-3`. It hides while both children are empty through `[&:not(:has(>:not(:empty)))]:hidden`. Check that this class exists in the built CSS (`pnpm build`, then grep `dist/assets/*.css`).
- `App` keeps two `useState` elements: the install portal goes into the first, and `SignInLayer`'s `panelTarget` into the second.

**Window.**
- **Main window.** `"minHeight": 560` and `"minWidth": 640` on the `main` window in `tauri.conf.json`.
- **Popouts.** `const SESSION_WINDOW_MIN_WIDTH: f64 = 480.0; const SESSION_WINDOW_MIN_HEIGHT: f64 = 560.0;`, applied with `.min_inner_size(...)` in `windows.rs`.

- [ ] **Step 1: Write the failing tests** in `src/test/review-leftovers.test.tsx`:
  - `"highlights a query that crosses the provider tag"`. Open the model menu with options `[OpenRouter] kimi-k2` and `[OpenRouter] glm-4`, and type `router] ki`.
    - The heading holds `mark` "Router".
    - The `kimi-k2` row holds `mark` "ki".
    - The `glm-4` row is filtered out.
  - `"highlights a match found only in the description"`. An option `{ label: "Fast", description: "Uses the small model" }`, typed `small`: the option's description holds `mark` "small".
  - `"install sits above sign-in in either mount order"`. Render `ComposerDock` with `aboveCardSlots`, portal a `<p>sign</p>` into `signIn` first and a `<p>inst</p>` into `install` second. `[data-above-card]`'s text order is `inst` then `sign`. Repeat with the mounts the other way round.
  - In `src/test/window-config.test.ts`: `"the main window cannot shrink below 640 × 560"`. Read `src-tauri/tauri.conf.json` with `fs`, and expect `app.windows[0]` to have `minWidth: 640` and `minHeight: 560`.
- [ ] **Step 2: Run them.** Run `pnpm vitest run src/test/review-leftovers.test.tsx src/test/window-config.test.ts`. Expected: 4 FAIL (no mark, no `aboveCardSlots`, no `minHeight`).
- [ ] **Step 3: Implement** `matchRanges`, `Highlighted`'s `ranges`, the projection in `OptionDropdown`, the two sub-slots, and the window sizes.
- [ ] **Step 4: Run** the two files, then `src/test/option-dropdown.test.tsx`, `src/test/composer-menus.test.tsx`, `src/test/draft-layout.test.tsx`, `src/test/new-session.test.tsx` and the sign-in layer tests. Migrate any `data-above-card` assertion that expects the panel as a direct child. Expected: PASS.
- [ ] **Step 5: Run cargo** from `src-tauri/`: `cargo fmt --check && cargo clippy --all-targets -- -D warnings`. Expected: clean.
- [ ] **Step 6: Commit** `fix: highlight cross-tag and description matches, keep install above sign-in, set minimum window sizes`.

### Task 2: The inspector's frame as drawn

**Files:**
- Modify: `src/components/inspector/Inspector.tsx:86-110`
- Test: `src/test/inspector-frame.test.tsx` (new)

The artboard's values (shared tab strip, `InspectorTerminal.dc.html` resize edge):
- **Strip.** `height: 48px`, `padding: 0 8px 0 12px`, `gap: 4px`, `border-bottom: 1px solid var(--line)`. That is `h-12 pl-3 pr-2`, down from `h-10 pl-2 pr-1.5`. The tabs stay `ui/Tabs` (selected `border-fg font-medium text-fg`, count in `text-caption`).
- **Close X.** It is kept but not drawn on the artboard. `IconButton size="sm"` (24px) with `X size={14}`, vertically centred (`self-center`).
- **Section.** It gets `text-ui text-fg`, the 13/18 base that the artboard's `<aside>` sets.
- **Resize edge.** It is shown only while hovered or dragged:
  - a `3px` line in `border-strong` at `left: -2px` over the full height;
  - a `10×36` grip, `radius 5px`, `border-strong`, at `left: -6px`, vertically centred.
  - Both are `aria-hidden` children of the separator. They show through `group-hover:` on the separator, and through a `data-dragging` attribute set while a pointer drag runs.

- [ ] **Step 1: Write failing tests:**
  - `"the tab strip is 48px with the canvas padding"`. The tablist's parent has `h-12`, `pl-3` and `pr-2`.
  - `"close is a 24px icon button"`. The "Close inspector" button has `h-6 w-6`.
  - `"the resize edge shows its line and grip while dragged"`. Fire `pointerDown` on the separator, and expect `data-dragging` on it. Its two `aria-hidden` children have `w-[3px] bg-border-strong` and `h-9 w-2.5 rounded-[5px] bg-border-strong`. After `pointerUp` on `window`, `data-dragging` is gone.
- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector-frame.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with a `useState` boolean `isDragging`, set in the existing pointer handlers.
- [ ] **Step 4: Run** the file, plus `src/test/inspector.test.tsx` and `src/test/inspector-app.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the inspector's tab strip, close button and resize edge as on the canvas`.

### Task 3: Turns, verbs and results for the Activity tab

**Files:**
- Create: `src/lib/activity-turns.ts`
- Test: `src/test/activity-turns.test.ts` (new)

**Interfaces:**
- Consumes: `ActivityEntry` and `statusWord(entry, isBusy)` from `lib/activity.ts`, and `ChatMessage` (`role`, `id`, `timestamp`, `content`).
- Produces:
  ```ts
  export interface ActivityTurn { number: number | null; startedAt: number | null; prompt: string; entries: ActivityEntry[] }
  export function activityTurns(entries: readonly ActivityEntry[], messages: readonly ChatMessage[]): ActivityTurn[];
  export function activityVerb(entry: ActivityEntry): string;
  export function activityResult(entry: ActivityEntry, isBusy: boolean): string;
  export type DotTone = 'done' | 'failed' | 'running' | 'waiting' | 'open';
  export function dotTone(entry: ActivityEntry, isBusy: boolean): DotTone;
  ```

**Rules:**
- **Turns.** A turn is the user message and everything after it, up to the next user message. `number` counts the user messages from 1. Entries whose message comes before the first user message form a turn with `number: null` (heading "Earlier", `prompt: ""`).
- **Order.** Turns are newest first. Entries within a turn are in transcript order, oldest first. The prompt is the user message's text with whitespace collapsed (no cut here; the row truncates it with CSS).
- **Verbs.** They are past tense only at `completed`, to keep the CLAUDE.md rule. Otherwise they say what the tool was for:
  - file `read`: "Read" in both cases;
  - file `changed`: "Edited" / "Edit";
  - file `touched`: "Touched" / "Touch";
  - command: "Ran" / "Run";
  - permission: "Asked".
- **Results.** `statusWord` with these changes:
  - the file action words (Read, Changed, Touched) become "Done";
  - "Rejected" becomes "You denied".
  - Everything else is unchanged: Failed, Running, Did not finish, Waiting for you, Allowed, Not answered, Done.
- **Dot tones.**
  - `done`: completed, or allowed;
  - `failed`: failed, or rejected;
  - `running`: running while busy;
  - `waiting`: waiting for you;
  - `open`: did not finish, or not answered.

- [ ] **Step 1: Write failing tests:**
  - `"groups entries by turn, newest turn first, oldest entry first"`. Use a transcript of user A, assistant (2 tools), user B, assistant (1 tool). Expect the turn numbers `[2, 1]`, turn 2's prompt "B", and turn 1's entries in tool order.
  - `"entries before the first prompt go under Earlier"`. An assistant tool comes before any user message: the last turn has `number: null`.
  - `"a turn's start time is its prompt's timestamp"`.
  - `"verbs are past tense only when the tool completed"`. A changed file reads "Edited" when completed, and "Edit" when failed or running. A command reads "Ran" or "Run".
  - `"results say Done for finished files and You denied for a refusal"`.
  - `"dot tones follow the result"`: one case per tone.
- [ ] **Step 2: Run** `pnpm vitest run src/test/activity-turns.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/activity-turns.ts`. Map each user message's index to its turn number with one pass over `messages`, and place each entry by its `messageId`.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `feat: derive activity turns, verbs and results from the transcript`.

### Task 4: The Activity tab as drawn

**Files:**
- Modify: `src/components/activity/ActivityPanel.tsx`, `src/components/activity/ActivityEntryRow.tsx`, `src/App.tsx:1329-1341`
- Test: `src/test/activity-tab-look.test.tsx` (new); migrate `src/test/activity-panel.test.tsx` and `src/test/activity-wiring.test.tsx`

**Interfaces:**
- Consumes: Task 3's functions.
- Produces:
  - new `ActivityPanel` props `agentName: string` and `onShowChanges: () => void`;
  - `onOpenDiff` is removed;
  - `App` passes `agentNameOf(activeSession.profileId)` (or the existing agent-name lookup there) and `() => inspector.show("changes")`.

The artboard's values (`InspectorActivity.dc.html`):
- **Body.** `padding: 16px`, `gap: 16px`, base 13/18 (`p-4 gap-4 text-ui`). The panel's own "Activity" header goes (README: "Panels: no width, edge or close button of their own").
- **Intro.**
  - Wording: "This is <Agent>'s own report of what it did. Rewinding the chat removes its entries too."
  - Look: `text-caption leading-4 text-fg-subtle`, `gap-2`, an `Info` icon at 12px with `mt-0.5`.
  - It replaces both the old intro and the "Rewinding removes activity from this list." footer.
- **Filters.** They are kept and restyled as one row of 24px ghost chips under the intro: `h-6 rounded-md px-2 text-ui-sm`, pressed `bg-surface-hover text-fg`, else `text-fg-muted`, with the count in `text-fg-subtle`.
- **Unreported card.** It shows only when the check ran and found files; the "Nothing unreported." state goes.
  - Card: `section aria-label="Unreported changes"`, `p-3 gap-2 rounded-lg border border-attention-border bg-attention-surface`.
  - Header: a `TriangleAlert` at 14 in `text-status-attention`, then the title "N files changed that <Agent> didn't report" ("1 file changed…" for one) in `font-semibold text-fg`.
  - Paths: plain mono text, `pl-[22px] text-caption text-fg-secondary font-mono`, `gap-0.5`, still capped at 100 with "N more.".
  - The "Compared …" line stays, as `text-caption text-fg-subtle`.
  - **Show in Changes**: `Button variant="outline" size="sm"`, right-aligned, calls `onShowChanges`.
- **Turn heading.** `flex items-baseline gap-1.5 pb-1.5`, made of:
  - "Turn N" (or "Earlier") in `text-ui-sm font-semibold text-fg`;
  - the relative time in `text-caption text-fg-subtle`, via the existing relative-time helper the sidebar uses;
  - "· <prompt>" in `min-w-0 flex-1 truncate text-caption text-fg-muted`.
  - The heading is an `h3`, and each turn is a `section aria-labelledby` it.
- **Entry row** (`li`). `relative flex items-start gap-2.5 py-[5px] pl-[22px]`:
  - the rail: `before:` a 1px `bg-border` line at `left-1.5`, top to bottom;
  - the dot: a `span aria-hidden` at `absolute left-0.5 top-[9px] size-[9px] rounded-full border-[1.5px]`, by tone:
    - `done`: `border-status-running bg-status-running`;
    - `failed`: `border-danger bg-surface-1`;
    - `running`: `border-status-running bg-surface-1`;
    - `waiting`: `border-status-attention bg-surface-1`;
    - `open`: `border-border-strong bg-surface-1`;
  - the verb: `w-[52px] shrink-0 text-ui-sm text-fg-muted`;
  - the target: `min-w-0 flex-1 truncate text-caption text-fg-secondary`, mono for paths and commands. A permission reads "to run <command>", or its prompt, in sans.
  - The long-text "Show all N lines" toggle and the `<time>` go: the turn heading carries the time.
  - The result: the existing jump button, now `text-caption whitespace-nowrap hover:underline focus-ring`. Colours: `text-danger` for Failed and You denied, `text-status-attention` for Waiting for you and Not answered, `text-status-running` for Running, `text-fg-muted` for Did not finish, else `text-fg-subtle`.

- [ ] **Step 1: Write failing tests** in `activity-tab-look.test.tsx`:
  - `"names the agent in the intro"`: the text "This is Claude Code's own report of what it did. Rewinding the chat removes its entries too.".
  - `"lists unreported files in an attention card with Show in Changes"`. The region "Unreported changes" has `bg-attention-surface`. The title "2 files changed that Claude Code didn't report". Clicking **Show in Changes** calls `onShowChanges`.
  - `"groups rows under turn headings, newest first"`. The `h3`s read "Turn 2", "Turn 1" in that order.
  - `"a row shows verb, target and result"`. A completed edit row reads "Edited", the mono path, and "Done". A rejected permission reads "Asked" and "You denied" with `text-danger`.
  - `"a running tool in an idle session reads Did not finish with an open dot"`.
  - `"the cap keeps the newest entries and says how many are hidden"`. With 502 entries, "2 older entries are not shown." is present, and the oldest two targets are absent.
- [ ] **Step 2: Run** `pnpm vitest run src/test/activity-tab-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the panel and row, and the App wiring.
- [ ] **Step 4: Migrate** `activity-panel.test.tsx` and `activity-wiring.test.tsx`: the old intro and footer strings, "Not reported by the agent", the `<time>` assertions, and `onOpenDiff` become the new texts, `onShowChanges` and the turn heading. Run them, plus `src/test/activity.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the Activity tab as on the canvas, grouped by turn`.

### Task 5: The Files tab as drawn

**Files:**
- Modify: `src/components/FilesPanel.tsx`, `src/components/ui/IconButton.tsx`
- Test: `src/test/files-tab-look.test.tsx` (new); migrate `src/test/files-panel.test.tsx` and `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces: `IconButton` size `"row"` = `h-6.5 w-6.5` (26px), the inspector's header and path-bar buttons. Task 6 uses it.

The artboard's values (`InspectorFiles.dc.html`):
- **Header.** `pt-3 pr-3 pb-2 pl-4 gap-2.5`, no border, no "Files" heading.
  - The folder name in `text-ui font-semibold text-fg`, over its path in `truncate font-mono text-caption text-fg-subtle`, which shows `~` for the home folder (the existing home-shortening helper if one exists, else the full path).
  - **Refresh files** (`RefreshCw`) and **Reveal in Finder** (`ExternalLink`) are `IconButton size="row"` with 14px icons. The old `HEADER_BUTTON` goes.
- **Filter.** `h-[30px] rounded-lg border border-border-strong bg-surface-2 px-2.5 gap-2 focus-ring-within`, a 14px `Search` icon in `text-fg-subtle`, and the input in `text-ui-sm text-fg` with placeholder "Filter files".
- **Tree.** A `ul` with `px-2 pb-3 font-mono`.
- **Rows.** `h-[26px] gap-1.5 pr-1.5 rounded text-ui-sm text-fg-secondary`, hover `bg-surface-hover text-fg`.
  - Indent: folders `4 + 16 × depth` px; files `22 + 16 × depth` px (a folder's 12px chevron plus its 6px gap). So the file icon sits under its folder's icon.
- **Icons.** A 12px chevron in `text-fg-subtle` (`ChevronRight`, `ChevronDown` when open).
  - Folders use a closed `Folder` at 14px in `text-fg-muted`; `FolderOpen` goes.
  - Files use `File` at 14px in `text-fg-subtle`.
- **Markers.** `ml-auto w-3 text-center text-micro font-semibold`: M in `text-status-attention`, A in `text-status-running`.
  - A changed folder shows "•" in the same slot in `text-status-attention`, replacing the 6px dot.
  - The sr-only words stay.
- **Add to prompt.** A pill before the marker, visible on row hover or focus-within: `h-5 gap-1 rounded border border-border-strong px-1.5 font-sans text-caption text-fg`, with a 10px `Plus` and the text "Add to prompt". Its accessible name stays "Add {name} to prompt".

- [ ] **Step 1: Write failing tests:**
  - `"the header shows the folder name over its path"`. The name has `font-semibold`. The path has `font-mono text-caption text-fg-subtle`. No heading "Files" is present.
  - `"header buttons are 26px and Reveal uses the external-arrow icon"`. "Reveal in Finder" has `h-6.5` and holds `svg.lucide-external-link`.
  - `"rows are 26px and indent 16px a level"`. A depth-2 file row's button has `h-[26px]` and `style.paddingLeft` `"54px"`. A depth-1 folder has `"20px"`.
  - `"an open folder keeps the closed icon"`: `svg.lucide-folder`, and no `lucide-folder-open`.
  - `"markers are 10px semibold"`. An M marker has `text-micro font-semibold text-status-attention`. A changed folder shows "•".
  - `"Add to prompt is a pill with its words"`. The button "Add SessionList.tsx to prompt" has the text "Add to prompt" and `h-5 border-border-strong`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/files-tab-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, including `IconButton` size `"row"` (update its JSDoc and `ui-primitives.test.tsx`'s size table).
- [ ] **Step 4: Migrate** `files-panel.test.tsx`: the marker classes at 280–287, and the dot becoming "•". Run it, plus `chrome-wiring.test.tsx`, `ui-primitives.test.tsx` and `button-sizes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the Files tab as on the canvas`.

### Task 6: The file view as drawn

**Files:**
- Modify: `src/components/files/FileViewer.tsx`, `src/lib/code-tokens.ts:10`, `src/styles/globals.css`, `docs/design-system/tokens.json`
- Test: `src/test/file-view-look.test.tsx` (new); migrate `src/test/file-viewer.test.tsx`

**Interfaces:**
- Consumes: `IconButton` size `"row"` (Task 5).

The artboard's values (`InspectorFileView.dc.html`):
- **Path bar.** `h-11 px-2 gap-1.5 border-b border-border`.
  - Back: "Files" with `ChevronLeft` 14, `h-6.5 pl-1 pr-2 gap-0.5 rounded-md text-ui-sm text-fg-secondary`. Ruling: `Button` has no 26px size, so add `Button` size `"row"` (`h-6.5 px-2 text-ui-sm`) and use `variant="ghost"` with `tone`, or the closest existing option, without overriding classes.
  - Breadcrumb: `nav aria-label="Path"` with `font-mono text-caption text-fg-subtle gap-1`. Segments and slashes are in `fg-subtle`, the file name in `text-fg`, and the marker after it at `ml-1 font-semibold` in its colour.
  - Three `IconButton size="row"` with 14px icons: `Plus` "Add {name} to prompt", `ExternalLink` "Open in editor", `Copy` "Copy path".
- **Meta bar.** Its own `h-8 pl-4 pr-3 gap-2 border-b border-border text-caption text-fg-subtle`, with "{language} · N lines · Read only". The checkbox label is `text-fg-secondary gap-1.5`, with a 12px checkbox.
- **Body.**
  - The well: `bg-bg py-2.5 font-mono text-ui-sm leading-5 text-fg-secondary` (12px on 20px lines).
  - Line number: `w-10 pr-3 text-right text-fg-subtle`.
  - Change bar: `w-[3px] mr-2.5`.
- **Selected lines.** While a selection covers lines A–B, those rows get `bg-line-selected`, and their numbers turn `text-fg`.
  - New token `--color-line-selected`: dark `rgba(161, 161, 170, 0.18)`, light `rgba(82, 82, 91, 0.14)`.
  - Usage note: "Rows of code the selection covers in the file view."
- **Add lines.**
  - A popover-style card `absolute flex p-0.5 rounded-lg border border-border bg-surface-3 shadow-popover`, inside the scrolling code (`relative` content box), so it scrolls with the lines.
  - Position: `top = 10 + B × 20 + 4` px (the padding, line B's bottom, a 4px gap) and `left: 56px` (just right of the gutter).
  - Its button: `h-7 px-2.5 gap-1.5 rounded-md text-ui text-fg` with a 14px `Plus` and `lineRangeLabel(...)`.
- **Syntax.** `TOKEN_STYLE.keyword` becomes `text-fg font-medium`.

- [ ] **Step 1: Write failing tests:**
  - `"the path bar is 44px and the meta bar its own 32px row"`: `h-11` and `h-8` on separate elements.
  - `"the breadcrumb is subtle mono with the name in fg"`.
  - `"the body is a 12/20 well on bg"`: `bg-bg leading-5 text-ui-sm`.
  - `"selected lines are tinted"`. Select lines 3–4 (the existing test helper that fakes a `Selection`), and expect rows 3 and 4 with `bg-line-selected`, and row 2 without.
  - `"the add-lines popover sits under the last selected line"`. With lines 3–4 selected, the button "Add lines 3–4 to prompt" lives in an element with `style.top` `"94px"` (10 + 4 × 20 + 4) and `style.left` `"56px"`.
  - `"keywords are medium weight"`. `TOKEN_STYLE.keyword` contains `font-medium`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/file-view-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, adding the token to `globals.css` (dark and light) and `tokens.json`, and `Button` size `"row"` (update `button-sizes.test.ts`).
- [ ] **Step 4: Migrate** `file-viewer.test.tsx` (gutter classes at 102–112, `w-12` becoming `w-10`). Run it, plus `design-tokens.test.ts`, `design-system-docs.test.ts` and `theme-contrast.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the file view as on the canvas`.

### Task 7: The terminal tab as drawn

**Files:**
- Modify: `src-tauri/src/workspace_terminal.rs:167-193`, `src/hooks/useWorkspaceTerminals.ts`, `src/lib/terminal-labels.ts`, `src/components/terminal/TerminalDrawer.tsx`, `src/components/TerminalView.tsx:139`, `src/lib/xterm-options.ts`, `src/styles/globals.css`, `docs/design-system/tokens.json`, `src/test/setup.ts`
- Test: `src/test/terminal-tab-look.test.tsx` (new); migrate `src/test/terminal-drawer.test.tsx` and `src/test/terminal-labels.test.ts`; a Rust unit test in `workspace_terminal.rs`

**Interfaces:**
- Produces:
  - `OpenedTerminal { id, folder, shell }`, where `shell: String` is the file name of the program started (`zsh`, `bash`, `fish`) from `fn shell_name(path: &str) -> String`, which falls back to "shell". The UI still sends only a folder.
  - `tabLabel(shell: string, number: number): string`, which reads `"zsh"`, then `"zsh 2"` from the second tab on. The old `(folderName, branch, number)` signature goes, and the branch leaves the tab: the top bar shows it.

The artboard's values (`InspectorTerminal.dc.html`):
- **Drawer.** The whole drawer is `bg-terminal-bg`.
- **Strip.** `h-9 pl-3 pr-2 gap-1 border-b border-terminal-surface`.
- **Tabs.**
  - Each tab is `h-6 px-2.5 gap-1.5 rounded-md text-ui-sm`.
  - Selected: `bg-terminal-surface text-terminal-fg-strong`. Others: `text-terminal-fg-muted`, with hover `text-terminal-fg-strong`.
  - The selected tab adds the folder name in `font-mono text-caption text-terminal-fg-subtle`.
  - Its close X is kept: `IconButton size="xs"` with `X` 12, in the terminal colours. Add an `IconButton` tone `"terminal"` (`text-terminal-fg-muted`, hover `bg-terminal-surface text-terminal-fg-strong`) rather than override the ghost classes.
- **New terminal.** `IconButton size="sm"` (24px) tone `"terminal"` with `Plus` 12.
- **Readout.** On the right: "{cols} × {rows}" in `text-caption text-terminal-fg-subtle tabular-nums`, from the selected tab's last `onResize`. Empty until one arrives.
- **New tokens.** They are the same in both themes, since the terminal stays dark:
  - `terminal-surface` `#27272a`: the strip's line and the selected tab;
  - `terminal-fg-strong` `#fafafa`: the selected tab's name;
  - `terminal-fg-muted` `#a1a1aa`: other tabs and the New terminal icon.
- **xterm.** `lineHeight: 1.5` (18px rows at 12px) and `cursorStyle: 'block'`.
  - Padding 12/14: `TerminalView`'s inset box becomes `inset-x-3.5 inset-y-3`.

- [ ] **Step 1: Write failing tests:**
  - Rust `opened_terminal_names_its_shell`: `shell_name("/bin/zsh") == "zsh"`, `shell_name("/usr/local/bin/fish") == "fish"` and `shell_name("") == "shell"`.
  - `"tabs read the shell, numbered from the second"`: `tabLabel("zsh", 1) === "zsh"` and `tabLabel("zsh", 2) === "zsh 2"`.
  - `"the strip is 36px on the terminal background"`. The drawer root has `bg-terminal-bg`. The strip has `h-9`.
  - `"the selected tab shows its folder in mono"`.
  - `"the size readout follows the selected tab and is empty before a fit"`. Mock `TerminalView` so the test can call each tab's `onResize`:
    - before any call, no "×" text;
    - after `onResize(80, 38)` on tab 1, "80 × 38";
    - after switching to tab 2 (no size yet), empty.
  - `"xterm draws 18px rows with a block cursor"`: `XTERM_OPTIONS.lineHeight === 1.5` and `cursorStyle === 'block'`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/terminal-tab-look.test.tsx src/test/terminal-labels.test.ts`, and `cargo test --lib workspace_terminal` from `src-tauri/`. Expected: FAIL.
- [ ] **Step 3: Implement.** Carry `shell` through `useWorkspaceTerminals`' tab record, and fake it in `src/test/setup.ts`'s `workspace_terminal_open` reply.
- [ ] **Step 4: Migrate** `terminal-drawer.test.tsx`:
  - "not `bg-terminal-bg`" becomes "has `bg-terminal-bg`";
  - "Close zorvo · main" becomes "Close zsh".
  Run it, plus `workspace-terminal-app.test.tsx`, `xterm-release-build.test.ts`, `ui-primitives.test.tsx`, `design-tokens.test.ts`, `design-system-docs.test.ts` and `theme-contrast.test.ts`. Then run `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` from `src-tauri/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the terminal tab as on the canvas, named by its shell`.

### Task 8: Docs and changelog

**Files:**
- Modify: `docs/design-system/components/Inspector/README.md`, `docs/design-system/components/Composer/README.md`, `docs/design-system/components/Popover/README.md`, `CHANGELOG.md`

- [ ] **Step 1: Inspector README.** Add the frame values (48px strip, the resize line and grip) and new sections **Activity** (intro, unreported card, turns, rail and dots, verbs and results) and **Terminal** (strip, shell names, readout). Update **Files** and **File viewer** to the values above. Drop the line saying ActivityPanel keeps its own header.
- [ ] **Step 2: Composer README** ("Menus"): a search also bolds what it matched across the provider tag, and in a choice's description. **Popover README** (`Highlighted`): it takes `ranges` as well as a query.
- [ ] **Step 3: CHANGELOG** under Unreleased:
  - "The inspector's tabs look as designed. Activity is grouped by turn and says what each step did, Files and the file view are tidier, and the terminal names its shell and shows its size."
  - "Search in the model menu bolds what it matched in a description too."
  - "The window can no longer shrink below 640 × 560."
- [ ] **Step 4: Run** `pnpm vitest run src/test/design-system-docs.test.ts`, then `pnpm lint`, `pnpm build` and the full `pnpm test` once. Expected: all green.
- [ ] **Step 5: Commit** `docs: describe the inspector as drawn`.

---

## Rulings in this plan

- **8c is split.** 8c1 (this plan) is the frame, Activity, Files, the file view and Terminal. 8c2 is Changes and the full diff review, because they share `FileDiff`/`DiffView` and the review comments. *Cost if wrong:* one more PR.
- **Activity verbs stay honest.** The artboard's "Edited … Did not finish" would claim an edit that may not have happened. So the verb is past tense only at `completed`, and otherwise says what the tool was for ("Edit"). *Cost if wrong:* one word map.
- **Results the data lacks.** Exit codes, result counts and per-entry +N/−N are not in `ToolExecution`, so those rows read "Done". *Cost if wrong:* a later backend field.
- **"Show in Changes" replaces the per-file buttons** in the unreported card, which used to open the full diff review. The paths become plain text. *Cost if wrong:* the paths become buttons again.
- **Terminal tabs lose the branch.** The artboard names tabs by shell. The branch is in the top bar, and the folder shows on the selected tab. *Cost if wrong:* the old label returns.
- **26px controls.** The canvas uses 26px icon and back buttons in the inspector. A `row` size is added to `IconButton` and `Button`, and a `terminal` tone to `IconButton`, instead of overriding classes. *Cost if wrong:* a few size entries.
- **Window minimum 640 × 560**, and 480 × 560 for popouts. The review suggested about 560 tall. The width keeps the chat usable with the sidebar hidden. *Cost if wrong:* two numbers.
- **Install above sign-in** in the draft's slot: you install an agent before you sign in to it. *Cost if wrong:* swap two `div`s.
