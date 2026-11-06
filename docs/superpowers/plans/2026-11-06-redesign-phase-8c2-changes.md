# Redesign phase 8c2: the Changes tab and the full diff review as drawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inspector's Changes tab and the full diff review match the design canvas, and let you comment on lines in the Changes tab as you can in the full review.

**Architecture:**
- The diff rows, the comment box, saved comments and the comments bar are shared, so they are restyled once. A `density` option tells the compact card in the Changes tab from the roomy full review.
- The per-file comment wiring that `DiffView` builds today moves into a hook. `ChangesPanel` then gets the same comments without a copy of that logic.
- Behavior stays as CLAUDE.md "Diff comments" describes. The only changes are where comments can be written (now in Changes too) and the button and status wording the artboards draw.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:**
- **Audit:** `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, the 8c bullet **Changes** and the 8b bullet **Full diff review**.
- **Artboards:** `InspectorChanges.dc.html` and `DiffReview.dc.html`, in the "Zorvo redesign layouts" Design artifact (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz, `project/`).
- **Behavior:** CLAUDE.md "Diff comments" and "Compare agents".

## Global Constraints

- **Authority.** The artboard decides the look; the spec and CLAUDE.md decide behavior. Comments never move between lines (`commentStatus`), and Send is the only way out for a comment.
- **Canvas variable → token.**
  - Surfaces and lines: `--bg` `bg`, `--s1` `surface-1`, `--s2` `surface-2`, `--s3` `surface-3`, `--hover` `surface-hover`, `--line` `border`, `--strong` `border-strong`.
  - Text: `--fg` `fg`, `--fg2` `fg-secondary`, `--muted` `fg-muted`, `--subtle` `fg-subtle`.
  - Status: `--run` `status-running`, `--danger` `danger`, `--add` `diff-added`, `--rem` `diff-removed`.
  - Type: 13/18 `text-ui`, 12/16 `text-ui-sm`, 11/16 `text-caption`.
- **No raw colours, no raw text sizes.** No raw colours (`design-tokens.test.ts`). Replace the touched `text-[10px]` and `text-[11px]` with `text-micro` and `text-caption`.
- **Focus.** Every focusable control keeps `focus-ring`.
- **Primitives first.** Use `ui/Button` (sizes `sm` 24, `row` 26, `md` 28; variants; ghost `tone`), `ui/IconButton` (sizes and `tone`) and `ui/Popover`. A caller's className never sets padding, height or text size on a `Button` (`button-sizes.test.ts`).
- **Copy.** Sentence case, "you". There are no keyboard shortcuts and no voice input.
- **Checks.** Run the targeted test files while working, and the full suite once, at the end. Nothing here touches `src-tauri`.

## Review Focus

1. **A comment written in Changes, read in a review on another target.** A Changes comment is written against `head`. If the full review then shows `base` or `start`, that comment reads "Not in this diff" there, and it is still counted once in the bar. Task 7, test "a comment from the Changes tab reads Not in this diff in a review against base".
2. **Comments held for another session.** While the composer holds another session's comments (`isHeldFor`), Add in the Changes tab is disabled with the same reason as in the full review. Task 7, test "Changes' Add says why while the message holds another session's comments".
3. **A very long line in the Changes card.** The card scrolls sideways inside itself and never widens the inspector. Task 6, test "the inline diff scrolls inside its card".
4. **Line comments from the keyboard in Changes.** The inline diff is a grid as in the review, and its active line offers "Comment on line N". Task 7, test "the Changes inline diff offers a comment on its active line".
5. **Files with zero on one side.** The file list and the Changes cards show only the nonzero counts (`+14` alone, `−5` alone), and a binary file shows no count. Task 4, test "the list shows only nonzero counts"; Task 6, test "a card shows only nonzero counts".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/components/changes/DiffRows.tsx` | Rows as drawn; `density` `"card"` or `"review"`; the line badge | 1, 2 |
| `src/components/changes/FileDiff.tsx` | Passes `density` through | 1 |
| `src/components/changes/LineComment.tsx`, `LineCommentBox.tsx`, `src/lib/review-comments.ts` | Comment box, saved comment card, status words | 2 |
| `src/components/changes/ReviewCommentsBar.tsx` | The floating comments bar | 3 |
| `src/components/changes/DiffView.tsx`, `DiffViewHeader.tsx`, `DiffFileList.tsx`, `DiffFileSection.tsx` | Full review frame, header, file list, file header | 4, 5 |
| `src/hooks/useFileReviews.ts` (new) | Per-file comment wiring shared by both views | 5 |
| `src/components/changes/ChangesPanel.tsx`, `src/App.tsx` | Changes tab as drawn, with comments | 6, 7 |
| `CLAUDE.md`, `docs/design-system/components/Inspector/README.md`, `CHANGELOG.md` | Docs | 8 |

