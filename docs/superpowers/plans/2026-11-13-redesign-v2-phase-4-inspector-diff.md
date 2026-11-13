# Redesign v2, phase 4: inspector and diff review — Implementation Plan

**Goal:** Bring the inspector's four tabs, the file viewer and the full diff review to the v2 look. Phase 1 already made the inspector a sheet with segmented tabs, so this phase is the content of each tab.

**Architecture:** Class changes in existing components, plus two moves: the Changes tab's comments bar goes inside its scroll area, and the full review's comments bar becomes a floating popover panel over the diff. No hook, review logic, git command or Tauri command changes.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, sections "Inspector" and "Full diff review". Artboards: the five `Inspector*.dc.html`, `DiffReview.dc.html`, and the inspector of `Main.dc.html`. Built on phase 3 (PR 200).

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. Copy and `aria-label`s stay as they are. No string is added in this phase.
- What the artboards do not draw stays: the inspector's and the review's Close, Refresh in Changes and Files, the close X on terminal tabs, Hide terminal, Delete on a saved comment, the pull-request list, the Activity filters and their counts, the comment count, "Clear sent", the bar's reason line and its gone and elsewhere lists, every empty, loading and error line, the Terminal tab's empty, starting and exited states, the binary, too-large, image and PDF states of the file viewer.
- Data the app does not keep is not drawn (spec default 5): a command's exit code and duration, counts on Activity rows, a "Stopped" row.
- A changed file's row shows its full path, as today; the artboard's shortened path is a drawing.
- 30px in an artboard means today's 28px control; 26px means the `row` size. No new `Button` or `IconButton` size.
- No raw colors; `sheet-fills.test.ts` keeps passing. Run targeted Vitest files only. Stage explicit paths.

## Decisions taken in this plan

1. **A change's kind letter keeps its status color.** The artboard draws it `fg-muted`; the color is how Added, Deleted and Modified are told apart at a glance, and the letter alone is a weak signal. Its place moves to before the path, as drawn.
2. **The inspector header's padding stays 12px** (the artboard has 10px): phase 1 set it with the tabs, and 2px is not worth re-pinning its tests.
3. **The file viewer's add-lines popover keeps its computed position**; only its panel style changes.

## Tasks

### Task 1: Changes tab

`changes/ChangesPanel.tsx`, `LineComment.tsx`, `LineCommentBox.tsx`, `ReviewCommentsBar.tsx`, `PullRequestList.tsx`; tests `changes-tab-look`, `comment-look`, `diff-rows-look`, `changes-comments`.

- Scroll area `gap-3 p-4` → `gap-2.5 p-3.5`; cards `gap-2` → `gap-2.5`.
- A file card is `bg-surface-2` closed and open. The row reads: checkbox (`size-3.5`), the kind letter (`w-2.5`, mono `caption`), the path (`fg` when open, `fg-secondary` closed), the comment count, the line counts, then the chevron (12px) last. The button that opens the card still wraps the path and carries `aria-expanded`.
- Comment box: `border-border-strong` → `border-border`, `rows` 3 → 2.
- Saved comment: `bg-surface-3` → `bg-surface-2`; the text over a right-aligned row of `row`-size buttons (Edit, Delete, Add to message).
- Comments bar, card variant: rendered inside the scroll area as its last child with `mt-auto`, `pl-3 pr-2 py-2`, no outer margin; Add is `row` size.
- Commit area: `px-4 py-3` → `px-3.5 pt-3 pb-3.5`.
- The pull-request menu takes `POPOVER_PANEL_STYLE`.

### Task 2: Activity tab

`activity/ActivityPanel.tsx`, `Unreported`; tests `activity-tab-look`, `activity-panel`.

- Container `p-4` → `p-3.5`.
- The filters sit in `SEGMENTED_TRACK` and use `segmentedItem(isPressed)`; they stay toggle buttons with `aria-pressed` and their counted labels.
- The unreported-files card: `rounded-xl px-3.5 py-3 gap-2.5`; the paths in a box (`rounded-md border border-border bg-ground px-2.5 py-2`, mono `caption`); its button `row` size.

### Task 3: Files tab and file viewer

`FilesPanel.tsx`, `files/FileViewer.tsx`; tests `files-tab-look`, `file-view-look`.

- Files header `pr-3 pl-4` → `pr-2.5 pl-3.5`; its icon buttons `row` → `md`; the filter field `h-[30px] border-border-strong` → `h-8 border-border`; tree rows `rounded` → `rounded-md`.
- File viewer: header icon buttons `row` → `md`; the add-lines popover takes `POPOVER_PANEL_STYLE`.

### Task 4: Terminal and the full diff review

`terminal/TerminalDrawer.tsx`, `changes/DiffViewHeader.tsx`, `DiffView.tsx`, `ReviewCommentsBar.tsx`; tests `terminal-tab-look`, `terminal-drawer`, `diff-review-look`, `diff-view`, `comment-look`.

- Terminal: the exited bar sits on `bg-sheet`; the empty and starting lines use `text-ui-sm`.
- Review header `pr-3 pl-4` → `pr-2.5 pl-3`; the target picker's chevron 14 → 12.
- Review comments bar: a floating panel (`POPOVER_PANEL_STYLE`, `pl-3.5 pr-2 py-2`) centred 16px above the bottom of the diff, inside a `relative` wrapper; the scroller gets `pb-20` while the bar shows, so the last lines are never under it. Its label stays "Add N comments to message".

### Task 5: Docs and checks

Design-system pages for the Inspector; a `CHANGELOG.md` line; `pnpm lint`; the targeted tests plus `sheet-fills`, `design-tokens`, `theme-contrast`, `design-system-docs`; self-review; push with the SSH keepalive; a PR against `main` listing the three decisions. The in-app check is done after, with the phase 3 check.
