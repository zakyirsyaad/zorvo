# Redesign v2, phase 2: sidebar and top bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sidebar its v2 rows (agent tile with a status badge, time at the right), its filter and its folded search, and give the top bar its `folder / title` breadcrumb and 28px chips.

**Architecture:** The row's new facts are pure functions: a short time format in `lib/relative-time.ts` and the filter's predicate and counts in `lib/sidebar-status.ts`. `Sidebar.tsx` owns two new pieces of state (the filter, and whether the search field is open) and passes the same tree through one more predicate. The top bar gets three optional props and no new state. No hook, session logic or Tauri command changes.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, sections "Sidebar" and "Top bar". Artboards in `docs/superpowers/specs/2026-11-11-redesign-v2-artboards/`: `Sidebar.dc.html`, `SidebarStates.dc.html`, `TopBar.dc.html`, `TopBarPopovers.dc.html`, and the sidebar of `Main.dc.html`. Read them before Task 1. Phase 1 (PR 186) is merged: `AgentTile`, `segmented-style`, `ground`, `sheet`, `chip` and `rounded-panel` exist.

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. Letter tiles in the artboards stand for the real `AgentLogo`.
- Copy and `aria-label`s stay as they are in the app, except these new strings, exactly: "All", "Needs you", "Working", "No sessions need you.", "No sessions are working.", "Close search".
- A function the artboards do not draw stays: the Stop and More row actions, Rename, the "Delete?" confirm, Pinned, Archived, the folder's New session menu and fold button, the PR chip's checks mark, the diff chip's comment count, Back and Forward, the Delegate items of the More menu.
- 30px in an artboard means today's 28px control. No new `Button` or `IconButton` size: row actions stay `IconButton` `size="sm"` (24px) although the artboard draws 22px.
- "Needs you" means: waiting for you, or finished unread. "Working" means busy; the members of a compare run count one each.
- No keyboard shortcuts are added. Every new control is a real button with `focus-ring`.
- No raw colors; `sheet-fills.test.ts` must keep passing.
- Run targeted Vitest files, not the whole suite. Nothing under `src-tauri/**` changes, so no cargo.
- Stage explicit paths, never `git add -A`. Conventional Commits, no `Co-Authored-By` trailer.

## Review Focus