---

### Task 1: Diff rows as drawn, in two densities

**Files:**
- Modify: `src/components/changes/DiffRows.tsx:8-21` and its row markup, `src/components/changes/FileDiff.tsx`
- Test: `src/test/diff-rows-look.test.tsx` (new); migrate `src/test/diff-view.test.tsx:110-115` only if the review density breaks it

**Interfaces:**
- Produces:
  - `DiffRows` prop `density?: "card" | "review"`, defaulting to `"review"`.
  - `FileDiff` prop `density?: "card" | "review"`, passed through to `DiffRows`.

**Values:**
- **Review density** (`DiffReview.dc.html` `.dl`):
  - the list is flush, with no box: `py-2 font-mono text-ui-sm leading-5 text-fg-secondary`, replacing `LIST`'s `mx-1.5 mb-1.5 max-h-80 rounded-md border border-border bg-bg`;
  - two 40px gutters `w-10 pr-2 text-right tabular-nums text-fg-subtle`, then a sign cell `w-4 text-fg-subtle`.
- **Card density** (`InspectorChanges.dc.html` `.dl`):
  - `py-1 font-mono text-caption leading-[18px] text-fg-secondary`;
  - one 30px gutter `w-[30px] pr-2 text-right text-fg-subtle`, showing the new line number, or the old one for a removed line;
  - the sign cell stays (`w-3.5`).
- **Both densities:**
  - added rows `bg-diff-added`, removed rows `bg-diff-removed`, with text in `fg-secondary`, not status colours;
  - the hunk row has no fill, in `text-fg-subtle`;
  - context rows `text-fg-secondary`;
  - the active row (grid focus) shows `shadow-[inset_2px_0_0_var(--color-fg)]` in place of the inset ring.
- **`max-h-80`:** it stays only in card density, where the card caps a long diff.

- [ ] **Step 1: Write failing tests:**
  - `"review rows are 12/20 with two 40px gutters and a sign column"`;
  - `"card rows are 11/18 with one 30px gutter"`: a removed row's gutter holds its old number;
  - `"added and removed rows are tinted, their text fg-secondary"`;
  - `"the hunk row has no fill"`;
  - `"the active row shows a 2px fg bar"`: the class is present on the row's grid-focus variant.
- [ ] **Step 2: Run** `pnpm vitest run src/test/diff-rows-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus `diff-view.test.tsx`, `diff-comments.test.tsx`, `changes-panel.test.tsx` and `review-message.test.tsx`. Migrate what the new row text colour breaks (assertions on `text-status-running` or `text-danger` rows). Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw diff rows as on the canvas, in a card and a review density`.

### Task 2: The comment box, saved comments and the line badge

**Files:**
- Modify: `src/components/changes/LineCommentBox.tsx`, `src/components/changes/LineComment.tsx`, `src/components/changes/DiffRows.tsx` (badge), `src/lib/review-comments.ts` (`STATUS_LABEL`, if it lives there)
- Test: `src/test/comment-look.test.tsx` (new); migrate `src/test/review-message.test.tsx` and `src/test/diff-comments.test.tsx`

