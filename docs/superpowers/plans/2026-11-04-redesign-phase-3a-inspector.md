# Redesign Phase 3a: Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's four side panels and the bottom terminal drawer with one inspector on the right. It has the tabs Changes, Activity, Files and Terminal, a width you can drag that is remembered, and a single Inspector button in the top bar.

**Architecture:**
- The pure layout rules (width bounds, the widened Terminal width, when the sidebar must give way) live in `src/lib/inspector.ts`.
- `useSidePanel` becomes `useInspector`, which holds one `tab | null` plus whether the full diff is open.
- A new `components/inspector/Inspector.tsx` draws the tabs, the resize edge and the close button around the existing panels. The panels lose their own width, border and close button.
- The full diff review takes the chat's place.

**Phase 3b** gets its own plan. It covers the top bar's chips, its ⋯ menu, renaming from the title, Back and Forward shown only while the sidebar is hidden, the Plan and Background tasks popovers on `Popover`, and the full diff review's file list.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, sections "Layout", "Inspector" (the tab structure and the Terminal tab), "Top bar" (the inspector toggle and the diff chip) and "Accessibility" (tabs, the separator).

## Global Constraints

- **Default and range:** the inspector is closed by default. It opens 380px wide, and its left edge drags between 320 and 720px.
- **Remembered width:** the width is remembered for this device, not per session.
- **Terminal width:** the Terminal tab widens it to at least 560px while it shows, and the remembered width comes back when you leave the tab.
- **Narrow windows:** when the window is too narrow for the sidebar (256px), the inspector and a chat column of 560px, opening the inspector hides the sidebar.
- **Shells keep running:** closing the Terminal tab or the inspector never ends a shell.
- **One state:** the inspector's state is one `tab | null`, replacing today's separate panel flags.
- **The full diff review** (`DiffView`, expanded) takes the chat area. The inspector may stay open beside it.
- **Popout windows** have no inspector, as today.
- **Accessibility:**
  - tabs use `role="tab"` and `aria-selected` (the phase 1 `Tabs` primitive)
  - the resize edge is a `role="separator"` with value attributes and works with the arrow keys
  - every control has `focus-ring`
- **Shortcuts:** none added.
- **Copy:** sentence case. The names are "Inspector", "Close inspector" and "Resize inspector".
- **Tests on this laptop:** each task runs only the files it names, plus `pnpm lint`. The full `pnpm test` runs once in Task 6. Nothing under `src-tauri/` changes, so there is no cargo run.
- **Commits:** Conventional Commits; stage explicit paths only; one `CHANGELOG.md` line under Unreleased.

**Ruling, made in the plan:** the width is kept in the webview's `localStorage` (key `zorvo.inspectorWidth`, every read and write in try/catch), not in `state.json`. The backend's `Settings` in `store.rs` drops fields it does not know, so persisting it there would need Rust changes and a cargo run. A width is a per-device convenience, and losing it falls back to 380. Cost if wrong: one setting moves to `Settings` later.

## Review Focus

1. **A tab that stops applying.** With Changes open, switching to a session whose folder is not a repository, or to no folder at all, shows no broken panel: the inspector closes. (Task 5 test.)
2. **A bad remembered width.** A stored value out of range, non-numeric, or `localStorage` throwing gives a width clamped to 320–720, or 380. (Task 1 test.)
3. **Shells after a close.** Closing the inspector or leaving the Terminal tab never calls `workspace_terminal_close`; going back shows the same shell. (Task 5 test.)
4. **Narrow windows.** Opening at a window width of 1100px hides the sidebar; at 1440px it does not. (Task 4 test.)
5. **Keyboard resize.** Arrow keys move the edge by 16px and stop at 320 and 720. (Task 2 test.)

---

### Task 1: Layout rules and the remembered width

**Files:**
- Create: `src/lib/inspector.ts`, `src/hooks/useInspectorWidth.ts`
- Test: `src/test/inspector-layout.test.ts`

**Interfaces:**
- Produces:
  - `export type InspectorTab = "changes" | "activity" | "files" | "terminal"`
  - `export const INSPECTOR_WIDTH = { min: 320, max: 720, initial: 380, wide: 560, step: 16 } as const`
  - `export const SIDEBAR_WIDTH = 256` and `export const MIN_CHAT_WIDTH = 560`
  - `export function clampInspectorWidth(px: number): number`: rounds the value and keeps it within `min` and `max`. A non-finite value gives `initial`.
  - `export function shownInspectorWidth(tab: InspectorTab | null, width: number): number`: 0 when `tab` is null, `Math.max(wide, width)` for `"terminal"`, else `width`.
  - `export function isCrowded(windowWidth: number, inspectorWidth: number, isSidebarShown: boolean): boolean`: true when `isSidebarShown && windowWidth - SIDEBAR_WIDTH - inspectorWidth < MIN_CHAT_WIDTH`.
  - `export function useInspectorWidth(): [width: number, setWidth: (px: number) => void]`: reads `localStorage["zorvo.inspectorWidth"]` once, clamped, and writes the clamped value on every set. Both are in try/catch.

