# Redesign phase 3b: top bar and full diff review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The top bar of the spec (title you can rename, branch and PR chips, bordered contextual chips, one ⋯ menu, Back/Forward only while the sidebar is hidden) and the full diff review that takes the chat area with a file list on the left.

**Architecture:** `TopBar.tsx` is rebuilt on the phase 1 `Chip` and `Popover` primitives; `PlanMenu` and `BackgroundTasksMenu` become chips that open popovers. The diff chip opens the inspector's Changes tab, which already has inline diffs, and **Open the diff** there opens `DiffView` expanded in the chat's place, with a file list on the left. Review behaviour (CLAUDE.md "Diff comments") is unchanged: Add still brings the diff beside the chat so the composer shows.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md` (sections "Top bar", "Menus, pickers, full diff review and small states", "Accessibility"). Phase 3a (`docs/superpowers/plans/2026-11-04-redesign-phase-3a-inspector.md`) is merged.

## Global Constraints

- No raw colors; tokens only (`design-tokens.test.ts`). `fg-subtle` is never used on `surface-hover` (`theme-contrast.test.ts`).
- Use `src/components/ui/` primitives (`Chip`, `Popover`, `PopoverHeader`, `PopoverOption`, `Button`, `IconButton`); every focusable control has `focus-ring`.
- Popover style: `surface-3`, `border`, `shadow-popover`, radius 8, 6px padding, options 30px tall (the `Popover` primitive already is this).
- Every status is a word next to its icon or dot; color never carries meaning alone.
- UI copy: sentence case, short declarative sentences, "you", agents by name.
- Prefer a focused hook or helper over growing `App.tsx`.
- Light local checks: run the test files a task names plus `pnpm lint`; the full suite runs once, before the final review, and in CI.
- `CHANGELOG.md` gets a line under Unreleased.

## Review Focus

1. Switching sessions while the title is being renamed must not rename the session you switched to (the field closes; Task 1 pins it).
2. A rename to an empty, blank or unchanged name keeps the name (Task 1).
3. Background tasks dropping to zero while their popover is open: the chip goes away and the open state is cleared, so the next task does not pop it open (Task 4).
4. A filter typed in the diff's Search files narrows the left file list too, and clicking a listed file opens a section that was collapsed (Task 6).
5. Review comment flows that need the composer (Add N to message) still bring the diff beside the chat now that it opens in the chat's place (Task 6, App tests).

---

### Task 1: A rename field shared by the sidebar row and the top bar title

**Files:**
- Create: `src/components/ui/RenameField.tsx`
- Modify: `src/components/sidebar/SessionRow.tsx:12-36` (move `RenameField` out), `src/components/TopBar.tsx`
- Test: `src/test/top-bar.test.tsx`, `src/test/session-row.test.tsx` (must stay green unchanged)

**Interfaces:**
- Produces: `RenameField({ value: string; label: string; onDone: (name: string | null) => void; className?: string })` — today's `RenameField` body with `session.name` → `value` and `aria-label={label}`. `onDone(null)` on Escape, `onDone(text)` on Return or blur, once.
- Produces: `TopBarProps.sessionId?: string` and `TopBarProps.onRename?: (name: string) => void`. A double-click on the title opens the field when `onRename` is given. `onRename` is called only with a trimmed, non-empty name that differs from `sessionName`. The field closes when `sessionId` changes.

- [ ] **Step 1: Write the failing tests** in `top-bar.test.tsx`:
  - `renames the session from a double-click on its title`: render with `sessionId="s1" sessionName="Alpha" onRename={spy}`; `fireEvent.doubleClick(screen.getByText("Alpha"))`; the textbox `Rename Alpha` has value `Alpha`; type `Beta`, press Enter → `spy` called once with `"Beta"`, field gone.
  - `keeps the name on Escape, a blank name or the same name`: three runs, `spy` never called.
  - `closes the field when another session shows`: open the field, `rerender` with `sessionId="s2" sessionName="Other"` → no textbox, `spy` not called.
  - `offers no rename without onRename`: double-click → no textbox.
- [ ] **Step 2: Run** `pnpm vitest run src/test/top-bar.test.tsx` — Expected: the four new tests FAIL.
- [ ] **Step 3: Implement** `RenameField`, use it in `SessionRow` (`value={session.name}`, `` label={`Rename ${session.name}`} ``) and in `TopBar` (internal `isRenaming` state, reset during render when `sessionId` differs from the last one seen).
- [ ] **Step 4: Run** `pnpm vitest run src/test/top-bar.test.tsx src/test/session-row.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: rename the session from the top bar title`.

### Task 2: Top bar layout and its ⋯ menu

**Files:**
- Modify: `src/components/TopBar.tsx`, `src/App.tsx` (the `<TopBar>` props)
- Test: `src/test/top-bar.test.tsx`, `src/test/chrome-wiring.test.tsx`, `src/test/onboarding-flow.test.tsx`

**Interfaces:**
- Consumes: Task 1's `sessionId`, `onRename`.
- Produces: `TopBarProps.onReveal?: () => void` (Open in Finder) and `onArchive?: () => void`; `onPopout` stays and moves into the menu. Removed: `onOpenSettings`, `workspacePath`. `workspaceName` is only the title when there is no session (a draft); with neither it reads "Zorvo". `canGoBack`, `canGoForward`, `onBack`, `onForward` render only while `onShowSidebar` is given.

Layout, left to right: (`Show sidebar`, `Back`, `Forward` while the sidebar is hidden), the title, the branch as `Chip variant="plain"` with `GitBranch` and the mono name (label `Branch <name>`), `PullRequestChip`; space; the contextual chips (Tasks 3–5); the `Inspector` toggle; the ⋯ menu: `IconButton` "More options" as the `trigger` of `Popover role="menu" label="More options" align="end"`, with `PopoverOption`s **Open in new window** (`onPopout`), **Open in Finder** (`onReveal`), **Rename** (opens Task 1's field), **Archive** (`onArchive`), each only when its handler is given; the button is hidden when none is. No folder badge.

- [ ] **Step 1: Write the failing tests** in `top-bar.test.tsx`:
  - `shows Back and Forward only while the sidebar is hidden`: without `onShowSidebar` no `Back`/`Forward`; with it, `Show sidebar`, `Back`, `Forward` in that order before the title.
  - `runs the more options menu`: open "More options" → menuitems `Open in new window`, `Open in Finder`, `Rename`, `Archive` in that order; each calls its handler and closes the menu; `Rename` shows the textbox `Rename Alpha`.
  - `leaves out menu items without a handler`: only `onPopout` → one menuitem.
  - `shows the branch as a plain chip and no folder badge`: `getByLabelText("Branch main")`; `workspaceName` text absent while `sessionName` is set.
- [ ] **Step 2: Run** `pnpm vitest run src/test/top-bar.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the layout and menu. In `App.tsx` pass `sessionId={activeSession?.id}`; `onRename` and `onArchive` only for an `activeSession` without a `compareRunId` (a run's sessions share one title, as `SessionMenu`'s `canRename` decides); `onArchive={() => void sessionActions.archiveSession(id, true)}`; `onReveal={shownFolderPath ? () => shell.revealFolder(shownFolderPath) : undefined}`; drop `onOpenSettings` (Settings lives in the sidebar footer).
- [ ] **Step 4: Migrate** `chrome-wiring.test.tsx` and `onboarding-flow.test.tsx`: Settings opens from the sidebar footer's **Settings** button, not the top bar's "More options"; Back/Forward tests hide the sidebar first (`Hide sidebar`).
- [ ] **Step 5: Run** `pnpm vitest run src/test/top-bar.test.tsx src/test/chrome-wiring.test.tsx src/test/onboarding-flow.test.tsx` and `pnpm lint` — Expected: PASS, lint clean.
- [ ] **Step 6: Commit** `feat: top bar chips and one more-options menu`.