**Values:**
- **Comment box** (`DiffReview.dc.html`):
  - card: `rounded-lg border border-border-strong bg-surface-2 p-2.5 gap-2 font-sans text-ui`, indented `ml-[104px] mr-4 mt-1.5 mb-2` in review density and `ml-[38px] mr-2.5 mb-2.5` in card density;
  - a visible label "Comment on line 42" (or "Edit comment on line 42") in `text-caption text-fg-muted`, over the textarea, which is `rounded-md border border-border-strong bg-bg px-2 py-1.5 text-fg`;
  - actions on the right: Cancel `Button variant="ghost" tone="secondary" size="row"`, and **Save comment** `Button variant="outline" size="row"`.
- **Saved comment card** (`InspectorChanges.dc.html`):
  - `rounded-lg border border-border bg-surface-3 p-2.5 gap-2`, at the same indent as the box;
  - meta: "Line 42" in `text-caption font-medium text-fg-secondary`, then "· Current" in `text-caption text-fg-subtle`; "Outdated" stays `text-status-attention`;
  - body `text-ui text-fg-secondary`;
  - actions on the right: Edit `Button ghost tone="secondary" size="sm"`, **Add to message** (was "Add") `Button outline size="sm"`. "Add again", Delete and "Delete?" keep their behavior, at size `sm`.
- **Status words.** `STATUS_LABEL` gains `current: "Current"` and `unknown: "Unknown"`, so every comment says where it stands. "In message" and "Sent" keep their meaning.
- **Line badge** (review density only): at the end of a row whose line holds comments,
  - `ml-4 inline-flex h-[18px] items-center gap-1 rounded border border-border bg-surface-3 px-1.5 font-sans text-caption text-fg-secondary`;
  - text "N comment(s) · <status of the first>", e.g. "1 comment · Current".

- [ ] **Step 1: Write failing tests:**
  - `"the comment box is an indented card with a visible label"`: the label text "Comment on line 42" is visible and not only an aria-label, and the card has `ml-[104px]`;
  - `"a saved comment reads Line N · Current with Add to message"`;
  - `"a row with comments ends in a badge"`: "1 comment · Current";
  - `"an unknown comment says Unknown"`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/comment-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The badge reads the comments the row already has through `RowReview`; no new data.
- [ ] **Step 4: Migrate** `review-message.test.tsx` (buttons named "Add" become "Add to message") and `diff-comments.test.tsx` (the box label). Run them, plus `review-comments.test.ts` and `button-sizes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the comment box, saved comments and the line badge as on the canvas`.

### Task 3: The comments bar as a floating card

**Files:**
- Modify: `src/components/changes/ReviewCommentsBar.tsx`
- Test: `src/test/comment-look.test.tsx`; migrate `src/test/review-message.test.tsx`

**Values** (both artboards):
- **Bar:** `mx-4 mb-4 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-ui`, replacing the full-width `border-t` strip. `max-h-64 overflow-y-auto` stays.
- **Top row:** a `MessageSquare` 14 in `text-fg-muted`, then "N comment(s) not in a message" in `flex-1 text-fg-secondary`, then **Clear sent** (`Button ghost sm`, when there are sent comments), then **Add N to message**.
  - In the full review it is `Button variant="primary" size="md"`. In Changes it is `variant="outline" size="sm"`, with the shorter visible text "Add N".
  - Both keep `aria-label="Add N comment(s) to message"`, so the full name is unchanged.
- **The reason line and the out-of-view comments** keep their texts, in `text-caption text-fg-subtle`.
- **Variant switch:** a `variant?: "review" | "card"` prop on the bar.

- [ ] **Step 1: Write failing tests:**
  - `"the bar is a floating card that counts comments not in a message"`: the text "2 comments not in a message" and `rounded-lg`;
  - `"its Add keeps the full name"`: role button, name "Add 2 comments to message", visible text "Add 2 to message";
  - `"the card variant reads Add 2"`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `comment-look.test.tsx` and `review-message.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: float the comments bar as a card, as on the canvas`.

### Task 4: The full review's frame, header and file list