- [ ] **Step 1: Write the failing tests** in `src/test/inspector-layout.test.ts`:
  - `it("keeps the width within 320 and 720")`:
    - `clampInspectorWidth(100)` is 320
    - `clampInspectorWidth(900)` is 720
    - `clampInspectorWidth(400.6)` is 401
    - `clampInspectorWidth(NaN)` is 380
  - `it("widens only the Terminal tab")`:
    - `shownInspectorWidth("terminal", 380)` is 560
    - `shownInspectorWidth("terminal", 640)` is 640
    - `shownInspectorWidth("files", 380)` is 380
    - `shownInspectorWidth(null, 380)` is 0
  - `it("gives way to the chat only when the window is narrow")`:
    - `isCrowded(1100, 380, true)` is true
    - `isCrowded(1440, 380, true)` is false
    - `isCrowded(1100, 380, false)` is false
  - `it("remembers the width, and survives a bad or blocked store")`, using `renderHook`:
    - set 500, then a fresh hook reads 500
    - a stored `"abc"` reads 380
    - a stored `"9999"` reads 720
    - with `localStorage.getItem` and `setItem` spied to throw, the hook reads 380 and `setWidth(450)` still updates the returned width
- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector-layout.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both files with the signatures above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: inspector layout rules and remembered width`.

### Task 2: The inspector shell

**Files:**
- Create: `src/components/inspector/Inspector.tsx`
- Test: `src/test/inspector.test.tsx`

**Interfaces:**
- Consumes: Task 1; `Tabs` and `tabIds` from `src/components/ui/Tabs.tsx`; `IconButton`.
- Produces: `export function Inspector(props: { tab: InspectorTab; tabs: readonly InspectorTab[]; width: number; counts?: Partial<Record<InspectorTab, number>>; onSelect: (tab: InspectorTab) => void; onResize: (px: number) => void; onClose: () => void; children: ReactNode }): JSX.Element`
  - **Shell:** an `<aside aria-label="Inspector">` with `style={{ width: shownInspectorWidth(tab, width) }}`, `shrink-0 border-l border-border bg-surface-1 flex flex-col relative`.
  - **Header:** the `Tabs` (label "Inspector", idPrefix "inspector", labels "Changes", "Activity", "Files", "Terminal", in that order, only those in `tabs`) and an `IconButton` "Close inspector".
  - **Body:** `role="tabpanel"` with `id` and `aria-labelledby` from `tabIds("inspector", tab)`, `flex min-h-0 flex-1 flex-col`, holding `children`.
  - **Left edge:** `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize inspector"`, `aria-valuemin=320`, `aria-valuemax=720`, `aria-valuenow={width}`, `tabIndex=0`, `focus-ring`.
    - ArrowLeft calls `onResize(width + step)` and ArrowRight calls `onResize(width - step)`, each clamped.
    - A pointer drag calls `onResize(startWidth + (startX - clientX))`, clamped.

- [ ] **Step 1: Write the failing tests:**
  - `it("shows the offered tabs and the current one")`:
    - with `tabs={["changes", "files", "terminal"]}` and `tab="files"`, there is a tablist "Inspector" with those three tabs
    - "Files" is selected
    - the tabpanel is labelled by it and holds the children
  - `it("selects a tab and closes")`: clicking "Terminal" calls `onSelect("terminal")`, and "Close inspector" calls `onClose`.
  - `it("resizes from the keyboard within bounds")`:
    - ArrowLeft on the separator at width 380 calls `onResize(396)`
    - ArrowRight at 320 calls `onResize(320)`
    - ArrowLeft at 712 calls `onResize(720)`
  - `it("drags its left edge")`: `pointerDown` at clientX 1000, then `pointerMove` to 900 on the window, calls `onResize(480)` from 380.
  - `it("is at least 560px wide on the Terminal tab")`:
    - `tab="terminal"` with `width={380}` gives `style.width` "560px"
    - `tab="files"` gives "380px"
- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pointer capture: a `pointermove`/`pointerup` listener on `window` while dragging, removed on up.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: inspector shell with tabs and a resize edge`.

### Task 3: Panels that fit inside it

**Files:**
- Modify: `src/components/changes/ChangesPanel.tsx`, `src/components/activity/ActivityPanel.tsx`, `src/components/FilesPanel.tsx`
  - The root loses `w-80`/`w-72`, `shrink-0` and `border-l`, and becomes `flex min-h-0 flex-1 flex-col`. The `aria-label` stays.
  - `onClose` becomes optional, and its close button renders only when it is given.
- Modify: `src/components/terminal/TerminalDrawer.tsx`
  - It fills its parent (`flex min-h-0 flex-1 flex-col`).
  - The vertical `ResizeHandle`, the height state and `border-t` are removed.
  - `onHide` becomes optional, and "Hide terminal" renders only when it is given.
- Modify: `src/components/changes/DiffView.tsx` and `DiffViewHeader.tsx`: `onToggleExpanded` becomes optional, and the "Expand/Shrink diff view" button renders only when it is given.
- Test: `src/test/changes-panel.test.tsx`, `src/test/activity-panel.test.tsx`, `src/test/files-panel.test.tsx`, `src/test/terminal-drawer.test.tsx`, `src/test/diff-view.test.tsx`

**Interfaces:**
- Produces: the same components and props, with `onClose`, `onHide` and `onToggleExpanded` now optional.

- [ ] **Step 1: Write the failing tests:**
  - in each of the three panel test files, `it("has no close button of its own inside the inspector")`: rendered without `onClose`, there is no "Close … panel" button
  - in `terminal-drawer.test.tsx`, `it("fills the inspector, with no height handle")`:
    - rendered without `onHide`, there is no "Resize terminal" separator and no "Hide terminal" button
    - the region "Terminal" has `flex-1`
  - delete the drawer's resize tests
  - in `diff-view.test.tsx`, `it("offers no expand button when it always fills the chat area")`: without `onToggleExpanded` there is no "Expand diff view" button
- [ ] **Step 2: Run** `pnpm vitest run src/test/changes-panel.test.tsx src/test/activity-panel.test.tsx src/test/files-panel.test.tsx src/test/terminal-drawer.test.tsx src/test/diff-view.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: let the side panels and the terminal fill the inspector`.

### Task 4: One inspector state

**Files:**
- Rename: `src/hooks/useSidePanel.ts` becomes `src/hooks/useInspector.ts`.
- Modify: `src/hooks/useTerminalDrawer.ts`. It keeps `startShell` and `startingFor`, drops `isOpen`, `toggle` and `hide`, and adds `ensureShell`.
- Test: `src/test/use-inspector.test.tsx` (new).

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export interface InspectorState { tab: InspectorTab | null; show: (tab: InspectorTab) => void; toggle: () => void; close: () => void; isDiffOpen: boolean; openDiff: () => void; closeDiff: () => void; width: number; setWidth: (px: number) => void; changes: SessionChanges; headStats: FileStat[] | null; headStatsFailed: boolean }`
  - `export function useInspector(folderPath: string | undefined, isRepository: boolean, turnsEnded: number, onError: (message: string) => void, layout: { isSidebarShown: boolean; onCrowded: () => void }): InspectorState`
    - `show` reloads `changes` when Changes or Activity opens from another tab.
    - `openDiff` always reloads.
    - `toggle` closes an open inspector, or opens the last tab used (first time: `"changes"` in a repository, else `"files"`).
    - `show` and `toggle` call `layout.onCrowded()` when `isCrowded(window.innerWidth, shownInspectorWidth(next, width), layout.isSidebarShown)`.
  - `useTerminalDrawer(...)` returns `{ startingFor: string | null; startShell: (folder: string) => Promise<string | null>; ensureShell: (folder: string) => void }`.
    - `ensureShell` starts a shell when the folder has none, using the same in-flight guard as `startShell`.

- [ ] **Step 1: Write the failing tests** in `src/test/use-inspector.test.tsx` (`renderHook`, with `useSessionChanges` and `useDiffStats` through the fake Tauri `invoke` as other hook tests do):
  - `it("opens the last tab, or Changes first in a repository")`:
    - `toggle()` from closed gives `"changes"` (repository) or `"files"` (not)
    - after `show("activity")`, `close()` and `toggle()`, it is `"activity"` again
  - `it("asks the sidebar to give way in a narrow window")`:
    - with `window.innerWidth` 1100 and `isSidebarShown` true, `toggle()` calls `onCrowded` once
    - at 1440 it does not
  - `it("keeps the diff apart from the tabs")`: `openDiff()` leaves `tab` as it was, and `closeDiff()` sets `isDiffOpen` false.