1. **A filter that hides the session on screen.** With "Working" pressed, the open session may not match and its row vanishes while its chat stays. The row list may hide it; the selection must not change. Task 4 tests it.
2. **A status that changes while a filter is on.** A session that finishes leaves "Working" and joins "Needs you" on the next render, with no stale count. Task 2 tests the counts as pure functions of the same inputs the rows use.
3. **Search and filter together.** Both narrow the tree; a fork stays under a matching parent in both. Task 4 tests a query inside a filter.
4. **The search field closes with text in it.** Closing clears the query, or the list would stay narrowed with no visible reason. Task 4 tests Escape and the X.
5. **A long folder name or title in the breadcrumb.** The title must keep its minimum width and the folder must give way first. Task 6 tests the shrink classes.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/lib/relative-time.ts` | modify | `formatShortTime` |
| `src/lib/sidebar-status.ts` | modify | `SidebarFilter`, `needsYou`, `matchesFilter`, `filterCounts`, `rowTime` |
| `src/components/ui/AgentTile.tsx` | modify | `badgeClassName` |
| `src/components/sidebar/SessionRow.tsx` | modify | Tile, two lines, time at the right |
| `src/components/sidebar/RunGroupRow.tsx` | modify | Titled by the task, columns tile, no stacked logos |
| `src/components/sidebar/FolderGroup.tsx`, `SessionList.tsx` | modify | Session count; the fork rail's offsets |
| `src/components/sidebar/SidebarFilter.tsx`, `SidebarSearch.tsx` | create | The three toggle buttons; the New session row that turns into the search field |
| `src/components/Sidebar.tsx` | modify | Filter and search state, the second predicate, empty lines |
| `src/components/sidebar/AgentsMenu.tsx`, `src/components/ProfileFooter.tsx` | modify | 16px tiles; menu rows with tile and sign-in word |
| `src/components/TopBar.tsx`, `src/components/ui/Chip.tsx` | modify | Breadcrumb, paddings, 28px chips |
| `src/App.tsx`, `src/components/PopoutApp.tsx` | modify | Pass `folderName`, `runAgentCount`, `isDraft` |
| `docs/design-system/components/SessionRow/*`, `TopBar/*`, `CHANGELOG.md` | modify | Docs in step |

---

### Task 1: Short time

**Files:** Modify `src/lib/relative-time.ts`; test `src/test/relative-time.test.ts` (create it if the file has no test yet).

**Interfaces:** Produces `formatShortTime(timestamp: number, now?: number): string`.

- [ ] **Step 1: Failing tests.** With `now` = 2026-11-13 12:00 local:

```ts
expect(formatShortTime(now - 20_000, now)).toBe("now");
expect(formatShortTime(now - 5 * 60_000, now)).toBe("5 min ago");
expect(formatShortTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
expect(formatShortTime(new Date(2026, 10, 12, 23, 0).getTime(), now)).toBe("Yesterday");
expect(formatShortTime(new Date(2026, 9, 28, 9, 0).getTime(), now)).toBe("Oct 28");
expect(formatShortTime(new Date(2025, 9, 28, 9, 0).getTime(), now)).toBe("Oct 28, 2025");
expect(formatShortTime(now + 60_000, now)).toBe("now"); // a clock that ran ahead
```

- [ ] **Step 2:** Run `pnpm vitest run src/test/relative-time.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Under a minute (or in the future) "now"; under an hour "N min ago"; the same calendar day "N h ago"; the calendar day before "Yesterday"; the same year "Mon D"; else "Mon D, YYYY". Month names from `Intl.DateTimeFormat("en-US", { month: "short" })`. A session from 23:00 yesterday reads "Yesterday", not "13 h ago".
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add a short time format for sidebar rows` (`git add src/lib/relative-time.ts src/test/relative-time.test.ts`).

### Task 2: Filter predicates and the row's time

**Files:** Modify `src/lib/sidebar-status.ts`; test `src/test/sidebar-status.test.ts`.

**Interfaces:**

```ts
export type SidebarFilter = "all" | "needs-you" | "working";
/** Waiting for you, or finished while you were elsewhere. */
export function needsYou(session: Session, isWaiting: IsTrue, isBusy: IsTrue): boolean;
export function matchesFilter(session: Session, filter: SidebarFilter, isWaiting: IsTrue, isBusy: IsTrue): boolean;
/** Counts over the sessions the sidebar lists (not archived); a run's members count one each. */
export function filterCounts(sessions: readonly Session[], isWaiting: IsTrue, isBusy: IsTrue): { needsYou: number; working: number };
/** The time an idle row shows at its right; null for a row with a status, whose words say more. */
export function rowTime(status: RowStatus | null, createdAt: number, now?: number): string | null;
```

`needsYou` is `isWaiting(id) || (Boolean(hasUnread) && !isBusy(id))`, the same rule `SessionRow` uses for `isUnread`. `rowDetail` and `rowSubtitle` do not change (the tooltip still reads the long form).

- [ ] **Step 1: Failing tests:** a waiting session and an unread idle one both need you; an unread session that is busy does not, and is working; `filterCounts` over one waiting, one unread, two busy and one idle gives `{ needsYou: 2, working: 2 }`; `matchesFilter(_, "all", …)` is always true; `rowTime` is null for any status and `formatShortTime`'s text for none.
- [ ] **Step 2:** Run `pnpm vitest run src/test/sidebar-status.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the sidebar's filter predicates and counts`.

### Task 3: The session row and the compare row

**Files:** Modify `src/components/ui/AgentTile.tsx`, `src/components/sidebar/SessionRow.tsx`, `RunGroupRow.tsx`, `SessionList.tsx:34`; tests `src/test/agent-tile.test.tsx`, `session-row.test.tsx`, `sidebar-compare.test.tsx`.

**Interfaces:** `AgentTileProps` gains `badgeClassName?: string`, appended to the badge's classes.

- [ ] **Step 1: Failing tests.**
  - `agent-tile`: `badgeClassName="group-hover:ring-surface-hover"` lands on the `[data-badge]` span.
  - `session-row`: replace the tests that pin the old anatomy (logo before the agent's name at `:73`, the dot at `:111`, the renaming row's dot at `:210`) with:
    - the row's first child is a 22px tile (`size-[22px]`) holding the agent's logo, and no logo sits in line two;
    - a waiting row's tile has a badge with `bg-status-attention`; a working row `bg-status-running`; an unread idle row `bg-status-unread`; an idle row none;
    - the active row's badge has `ring-surface-hover`; another row's has `ring-ground` and `group-hover:ring-surface-hover`;
    - an idle row shows `formatShortTime` of its `createdAt` in an element with `text-caption text-fg-subtle shrink-0`, and its second line is the agent's name alone;
    - a row with a status shows no time, and its second line is "Agent · Status words";
    - the worktree mark is still first in line two; "· fork" and "· delegated" still end it;
    - the row's button has `rounded-lg px-2 py-[7px] gap-2.5`;
    - while renaming, the tile and its badge stay.
  - `sidebar-compare` (`:173`): the run row's first line is the run's name; its second line is "Compare · " plus the summary; its accessible name and tooltip still hold "Compare · N agents"; the row holds exactly one tile, with a `Columns3` icon, and no member logos.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `SessionRow`: the dot span becomes `<AgentTile profileId={session.profileId} name="" badge={status?.tone} badgeOn={isActive ? "hover" : "ground"} badgeClassName="group-hover:ring-surface-hover" className="mt-px" />`. Line one is a flex row: the title (`truncate`, `flex-1`) and, when `rowTime` is not null, the time. Line two: the worktree mark, the agent's name (not for a run member, as today), then ` · ` plus the status words when there is a status, then the origin suffix. The `AgentLogo` leaves line two. `RowStatus.pulse` is no longer read here.
  - `RunGroupRow`: the dot becomes an `AgentTile` with `<Columns3 size={12} />` as its child and the run's badge; line one `run.name`; line two `Compare · ${summary}`; delete the stacked logos. `aria-label` and `title` stay as they are.
  - `SessionList.tsx:34`: the fork rail becomes `ml-[18px] pl-2 border-l border-border`.