**Files:**
- Modify: `src/components/changes/DiffView.tsx` (root, body, selected file), `DiffViewHeader.tsx` (`TargetPicker` on `ui/Popover`), `DiffFileList.tsx`, `DiffFileSection.tsx`
- Test: `src/test/diff-review-look.test.tsx` (new); migrate `src/test/diff-view.test.tsx`

**Values** (`DiffReview.dc.html`):
- **Root.** `bg-bg`, with `text-ui`. The scroller loses `p-2 text-xs`. The top hint line goes; the hint moves into each file header.
- **Header.**
  - `h-12 gap-2 pr-3 pl-4 border-b border-border`.
  - The target trigger is 28px, 600, `text-fg`, with a 14px chevron. It is a `ui/Popover` `role="listbox"` with `PopoverOption` rows (check on the left), and its accessible name stays "Diff target: <label>".
  - Then "N files" in `text-ui-sm text-fg-muted`, and the counts in mono `text-caption`.
  - Search and More are `IconButton tone="secondary"` (28px).
  - Shrink/Expand is `Button variant="outline" size="md"` with a 12px `Minimize2`/`Maximize2` and the visible text "Shrink"/"Expand". Its `aria-label` stays "Shrink diff view"/"Expand diff view".
  - Close is kept as `IconButton tone="secondary"`.
- **File list.**
  - `w-60 bg-surface-1 px-2 py-2.5 flex flex-col gap-0.5 border-r border-border`.
  - Rows `h-[30px] gap-2 px-2.5 rounded-md font-mono text-caption text-fg-secondary`, one line with the name, and the folder in `title`.
  - The selected row is `bg-surface-hover text-fg`.
  - `+N` and `−N` show only when nonzero.
  - **Selected** is the last file you picked in the list, else the first. It is state in `DiffView`, `selectedPath`.
- **File header** (`DiffFileSection`).
  - `h-9 gap-2 px-4 border-b border-border`.
  - The collapse chevron is kept. The full path is in mono `text-ui-sm text-fg`.
  - With review, "Click a line number to comment" in `text-caption text-fg-subtle`.
  - The counts and the comment summary are kept, in `text-caption`.

- [ ] **Step 1: Write failing tests:**
  - `"the review header is 48px with the target, count and totals"`;
  - `"the target picker is a listbox popover with the check on the left"`: option "HEAD → working tree" has `aria-selected`;
  - `"Shrink is an outline text button that keeps its name"`;
  - `"the list shows only nonzero counts and marks the picked file"`;
  - `"each file header carries the comment hint"`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate** `diff-view.test.tsx` (L229-296 target picker roles, L674-715 list and totals). Run it, plus `diff-comments.test.tsx`, `review-message.test.tsx` and `inspector-app.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the full diff review's header and file list as on the canvas`.

### Task 5: One hook for per-file comment wiring

**Files:**
- Create: `src/hooks/useFileReviews.ts`
- Modify: `src/components/changes/DiffView.tsx:98-140`
- Test: `src/test/use-file-reviews.test.tsx` (new); `diff-comments.test.tsx` and `review-message.test.tsx` must pass unchanged

**Interfaces:**
- Produces:
  ```ts
  export function useFileReviews(input: {
    review: ReviewComments | undefined;
    addReview: AddReview | undefined;
    target: DiffTargetId;
    targets: { root: string; prefix: string; base?: { name: string } | null } | null;
    /** A reason Add is off for this view (targets or the list failed to load). */
    blockedReason?: string;
  }): { fileReviewFor: (path: string) => FileReview | undefined; comments: ReviewComment[]; adder: CommentAdder | undefined };
  ```
  This is exactly what `DiffView` builds today: `sortComments`, the `CommentAdder`, and the per-file `FileReview`. It is moved, not changed.

