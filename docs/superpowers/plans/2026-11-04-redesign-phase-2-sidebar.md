# Redesign Phase 2: Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the left sidebar as the spec's "Sidebar" section describes:
- two-line session rows with the status in words
- hover and focus actions, with Delete moved into the row menu
- folded-folder summaries and a compare-run group row
- an Agents menu in the footer, replacing the detected-agents list
- a sidebar that can be hidden

**Architecture:** The wording rules (status words, a row's second line, the folded-folder and run summaries) become pure functions in `src/lib/sidebar-status.ts`. Today `Sidebar.tsx` (414 lines) and `sidebar/SessionList.tsx` (377 lines) hold everything; they split into focused components under `src/components/sidebar/`, built on the phase 1 primitives (`Popover`, `Button`, `IconButton`). `App.tsx` gains only a hidden flag and the footer wiring.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`. The sections that apply are "Sidebar", "Layout" (sidebar 256px, collapsible to zero, show button in the top bar), "Visual foundations" (rows 44px, two lines) and "Accessibility".

## Global Constraints

- **Order from top:**
  1. the hide button
  2. **New session** (outline)
  3. **Search sessions**
  4. **Pinned** (only when something is pinned)
  5. folder groups
  6. **Archived (N)** (folded, at the bottom)
  7. the footer
- **Session row:** 44px (`h-11`), two lines.
  - Line 1 is the title, `font-medium` while unread.
  - Line 2 is the agent, ` · `, then the status word or, when idle, the relative time from `createdAt`.
  - The status dot sits on the left and never hides.
- **Status words:** "Waiting for you", "Working", "Finished, unread". The same words are the row's `title` tooltip.
- **Folded folder summary:** "N waiting" (attention color), else "N working", else "N session"/"N sessions".
- **Rows never reorder** when a status changes. The order stays as `groupSessionsByWorkspace` gives it.
- **Row actions on hover or focus:** Stop while the agent works, and a ⋯ menu with Rename, Pin, Archive, Delete. Delete keeps its confirm step: "Delete?" on `danger-surface` in `danger`, turning back by itself after `CONFIRM_DELETE_MS` (4000).
- **Hover-only actions also appear on keyboard focus** (`group-focus-within`).
- **Compare run:** one group row with stacked agent logos, "Compare · N agents", and a summary line ("2 working, 1 finished"). A click opens the run panel; its sessions stay listed under it.
- **Footer:**
  - avatar and name, from the unchanged `ProfileFooter` chain
  - an **Agents** button of stacked logos (at most three) with an attention dot when one needs sign-in
  - a **Settings** button with the `SlidersHorizontal` icon
- **Agents menu:**
  - "Agents in use", each agent with its sign-in state (Ready, Not checked, or a **Sign in** button)
  - then **Manage agents**, which opens Settings → Agents
  - the detected-agents list leaves the sidebar body
- **Sidebar size:** 256px (`w-64`). **Hide sidebar** collapses it to zero, and **Show sidebar** appears at the left of the top bar while it is hidden. The hidden state is not persisted in this phase.
- **Shortcuts:** none added. Every action is reachable by pointer and Tab.
- **Styling:** colors only from tokens; every focusable control gets `focus-ring`; use `src/components/ui/` primitives before styling a `<button>` by hand.
- **Copy:** sentence case, short declarative sentences, "you".
- **Tests on this laptop:** run only the test files a task names, and `pnpm lint`. The full `pnpm test` runs once in Task 7 (CI runs it too).
- **Commits:** Conventional Commits; stage explicit paths only; one `CHANGELOG.md` line under Unreleased.

## Review Focus

1. **Long text truncates.** A long session title, agent name or folder name stays on one line with an ellipsis, and the row stays 44px. (Task 2 test.)
2. **Hide and show keeps the sidebar's state.** Folded folders, the search text and the Archived toggle survive a hide and show, so the sidebar must stay mounted while hidden. (Task 4 test.)
3. **Folded summaries count everything.** A folded folder counts forks and a compare run's members, not only top-level rows. (Task 1 test.)
4. **Busy sessions can't be deleted from the menu.** Delete and Archive are not offered while the agent works. A confirm already open turns back when the session starts working, so a stale "Delete?" never deletes a running session. (Task 2 test.)
5. **No agents in use means no Agents button.** The footer shows no Agents button when no detected agent is in use, rather than an empty menu. (Task 5 test.)

---

### Task 1: Status words and summaries

**Files:**
- Create: `src/lib/sidebar-status.ts`
- Create: `src/test/sidebar-status.test.ts`

**Interfaces:**
- Consumes: `formatRelativeTime(timestamp: number, now?: number): string` from `src/lib/relative-time.ts`; `Session` from `src/types`; `SessionNode` from `src/lib/session-helpers.ts`.
- Produces:
  - `export type RowTone = "attention" | "running" | "unread"`
  - `export interface RowStatus { tone: RowTone; label: string; pulse: boolean }`
  - `export function statusOf(isWaiting: boolean, isBusy: boolean, hasUnread: boolean): RowStatus | null`
    - Precedence: waiting, then busy, then unread.
    - Labels are exactly "Waiting for you", "Working" and "Finished, unread"; `pulse` is true only for busy.
  - `export const DOT_CLASS: Record<RowTone, string>`: `bg-status-attention`, `bg-status-running`, `bg-status-unread`.
  - `export function rowSubtitle(agentName: string | undefined, status: RowStatus | null, createdAt: number, now?: number): string`
    - Returns `"<agent> · <label>"`, or `"<agent> · <relative time>"` when idle.
    - Returns the second part alone when there is no agent name.
  - `export function sessionsIn(nodes: readonly SessionNode[]): Session[]`: every session in the tree, children included.
  - `export interface FolderSummary { text: string; tone: "attention" | "muted" }`
  - `export function folderSummary(sessions: readonly Session[], isWaiting: (id: string) => boolean, isBusy: (id: string) => boolean): FolderSummary`
  - `export function runSummary(sessions: readonly Session[], isWaiting: (id: string) => boolean, isBusy: (id: string) => boolean): string`
    - Parts in this order, each only when its count is above zero, joined by ", ": "N waiting", "N working", "N finished".
    - Finished means neither waiting nor busy.

- [ ] **Step 1: Write the failing tests** in `src/test/sidebar-status.test.ts`:
  - `it("names a status in words, waiting before working before unread")`:
    - `statusOf(true, true, true)?.label` is "Waiting for you"
    - `statusOf(false, true, true)` is `{ tone: "running", label: "Working", pulse: true }`
    - `statusOf(false, false, true)?.label` is "Finished, unread"
    - `statusOf(false, false, false)` is `null`
  - `it("puts the agent and the status on the second line")`:
    - `rowSubtitle("Claude Code", statusOf(false, true, false), 0)` is "Claude Code · Working"
    - `rowSubtitle("Codex", null, NOW - 2 * 3_600_000, NOW)` is "Codex · 2 hours ago"
    - `rowSubtitle(undefined, null, NOW, NOW)` is "Just now"
  - `it("summarises a folded folder, waiting first")`:
    - with one waiting and two busy sessions: `{ text: "1 waiting", tone: "attention" }`
    - with two busy: `{ text: "2 working", tone: "muted" }`
    - with one idle: "1 session"
    - with three idle: "3 sessions"
  - `it("counts forks and a run's members in a folded folder")`: build nodes with `forkTree` from `session-helpers` (a root, a fork of it, and a two-session run), then check that `folderSummary(sessionsIn(nodes), …)` with nothing busy reads "4 sessions".
  - `it("summarises a compare run")`:
    - two busy and one idle read "2 working, 1 finished"
    - one waiting and one busy read "1 waiting, 1 working"
- [ ] **Step 2: Run** `pnpm vitest run src/test/sidebar-status.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/sidebar-status.ts` with the signatures above.
- [ ] **Step 4: Run** `pnpm vitest run src/test/sidebar-status.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: word sidebar statuses and folder summaries`.

### Task 2: Two-line session row and its menu

**Files:**
- Create: `src/components/sidebar/SessionRow.tsx` (the row, `RenameField`, the hover actions)
- Create: `src/components/sidebar/SessionMenu.tsx` (the ⋯ menu on `Popover`, including the Delete confirm)
- Modify: `src/components/sidebar/SessionList.tsx`
  - Drop `statusOf`, `DeleteButton`, `SessionMenu`, `RenameField` and `SessionRow`.
  - Keep `SessionTree` and `SessionListContext`.
  - Import `statusOf` from Task 1.
- Create: `src/test/sidebar-helpers.ts` with `deleteFromSidebar`
- Test: rewrite `src/test/session-row.test.tsx`
  - Its "trailing slot" tests are replaced, since the dot no longer shares a slot with the actions.
  - Every test that clicks `"Delete session"` on a row moves to `deleteFromSidebar`: `acp-app.test.tsx`, `new-session.test.tsx`, `session-import.test.tsx`, `use-acp-elicitation.test.tsx`, `workspace-terminal-app.test.tsx`, `session-lifecycle.test.tsx`.
  - Tests that read the old status words get the new ones: `navigation.test.tsx`, `use-acp-elicitation.test.tsx`, `acp-app.test.tsx`, `sidebar-compare.test.tsx`, `session-lifecycle.test.tsx`. Find them with `grep -rn "Agent working\|Waiting for your answer\|New activity" src/test`.

**Interfaces:**
- Consumes:
  - from Task 1: `statusOf`, `DOT_CLASS`, `rowSubtitle`
  - `Popover`, `PopoverOption` from `src/components/ui/Popover.tsx`
  - `IconButton` from `src/components/ui/IconButton.tsx`
  - `SessionListContext` (unchanged)
- Produces:
  - `export function SessionRow(props: { node: SessionNode; context: SessionListContext; isInRun?: boolean }): JSX.Element`
  - `export function SessionMenu(props: { session: Session; label: string; isBusy: boolean; isInRun: boolean; context: SessionListContext; onRename: () => void }): JSX.Element`
  - `export async function deleteFromSidebar(rowName: RegExp | string): Promise<void>`: opens "More actions for <name>", clicks "Delete", then "Confirm delete". It uses `act` and `fireEvent` like the files it serves.
- These names are kept, so other tests keep finding them:
  - `More actions for <label>`
  - `Stop session`
  - `Confirm delete`
  - `Rename <name>`
  - the menu items Pin/Unpin and Archive/Unarchive

- [ ] **Step 1: Write the failing tests** in `src/test/session-row.test.tsx`. Render `SessionTree` with a fake `SessionListContext`.
  - `it("shows the agent and the status in words on its second line")`: a busy row has the text "Claude Code · Working" and `title` "Working".
  - `it("keeps the status dot on the left while the actions show")`:
    - the dot (`aria-hidden`, class `bg-status-running`) is not inside the element that holds the actions
    - that element has `group-hover:opacity-100` and `group-focus-within:opacity-100`
  - `it("is 44px tall and cuts long text")`:
    - the row has `h-11`
    - with a 200-character title, the title and the second line each have `truncate`
  - `it("marks a session that runs in its own worktree")`: a session with `worktree` set shows an icon with the accessible name "Runs in its own worktree".
  - `it("deletes only after the confirm in its menu")`:
    - open "More actions for <name>" and click "Delete"; the item now reads "Delete?" with `bg-danger-surface` and `text-danger`, and `onDeleteSession` has not been called
    - click "Confirm delete"; `onDeleteSession` is called once
  - `it("turns the confirm back by itself")`: with fake timers, after `CONFIRM_DELETE_MS` the item reads "Delete" again.
  - `it("offers no Delete or Archive while the agent works, and drops an open confirm when it starts")`:
    - while busy, the menu has no "Delete" and no "Archive"
    - open the confirm on an idle row, then rerender it busy: "Confirm delete" is gone
  - `it("offers Stop only while the agent works")`: there is a "Stop session" button only when busy.
- [ ] **Step 2: Run** `pnpm vitest run src/test/session-row.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Row** (`SessionRow`):
    - `group relative flex h-11 items-center gap-2 rounded-md px-2`.
    - Left: a 6px dot span `aria-hidden`, in `DOT_CLASS[tone]`, plus `motion-safe:animate-pulse` when `pulse`. An idle row keeps the slot empty so titles align.
    - Then a column with the title (`truncate text-ui`, `font-medium text-fg` when unread and not busy) and `rowSubtitle(…)` (`truncate text-caption text-fg-subtle`).
    - A `GitBranch` icon (12px) with `aria-label="Runs in its own worktree"` when `session.worktree`.
    - Right: the actions (`Stop session` `IconButton` when busy, then `SessionMenu`) in a container with `opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto`.
    - `aria-current`, row selection and rename behave as today; run members show the agent name as their label, as today.
  - **Menu** (`SessionMenu`): a `Popover` with `align="end"`.
    - Items: Rename (not in a run), Pin/Unpin (not when archived), Archive/Unarchive (not while busy), Delete (not while busy).
    - Delete turns into the confirm item in place: text "Delete?", `aria-label="Confirm delete"`, `bg-danger-surface text-danger`. The confirm turns back after `CONFIRM_DELETE_MS`.
    - The confirm state resets whenever `isBusy` becomes true or the menu closes.
- [ ] **Step 4: Update** the listed test files to `deleteFromSidebar` and the new status words. Then run `pnpm vitest run src/test/session-row.test.tsx src/test/session-lifecycle.test.tsx src/test/acp-app.test.tsx src/test/new-session.test.tsx src/test/session-import.test.tsx src/test/use-acp-elicitation.test.tsx src/test/workspace-terminal-app.test.tsx src/test/navigation.test.tsx src/test/sidebar-compare.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: two-line sidebar rows with their actions in a menu`.

### Task 3: Folder header and compare-run group row

**Files:**
- Create: `src/components/sidebar/FolderGroup.tsx` (moved out of `Sidebar.tsx`'s `WorkspaceGroup`)
- Create: `src/components/sidebar/RunGroupRow.tsx` (moved out of `SessionList.tsx`)
- Modify: `src/components/sidebar/NewSessionMenu.tsx`. It moves onto `Popover`; the props and the trigger's name stay.
- Modify: `src/components/sidebar/SessionList.tsx`, which imports `RunGroupRow`.
- Test: `src/test/navigation.test.tsx` (folder tests) and `src/test/sidebar-compare.test.tsx`

**Interfaces:**
- Consumes:
  - from Task 1: `folderSummary`, `runSummary`, `sessionsIn`, `statusOf`, `DOT_CLASS`
  - from Task 2: `SessionRow`
  - `AgentLogo` (the component the sidebar uses today)
  - `Popover`, `PopoverOption`
- Produces:
  - `export function FolderGroup(props: { group: SessionGroup; isFolded: boolean; isForcedOpen: boolean; onToggle: () => void; context: SessionListContext; agents: readonly AgentProfile[]; defaultAgentId?: string; onNewSessionIn?: (path: string, agentId: string) => void }): JSX.Element`
  - `export function RunGroupRow(props: { node: SessionNode; context: SessionListContext }): JSX.Element`
- Kept unchanged: the `data-testid="run-group-<id>"` and `aria-current` on the run row, and the list names "Sessions in <folder>" and "Forks of …".

- [ ] **Step 1: Write the failing tests:**
  - `navigation.test.tsx`
    - `it("shows a folded folder's summary in words")`:
      - fold a folder holding one waiting session: its header shows "1 waiting" with `text-status-attention`
      - unfold it: the summary is gone
    - `it("shows the folder icon, and the + and chevron on hover or focus")`: the header's + and chevron are in an element with `group-hover:opacity-100` and `group-focus-within:opacity-100`.
  - `sidebar-compare.test.tsx`
    - `it("shows a run as Compare with its agents' logos and a summary")`: the group row shows "Compare · 2 agents", two agent logos, and "1 working, 1 finished" when one member is busy.
    - `it("keeps its sessions listed under it")`: after a click on the group row, `onOpenRun` is called and the member rows are still listed.
- [ ] **Step 2: Run** `pnpm vitest run src/test/navigation.test.tsx src/test/sidebar-compare.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **Folder header:** a `Folder` icon (14px), the name (`truncate`), then on the right:
    - while folded and not searching, the `folderSummary` text (`text-caption`, `text-status-attention` when the tone is attention, else `text-fg-subtle`)
    - the hover/focus + (`NewSessionMenu`) and the chevron
  - **Run row:** two lines like a session row.
    - Line 1: the run's agent logos stacked (`-space-x-1`, each with a `ring-1 ring-surface-1`, at most `MAX_COMPARE_AGENTS`) and "Compare · N agents".
    - Line 2: `runSummary`.
    - The aggregated dot sits on the left.
- [ ] **Step 4: Run** the command from Step 2. Expected: PASS.
- [ ] **Step 5: Commit** `feat: folder summaries and a compare group row in the sidebar`.

### Task 4: Sidebar shell, order and hiding

**Files:**
- Modify: `src/components/Sidebar.tsx`
  - The new order of sections.
  - **New session** becomes an outline `Button` with a `Plus` icon.
  - **Search sessions** gets that placeholder and aria-label.
  - **Hide sidebar** (`PanelLeft` `IconButton`) goes in the top row.
  - `DetectedAgents`, `SignInChip` and the `settings`, `signInStateOf`, `onSetUpAgent` props leave it.
  - `WorkspaceGroup` is replaced by `FolderGroup`.
- Modify: `src/App.tsx`
  - `const [isSidebarHidden, setSidebarHidden] = useState(false)`.
  - Pass `isHidden` and `onHide` to `Sidebar`, and `onShowSidebar` to `TopBar`.
- Modify: `src/components/TopBar.tsx`: `onShowSidebar?: () => void` shows a **Show sidebar** `IconButton` (`PanelLeft`) first on the left while it is set.
- Test: `src/test/navigation.test.tsx`; the `"+ New session"`, `/\+ new/i` and `"Search workspaces and sessions"` queries move to the new names. Find them with `grep -rln '+ New session\|\\\\+ new\|Search workspaces and sessions' src/test`.

**Interfaces:**
- Consumes: Tasks 2–3 components; `Button`, `IconButton`.
- Produces: `SidebarProps` without `settings`, `signInStateOf` and `onSetUpAgent`, and with `isHidden?: boolean; onHide?: () => void`. The New session button's accessible name becomes "New session", and the search field's becomes "Search sessions".

- [ ] **Step 1: Write the failing tests** in `navigation.test.tsx`:
  - `it("lays the sidebar out from New session down to Archived")`: in document order, the controls are "Hide sidebar", "New session", "Search sessions", the "Pinned sessions" list, the "Workspaces" list, then "Archived (N)".
  - `it("hides and shows again, keeping folds and the search")` (in App):
    1. fold a folder and type in Search sessions
    2. click "Hide sidebar": the `aside` is not visible (`hidden`), and "Show sidebar" appears in the top bar
    3. click it: the folder is still folded and the search text is still there
  - Delete the detected-agents tests here; Task 5 brings them back in the Agents menu.
- [ ] **Step 2: Run** `pnpm vitest run src/test/navigation.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The hidden sidebar stays mounted (`hidden` on the `aside`), so its local state survives.
- [ ] **Step 4: Update** the queries in the files the grep lists. Then run `pnpm lint` and `pnpm vitest run` with those files plus `src/test/navigation.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sidebar order and a hide button`.

### Task 5: Agents menu in the footer

**Files:**
- Create: `src/components/sidebar/AgentsMenu.tsx`. It takes the old `SignInChip`, moved from `Sidebar.tsx` with its wording and labels unchanged.
- Modify: `src/components/ProfileFooter.tsx`
  - Add an `agents?: ReactNode` slot, rendered before Settings.
  - The Settings icon becomes `SlidersHorizontal`.
- Modify: `src/App.tsx`
  - Build `<AgentsMenu …/>` into `ProfileFooter`'s `agents` slot.
  - `onManageAgents={() => setSettingsTab("agents")}`.
  - The old `onSetUpAgent` handler moves here unchanged.
- Test: `src/test/agents-menu.test.tsx` (new). Move `agent-sign-in-status.test.tsx`'s "Sidebar sign-in chips" and `acp-sign-in.test.tsx:356`/`:403` to open the Agents menu first.

**Interfaces:**
- Consumes: `isInUse`, `EnabledSettings` from `lib/enabled-agents`; `SignInState` from `lib/agent-sign-in.ts`; `AgentLogo`; `Popover`.
- Produces: `export function AgentsMenu(props: { agents: readonly AgentProfile[]; settings?: EnabledSettings; signInStateOf?: (profileId: string) => SignInState; onSetUpAgent?: (profileId: string) => void; onManageAgents: () => void }): JSX.Element | null`
  - The list is `agents.filter(a => a.detected && isInUse(a, settings))`, as today.
  - The trigger is named "Agents", or "Agents, sign-in needed" when any listed agent's state is `needed`.
  - The panel is a `Popover` with `role="dialog"` and `label="Agents in use"`.

- [ ] **Step 1: Write the failing tests** in `src/test/agents-menu.test.tsx`:
  - `it("shows up to three logos and an attention dot when an agent needs sign-in")`:
    - with four agents in use, the trigger holds three logos
    - with one in `needed` state, it is named "Agents, sign-in needed" and holds a `bg-status-attention` dot
  - `it("lists the agents in use with their sign-in state")`:
    - open it: the dialog "Agents in use" lists each in-use detected agent
    - the chips read "Ready", or are a "Sign in to <Agent>" or "Check <Agent>" button, as today
  - `it("opens Settings → Agents from Manage agents")`: clicking "Manage agents" calls `onManageAgents` and closes the menu.
  - `it("renders nothing when no agent is in use")`: no "Agents" button.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agents-menu.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with the interfaces above.
- [ ] **Step 4: Move** the sign-in chip tests in `agent-sign-in-status.test.tsx` and `acp-sign-in.test.tsx` to open "Agents" first. Then run `pnpm vitest run src/test/agents-menu.test.tsx src/test/agent-sign-in-status.test.tsx src/test/acp-sign-in.test.tsx src/test/profile-footer.test.tsx src/test/agent-updates.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: agents menu in the sidebar footer`.

### Task 6: Docs and changelog

**Files:**
- Modify: `docs/design-system/components/SessionRow/README.md` and `preview.html`. Show the two-line row: a working row, a waiting row, an idle row with "2 hours ago", the hover actions, and a folded folder with "1 waiting".
- Modify: `CHANGELOG.md`, adding one line under Unreleased / Changed.
- Test: `src/test/design-system-docs.test.ts`

- [ ] **Step 1: Update** the README and preview. The preview may use only variables that `tokens.json` defines.
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: two-line session rows in the design system`.

### Task 7: Check the phase

- [ ] **Step 1:** Run `pnpm lint`, then `pnpm test` once. Expected: PASS.
- [ ] **Step 2:** Review the branch diff before pushing.
- [ ] **Step 3:** After merge, republish the changed `docs/design-system/` files to the Zorvo Design System artifact, index last.