- [ ] **Step 4:** Run. Expected: PASS. Then `pnpm vitest run src/test/navigation.test.tsx src/test/sheet-fills.test.ts` and fix only assertions about this task's classes.
- [ ] **Step 5: Commit** `feat: show the agent tile, its status badge and the time in sidebar rows`.

### Task 4: Search, filter and the folder count

**Files:** Create `src/components/sidebar/SidebarFilter.tsx`, `SidebarSearch.tsx`; modify `src/components/Sidebar.tsx:123–203`, `sidebar/FolderGroup.tsx`; tests `src/test/sidebar-filter.test.tsx` (new), `navigation.test.tsx:185–232` and `:553–556`, `sidebar-compare.test.tsx:202–210`.

**Interfaces:**

```ts
// SidebarFilter.tsx
export function SidebarFilter(props: { value: SidebarFilter; counts: { needsYou: number; working: number }; onChange: (next: SidebarFilter) => void }): JSX.Element
// SidebarSearch.tsx: the New session row, or the search field in its place
export function SidebarSearch(props: { query: string; onQueryChange: (next: string) => void; onNewSession: () => void }): JSX.Element
```

Values. `SidebarSearch` closed: a row `flex gap-1.5`, with **New session** (`h-8 flex-1`, `bg-surface-2`, `border border-border`, `rounded-lg`, weight 500, a 14px plus) and a 32px **Search sessions** icon button of the same fill and edge. Open: one field in the row's place, `h-8 rounded-lg bg-surface-2 border border-border`, a 13px search icon, the input (`aria-label="Search sessions"`, placeholder "Search sessions"), and a **Close search** icon button. `SidebarFilter`: `role="group"` named "Filter sessions", three buttons with `aria-pressed`, classed by `segmentedItem(isPressed)` from `ui/segmented-style` at `h-6.5`, with no track; "Needs you" shows its count in `text-status-attention font-semibold` and "Working" its count in `text-fg-subtle`, each only when above zero.

- [ ] **Step 1: Failing tests** (`sidebar-filter.test.tsx`, rendering `Sidebar` as `navigation.test.tsx` does):
  - Search: only New session and the Search sessions button show at first; pressing Search shows the field, focused, and hides New session; typing narrows the list as before; Escape closes the field, clears the query and returns focus to the Search sessions button; so does Close search.
  - Filter: "All" is pressed at first; with one waiting, one unread and two working sessions the buttons read "Needs you 2" and "Working 2"; pressing "Needs you" leaves only those two rows and hides folders with no match; pressing it again, or "All", shows everything.
  - Pinned rows are filtered like the rest; the Archived section shows only under "All".
  - A fork stays under its matching parent.
  - With "Working" pressed and nothing working: "No sessions are working."; with "Needs you" and nothing: "No sessions need you."
  - A query inside a filter narrows further.
  - Review Focus 1: with "Working" pressed and the open session idle, `onSelectSession` is not called and the top of the list does not select another row.
  - Folder header: an open folder shows its session count (`sessionsIn(group.sessions).length`) in `text-fg-subtle`, before the New session menu.
  Update the old assertions in `navigation.test.tsx` and `sidebar-compare.test.tsx` that type into an always-present textbox: press Search sessions first.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** `Sidebar` keeps `filter` state beside `searchQuery`. Generalise `nodeMatches`/`filterNodes`/`searchGroups` to take a predicate over a node, and apply the filter predicate (`matchesFilter` on a session node; a run node matches when any member does) before the query. The counts come from `filterCounts` over the listed, non-archived sessions, before any narrowing. The header row loses nothing; the old New session button and the always-visible input are replaced by `SidebarSearch`, then `SidebarFilter` under it (`px-3 pb-1`).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the sidebar's filter and fold search into a button`.