- [ ] **Step 1: Write the failing test** `"builds the same file review DiffView used to"`: a comment on `src/a.ts` at `head` gives `fileReviewFor("src/a.ts")` with that comment, and Add calls `addReview.add` with the target and paths.
- [ ] **Step 2: Run** it. Expected: FAIL (module missing).
- [ ] **Step 3: Move** the code into the hook and call it from `DiffView`.
- [ ] **Step 4: Run** it, plus `diff-comments.test.tsx`, `review-message.test.tsx` and `diff-view.test.tsx`. Expected: PASS with no other test changed.
- [ ] **Step 5: Commit** `refactor: move per-file comment wiring into useFileReviews`.

### Task 6: The Changes tab as drawn

**Files:**
- Modify: `src/components/changes/ChangesPanel.tsx`, `src/components/changes/PullRequestList.tsx` (text tokens only), `src/App.tsx` (pass `stats`)
- Test: `src/test/changes-tab-look.test.tsx` (new); migrate `src/test/changes-panel.test.tsx`

**Interfaces:**
- Produces: new `ChangesPanel` prop `stats?: readonly FileStat[]`, the per-file counts against HEAD (`inspector.headStats`).

**Values** (`InspectorChanges.dc.html`):
- **Base.** `text-ui text-fg-secondary`, and the body `p-4 flex flex-col gap-3`.
- **Header.** The panel's own header (title, branch line, raw buttons) goes, since inspector panels have none.
- **Summary row.**
  - "N file(s) changed" in `font-semibold text-fg`, then `+N` and `−N` in mono `text-caption` `text-status-running` / `text-danger` (each only when nonzero), then a spacer.
  - Then **Open the diff**: `Button variant="ghost" size="row"` with a 12px `Maximize2`. It replaces the `DiffStatChip` strip and keeps the accessible name `"N lines added, M removed. Open the diff"`.
  - Then **Refresh changes**: `IconButton size="row"` with a 14px `RefreshCw`.
- **File cards.**
  - Each card is `rounded-lg border border-border overflow-hidden`, with `bg-surface-2` while it is open.
  - The header row is `flex items-center gap-2 px-2.5 py-2`. It holds:
    - the include checkbox (kept, before the chevron, `size-3 accent-primary`);
    - a 14px chevron in `text-fg-muted` (`ChevronDown` open, `ChevronRight` closed);
    - the full path in `flex-1 truncate font-mono text-caption text-fg-secondary`;
    - "N comment(s)" in `text-caption text-fg-muted`, when that file has comments;
    - the kind letter (kept, `text-micro`);
    - `+N` and `−N` from `stats`, only when nonzero.
  - Open, the card adds a `border-b border-border` under its header and shows `FileDiff density="card"` inside `overflow-x-auto`, so a long line scrolls in the card.
- **Commit area.**
  - `px-4 py-3 gap-2 border-t border-border`.
  - Textarea `rounded-lg border border-border-strong bg-bg px-2.5 py-2 text-ui text-fg`, rows 2, with an sr-only label "Commit message".
  - **Commit N file(s)** as `Button variant="primary"` in full width. There is no **Create pull request**; see Rulings.
- **Pull requests and GitHub.** Kept. `text-[11px]` becomes `text-caption` and `text-[10px]` becomes `text-micro`; the layout is unchanged.

- [ ] **Step 1: Write failing tests:**
  - `"the summary row counts the files and opens the diff"`;
  - `"there is no header of its own"`: no "Changes (3)" text;
  - `"each file is a bordered card with its full path and counts"`;
  - `"a card shows only nonzero counts"`;
  - `"the inline diff scrolls inside its card"`: the diff's wrapper has `overflow-x-auto` and the card `min-w-0`;
  - `"the commit area has a full-width Commit"`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, and pass `stats={inspector.headStats ?? undefined}` from `App`.
- [ ] **Step 4: Migrate** `changes-panel.test.tsx`:
  - L47-52: the header texts go;
  - L93: the chip becomes the "Open the diff" button, with the same name;
  - L98-110: the zero-totals child count;
  - L125-135: the card opens by its path's button.
  Run it, plus `inspector-app.test.tsx`, `chrome-wiring.test.tsx` and `github-app.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draw the Changes tab as on the canvas`.