### Task 3: The Plan chip and its popover

**Files:**
- Modify: `src/components/topbar/PlanMenu.tsx`, `src/components/TopBar.tsx`, `src/App.tsx`
- Test: `src/test/plan-menu.test.tsx`

**Interfaces:**
- Produces: `PlanMenu({ plan: readonly PlanEntry[]; source?: string })`; `TopBarProps.planSource?: string` (the active session's agent name), passed through.

The trigger is `Chip variant="outline"` with `ListTodo`, text `Plan 3/7`, `label="Plan, 3 of 7 done"`, as the `trigger` of `Popover role="dialog" label="Plan" align="end"` (`w-80`, `select-text`). Inside: `PopoverHeader` "Plan from <source>" ("Plan" without a source), a line `3 of 7 done` (`text-caption text-fg-muted`), then one row per entry: `completed` → `Check` in `text-status-running`, `in_progress` → `Loader2` with `motion-safe:animate-spin`, `pending` → `Circle` in `text-fg-muted`; each icon has `aria-label` "Done", "In progress" or "Not started". Done rows read `text-fg-muted`, no strike-through.

- [ ] **Step 1: Write the failing tests** (replacing the badge tests): `shows the plan as a chip with its progress` (button `Plan, 2 of 4 done` with text `Plan 2/4`); `opens the steps from the agent` (dialog `Plan` holds "Plan from Claude Code", "2 of 4 done", and the labels Done ×2, In progress ×1, Not started ×1); `closes on Escape and gives focus back to the chip`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/plan-menu.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; App passes `planSource` from the active session's agent name (the lookup the sidebar uses for its rows).
- [ ] **Step 4: Run** `pnpm vitest run src/test/plan-menu.test.tsx src/test/top-bar.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: the plan as a top bar chip`.

### Task 4: The background tasks chip and its popover

**Files:**
- Modify: `src/components/topbar/BackgroundTasksMenu.tsx`, `src/components/TopBar.tsx`
- Test: `src/test/background-tasks-menu.test.tsx`

**Interfaces:**
- Consumes: `BackgroundTasksMenuProps`, unchanged.

The menu renders nothing while `tasks` is empty, and calls `onOpenChange(false)` in an effect when it is open with no tasks. The trigger is `Chip variant="outline"` with `ListChecks`, text `1 background task` / `N background tasks`, in a `Popover role="dialog" label="Background tasks" align="end"` (`w-96`, `select-text`). Inside: `PopoverHeader` "Background tasks · N running"; rows as today (kind icon, name in `font-mono` for `shell`, `detail` as the origin line, status word in its color, elapsed time); **Open** only for `agent` and `subagent`; **Stop** as today; a last line `Tasks keep running when you switch sessions.` in `text-caption text-fg-muted`.

- [ ] **Step 1: Write the failing tests**: `shows nothing while no task runs`; `counts the tasks on the chip` ("2 background tasks", "1 background task"); `lists each task with its status, origin and actions` (header "Background tasks · 2 running", a shell row in mono with Stop and no Open, a subagent row with Open); `closes when the last task ends` (rerender open with `tasks=[]` → `onOpenChange(false)`, no dialog). The existing Stop and Stopping… tests stay.
- [ ] **Step 2: Run** `pnpm vitest run src/test/background-tasks-menu.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/test/background-tasks-menu.test.tsx src/test/use-background-tasks.test.tsx src/test/top-bar.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: background tasks as a top bar chip`.

### Task 5: The diff chip opens Changes; the inspector gives focus back on close

**Files:**
- Modify: `src/components/changes/DiffStatChip.tsx`, `src/components/TopBar.tsx`, `src/App.tsx`
- Test: `src/test/top-bar.test.tsx`, `src/test/inspector-app.test.tsx`, `src/test/chrome-wiring.test.tsx`, `src/test/changes-panel.test.tsx`

**Interfaces:**
- Produces: `DiffStatChip` gains `actionLabel?: string` (default `"Open the diff"`, the end of its `aria-label`) and renders as `Chip variant="outline"`. `TopBarProps.onOpenDiff` becomes `onOpenChanges?: () => void`, and the top bar's chip passes `actionLabel="Show in Changes"`. `TopBarProps.inspectorButtonRef?: Ref<HTMLButtonElement>` goes on the Inspector toggle.

App: `onOpenChanges={inspectorTabs.includes("changes") ? () => inspector.show("changes") : undefined}`; the Inspector's `onClose` closes it, then focuses `inspectorButtonRef` (carried from the 3a review: focus fell to the page).

- [ ] **Step 1: Write the failing tests**: in `inspector-app.test.tsx`, replace `opens the full diff from the diff chip…` with `opens the Changes tab from the diff chip` (chip `/12 lines added, 3 removed.*Show in Changes/` → tab Changes selected, no Diff view), and add `gives focus back to the Inspector button when it closes from its own button`; in `chrome-wiring.test.tsx`, the diff chip test opens the Changes tab.
- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector-app.test.tsx src/test/chrome-wiring.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/test/inspector-app.test.tsx src/test/chrome-wiring.test.tsx src/test/top-bar.test.tsx src/test/changes-panel.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: the diff chip opens the Changes tab`.

### Task 6: The full diff review in the chat's place, with a file list

**Files:**
- Create: `src/components/changes/DiffFileList.tsx`
- Modify: `src/hooks/useInspector.ts` (`openDiff`), `src/components/changes/DiffView.tsx`, `src/components/changes/DiffViewHeader.tsx`, `src/components/changes/DiffFileSection.tsx` (an `id` on its root)
- Test: `src/test/diff-view.test.tsx`, `src/test/use-inspector.test.tsx`, `src/test/inspector-app.test.tsx`, `src/test/diff-comments.test.tsx`, `src/test/review-message.test.tsx`

**Interfaces:**
- Produces: `DiffFileList({ stats: readonly FileStat[]; onSelect: (path: string) => void })` — `<nav aria-label="Changed files">` with one button per file (file name, its folder under it in `text-fg-muted`, `+N −N` with `formatLineCount`), `w-60 shrink-0 overflow-y-auto border-r border-border`; long paths truncate with a `title`.
- Produces: `diffSectionId(rootPath: string, path: string): string`, exported from `DiffFileSection.tsx` and used as the section root's `id`.
- `useInspector.openDiff()` also expands the diff for the current folder (`setExpandedFolder(folderPath ?? null)`); `collapseDiff`, `toggleDiffExpanded` and the per-folder rule stay.

In `DiffView`, while `isExpanded`: `DiffFileList` (fed `visible`, so Search files narrows it) beside the scrolling sections; choosing a file adds it to the open set and, after the render, calls `document.getElementById(id)?.scrollIntoView?.({ block: "start" })`. Above the sections, when `review` is given, the line `Click a line number to comment` (`text-caption text-fg-muted`). `DiffViewHeader` shows `N files` and `+A −R` (sums of `stats`) after the target picker. `ReviewCommentsBar` moves under the sections (`border-t` instead of `border-b`), in both modes.

- [ ] **Step 1: Write the failing tests**:
  - `use-inspector.test.tsx`: `opens the diff in the chat's place` (`openDiff` → `isDiffExpanded` true).
  - `diff-view.test.tsx`: `lists the changed files on the left while expanded` (nav `Changed files` with one button per stat; absent when not expanded); `opens a collapsed file chosen from the list` (26 files, so all start collapsed; click one in the list → its section open); `narrows the file list with Search files`; `shows the file count and totals in the header` ("2 files", "+12", "−3"); `puts the review comments under the diff` (the `Review comments` section follows the sections in document order).
  - `inspector-app.test.tsx`: `opens the full review from Changes in the chat's place, and Shrink brings the chat back` (after **Open the diff**: the chat article is hidden; **Shrink diff view** → chat shown, diff beside it).
- [ ] **Step 2: Run** `pnpm vitest run src/test/diff-view.test.tsx src/test/use-inspector.test.tsx src/test/inspector-app.test.tsx` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate** `diff-comments.test.tsx` and `review-message.test.tsx`: where a test opened the diff and needed the composer before adding, it clicks **Shrink diff view** first; where it clicked **Expand diff view** to reach the expanded state, that click goes. Adding comments still brings the composer back (`collapseDiff`); those assertions stay.
- [ ] **Step 5: Run** `pnpm vitest run src/test/diff-view.test.tsx src/test/use-inspector.test.tsx src/test/inspector-app.test.tsx src/test/diff-comments.test.tsx src/test/review-message.test.tsx src/test/changes-panel.test.tsx` and `pnpm lint` — Expected: PASS.
- [ ] **Step 6: Commit** `feat: the full diff review with a file list on the left`.

### Task 7: Docs

**Files:**
- Create: `docs/design-system/components/TopBar/README.md`, `docs/design-system/components/TopBar/preview.html` (`<!-- @dsCard group="Navigation" height=120 -->`, variables from `tokens.json` only, like `components/Inspector/preview.html`)
- Modify: `docs/design-system/components/Inspector/README.md` (the diff opens in the chat's place; the diff chip opens Changes), `CHANGELOG.md`, `CLAUDE.md`
- Test: `src/test/design-system-docs.test.ts`, `src/test/design-tokens.test.ts`

CLAUDE.md, carried from the 3a review: "Workspace terminal" names the inspector's Terminal tab (not a top-bar button and drawer) and says the first shell starts in the click that shows the tab; "Activity log" names the inspector's Activity tab; "Diff comments" says the review opens in the chat's place and Add brings it beside the chat.

- [ ] **Step 1: Write** the docs and the CHANGELOG line ("The top bar shows your plan, background tasks and changes as chips, with one menu for the session; the full diff review takes the chat area with a file list.").
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts` — Expected: PASS.
- [ ] **Step 3: Commit** `docs: the top bar and the full diff review`, then the full suite once and the whole-branch review before pushing.