### Task 5: The footer's Agents button and menu

**Files:** Modify `src/components/sidebar/AgentsMenu.tsx`, `src/components/ProfileFooter.tsx`; test `src/test/profile-footer.test.tsx` and the Agents menu's tests (find them with `grep -rl "Agents in use" src/test`).

- [ ] **Step 1: Failing tests:** the Agents button stacks `AgentTile`s of size 16 (`size-4`), at most three, overlapping by 4px, and keeps its attention dot and accessible name; in the menu each agent row is 28px with a 16px tile, the name, and the sign-in word with a 6px dot beside it (`bg-status-running` for Ready, `bg-status-attention` for Sign in, none for Not checked); the Sign in button and "Manage agents" stay.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `AgentTile`; the backing spans from phase 1 (`bg-ground ring-2 ring-ground`) go.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: use agent tiles in the sidebar footer and its menu`.

### Task 6: The top bar

**Files:** Modify `src/components/TopBar.tsx`, `src/components/ui/Chip.tsx`, `src/App.tsx` (the `<TopBar>` call), `src/components/PopoutApp.tsx`; test `src/test/top-bar.test.tsx`, `chrome-wiring.test.tsx`, `popout.test.tsx`.

**Interfaces:** `TopBarProps` gains

```ts
/** The folder the session, run or draft works in; shown before the title. */
folderName?: string;
/** Set for a compare run: the bar adds "Compare · N agents". */
runAgentCount?: number;
/** A new-session draft: the title reads "New session" and no branch chip shows. */
isDraft?: boolean;
```

- [ ] **Step 1: Failing tests.**
  - A session: the bar reads folder, a slash, the title, in that order; the folder has `text-fg-muted shrink-[3] truncate`, the slash is `aria-hidden` with `text-fg-subtle`, the title keeps `min-w-12 font-semibold text-fg`. Replace the two tests that forbid a folder (`top-bar.test.tsx:303` and `:321`).
  - No `folderName`: no slash, the title alone.
  - A draft (`isDraft` with `folderName`): "folder / New session", and no branch chip even when `branch` is given.
  - A run (`runAgentCount={3}`): after the title, "Compare · 3 agents" with a `Columns3` icon in `text-fg-muted`.
  - The header has `pl-[18px] pr-2.5 gap-2.5`.
  - The Plan, background-task and diff chips have `h-7 text-ui-sm px-2.5 rounded-md`; open, `bg-surface-hover border-border-strong`. The branch and PR chips stay plain and 24px.
  - The hidden-sidebar inset stays 78px; "Inspector" and "More options" keep their names.
  - `chrome-wiring`: a session in a worktree shows its repository's folder name; a compare run shows the folder of its first session, not the last chosen workspace.
  - `popout`: the popout's bar shows the session's folder.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** In `Chip.tsx` add the 28px size the three outline chips take (read the file first: add a `size` option if it has none, named `bar`, and leave every other user of `Chip` as it is). In `App.tsx` pass `folderName` (`folderNameOf(workspacePathOf(activeSession))`; for a run, of `run.sessions[0]`; for a draft, the draft's folder), `runAgentCount` and `isDraft`. `workspaceName` stays for the no-session, no-draft bar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show the folder before the title in the top bar`.

### Task 7: Docs and the whole-branch check

- [ ] **Step 1: Docs.** `docs/design-system/components/SessionRow/README.md` and `preview.html`: the tile and badge, the time at the right, the filter, the folded search, the compare row titled by its task. `components/TopBar/README.md` and `preview.html`: the breadcrumb and the 28px chips. `CHANGELOG.md`, Unreleased → Changed: "Sidebar rows show each agent's logo with a status badge, and a filter shows only the sessions that need you or are working." and "The top bar shows the folder before the session's title."
- [ ] **Step 2:** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts src/test/sheet-fills.test.ts`. Expected: PASS.
- [ ] **Step 3:** `pnpm lint`. Expected: clean.
- [ ] **Step 4: Self-review** with `/code-review --fix`, then push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60" git push -u origin <branch>` and open the pull request. Its body lists what was not checked in the running app.
- [ ] **Step 5: The app beside the artboards** is the orchestrator's step, after the push: a debug bundle with its own identifier, as the phase 1 check did. It covers both themes against `Sidebar.dc.html`, `SidebarStates.dc.html` and `TopBar.dc.html`; a row of each status; the filter with a status changing under it; the search field's open, Escape and X; a long title beside a long folder name; the hidden-sidebar bar and a popout.