### Task 7: Line comments in the Changes tab

**Files:**
- Modify: `src/components/changes/ChangesPanel.tsx`, `src/App.tsx:1329` (pass `review` and `addReview` as for `DiffView` at ~1292)
- Test: `src/test/changes-comments.test.tsx` (new)

**Interfaces:**
- Consumes: `useFileReviews` (Task 5), `ReviewCommentsBar variant="card"` (Task 3), `FileDiff density="card"` (Task 1).
- Produces: `ChangesPanel` props `review?: ReviewComments` and `addReview?: AddReview`.
  - The cards' `FileDiff` gets `review={fileReviewFor(path)}`, `takesComments` and `target="head"`.
  - The bar shows under the list while there are comments to add.

- [ ] **Step 1: Write failing tests** (render `App` as `review-message.test.tsx` does, or `ChangesPanel` with the hook's inputs):
  - `"the Changes inline diff offers a comment on its active line"`: "Comment on line N" is present in the open card;
  - `"a comment saved in Changes shows in the card and the bar counts it"`: "1 comment not in a message";
  - `"Add 1 puts it in the message"`: the composer holds the comment text, and the comment reads "In message";
  - `"Changes' Add says why while the message holds another session's comments"`;
  - `"a comment from the Changes tab reads Not in this diff in a review against base"`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, plus `review-message.test.tsx`, `diff-comments.test.tsx`, `changes-panel.test.tsx` and `inspector-app.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: comment on lines in the Changes tab`.

### Task 8: Docs and changelog

**Files:**
- Modify: `CLAUDE.md` ("Diff comments": "only `DiffView` passes" becomes "`DiffView` and `ChangesPanel` pass"), `docs/design-system/components/Inspector/README.md` (a **Changes** section; the full review paragraph's values), `CHANGELOG.md`

- [ ] **Step 1: CLAUDE.md and the README** as above, with the values from Tasks 1–7.
- [ ] **Step 2: CHANGELOG** under Unreleased:
  - "The Changes tab and the full diff review look as designed: each changed file is a card with its counts, the review has a file list with the picked file marked, and comments read where they stand ("Line 42 · Current")."
  - "Comment on lines in the Changes tab too, and add them to your message from there."
- [ ] **Step 3: Run** `pnpm vitest run src/test/design-system-docs.test.ts`, then `pnpm lint`, `pnpm build` and the full `pnpm test` once. Expected: all green.
- [ ] **Step 4: Commit** `docs: describe the Changes tab and the full review as drawn`.

---

## Rulings in this plan

- **No "Create pull request".** The artboard draws it beside Commit, but Zorvo has no command that opens a pull request. Building one means a backend command running the user's `gh pr create` with a fixed argument list, a push first, and its own errors, which needs its own spec. Commit stays full width. *Cost if wrong:* one button, once that command exists.
- **"Open the diff" in place of "Since session start ▾".** The Changes tab lists what Commit would commit, so its scope is always uncommitted changes. Choosing a target (base, start of the worktree) is the full review's job. The summary row's ghost button therefore opens the review. *Cost if wrong:* a scope popover in the tab.
- **Target labels stay.** "HEAD → working tree", "main → working tree" and "Start of this worktree → working tree" are exact, and the comments bar repeats them ("Show <target>"), so the artboard's "Since session start" is not adopted. *Cost if wrong:* one label map.
- **The include checkbox and the kind letter stay** on each Changes card. The artboard drops them, but they carry function (what Commit takes; added, deleted, renamed). *Cost if wrong:* two elements.
- **The line badge is in the review only.** The Changes card shows the saved comment card under its line, as its artboard does. *Cost if wrong:* the badge in cards too.
- **Selected file = the last one picked.** The artboard marks one file. Following the scroll position is not built. *Cost if wrong:* a scroll listener.
- **Add's full name stays** ("Add 2 comments to message") while the button reads "Add 2 to message", or "Add 2" in Changes. *Cost if wrong:* none to screen readers.