- [ ] **Step 2: Run** `pnpm vitest run src/test/use-inspector.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `useInspectorWidth` for `width` and `setWidth`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: one inspector state instead of separate panel flags`.

### Task 5: Wire it into the app

**Files:**
- Modify: `src/App.tsx`
  - **State:** `useInspector` replaces `useSidePanel`, with `layout = { isSidebarShown: !isSidebarHidden, onCrowded: () => setSidebarHidden(true) }`.
  - **Offered tabs:** Changes when `filesFolder && isRepository`; Activity when `activeSession`; Files and Terminal when `filesFolder`.
  - **Shown tab:** `inspector.tab` when it is offered, else none. The inspector renders only then.
  - **Selecting a tab** calls `terminalDrawer.ensureShell(filesFolder.path)` first for Terminal, then `inspector.show(tab)`.
  - **The Inspector toggle** does the same when it opens on Terminal.
  - **Inside the `Inspector`**, which replaces the four panel blocks and the `TerminalDrawer` under the chat: the panel for the shown tab, with no `onClose` or `onHide`.
  - **Opening the diff:** ChangesPanel's and ActivityPanel's `onOpenDiff` call `inspector.openDiff`.
  - **The diff's place:** `DiffView` renders in the chat's place (the `article` gets `hidden`) while `isDiffOpen`, with `isExpanded` always true, no `onToggleExpanded`, and `onClose={inspector.closeDiff}`. `expandedDiffFolder` goes away.
- Modify: `src/components/TopBar.tsx`
  - The four toggles and their props go.
  - Add `onToggleInspector?: () => void; isInspectorOpen?: boolean`: one `IconButton` "Inspector" (`PanelRight`, `aria-pressed`).
  - The diff chip shows when `diffStats && onOpenDiff` (App passes `() => inspector.show("changes")`).
- Create: `src/test/inspector-helpers.ts` with `export function openInspectorTab(label: "Changes" | "Activity" | "Files" | "Terminal"): void`. It clicks "Inspector" when no tablist "Inspector" is shown, then clicks that tab, using `fireEvent` like the files it serves.
- Test: these files move from the old names to the helper or to the new names. Find them with `grep -rlE 'Toggle (files|changes|activity) panel|name: "Terminal"|Expand diff view|Close (changes|files|activity) panel|Hide terminal' src/test`, and also update `top-bar.test.tsx`.
  - "Toggle X panel" to open becomes `openInspectorTab("X")`.
  - "Toggle X panel" or "Close X panel" to close becomes "Close inspector".
  - "Expand diff view" goes, since the diff always fills the chat area.
  - "Terminal" opens through `openInspectorTab("Terminal")`.

- [ ] **Step 1: Write the failing tests** (App level, in `src/test/inspector-app.test.tsx`, seeded like `chrome-wiring.test.tsx`):
  - `it("opens the inspector from the top bar on Changes, and closes it")`:
    - "Inspector" opens it with the tab "Changes" selected
    - "Close inspector" closes it
  - `it("opens Changes from the diff chip")`: the diff chip selects the tab "Changes".
  - `it("keeps the shell when you leave the Terminal tab or close the inspector")`:
    - open Terminal
    - switch to Files, then close the inspector, then open Terminal again
    - `workspace_terminal_open` was called once and `workspace_terminal_close` never
  - `it("closes the inspector when its tab no longer applies")`: with Changes open, select a session in a folder that is not a repository; there is no "Inspector" complementary region.
  - `it("shows the full diff in the chat's place")`:
    - from Changes, "Open the diff" shows the region "Diff view" and hides the chat
    - "Close diff view" brings the chat back and the inspector is still open
- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector-app.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the App and TopBar changes.
- [ ] **Step 4: Update** the listed test files. Then run `pnpm lint` and `pnpm vitest run` on the new test, the grep's files and `top-bar.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: one inspector with tabs instead of four side panels and a drawer`.

### Task 6: Docs, changelog and the phase check

**Files:**
- Create: `docs/design-system/components/Inspector/README.md` and `preview.html`. Show the tab strip with Changes selected and a count, the resize edge, and the close button. Use only `tokens.json` variables.
- Modify: `CHANGELOG.md`, adding one line under Unreleased / Changed.

- [ ] **Step 1:** Write the docs. Run `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 2:** Run `pnpm lint`, then `pnpm test` once. Expected: PASS.
- [ ] **Step 3:** Commit `docs: the inspector in the design system`, then review the branch before pushing.
- [ ] **Step 4:** After merge, republish the new `docs/design-system/` files to the Zorvo Design System artifact, index last.
