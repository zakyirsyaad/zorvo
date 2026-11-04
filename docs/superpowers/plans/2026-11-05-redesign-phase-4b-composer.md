# Redesign phase 4b: composer, its menus and the draft pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the composer as the spec's floating card (thumbnails, an overflow ⋯ menu, Stop as outline, "38% of context"). Move its menus onto the one popover style. Give the new-session draft its centered layout, with folder, branch and agent chips above the composer.

**Architecture:**
- Every menu builds on `ui/Popover`, with two small additions: a listbox group inside a dialog, and radio items in a menu.
- The composer stays one `ComposerDock` in one place in `App`'s tree. The draft's chips render inside `ComposerDock`, above its card. The draft's title and its "Continue a session" list sit before and after the composer's slot. Nothing re-parents the composer, so its text survives every switch.
- Which controls overflow into ⋯ is a pure function of their count, not a measurement.

**Tech Stack:** React 19, Tailwind 4 tokens from `src/styles/globals.css`, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, in two sections:
- "Chat and composer": **Composer** and **New-session draft**.
- "Menus, pickers, full diff review and small states": **One popover style**, **Composer menus** and **Draft pickers**.

Phase 4a (PR #140) did the messages, tool rows, cards and turn status.

## Global Constraints

- **Type tokens only.** `text-body` (14/22) is for the prompt. `text-ui-sm` (12px) is for composer chips and menu rows. `text-caption` (11px) is for hints, headers, footers and paths. Files this plan touches get no `text-xs`, `text-sm` or `text-[11px]`.
- **Primitives and focus.** No raw colors (`design-tokens.test.ts`). Every focusable control gets `focus-ring`. Use `Button` / `IconButton` before styling a `<button>` by hand.
- **One popover style.** That is `ui/Popover`'s `PANEL` and `PopoverOption`:
  - `surface-3`, `border`, `shadow-popover`, radius 8, 6px padding;
  - rows at least 30px tall with radius 4;
  - a `fg-muted` header line where a group needs one;
  - the selected option checked, on `surface-hover`.
- **Chips.** 24px tall, `radius-md` (6px), bordered, since they are clickable (spec "Chip").
- **One `ComposerDock`.** It is mounted once, at the same place in `App`'s tree, for drafts and sessions alike. Its text and attachments must survive switching sessions and the draft turning into a session (CLAUDE.md "Messages that did not reach the agent", "Diff comments").
- **Unchanged behavior:**
  - `composerNote` outranks a slash hint.
  - A blocked Send is `aria-describedby` the note.
  - `/` and `@` keep focus in the prompt (mousedown, not click).
  - A list over 10 choices gets a search field, and Enter in a search picks the first match.
  - `MAX_COMPARE_AGENTS` stays the limit.
  - An agent that needs an install or a sign-in cannot be ticked.
- **Copy.** Sentence case, the user is "you", agents by name. Exact strings in this plan are the spec's.
- **No keyboard shortcuts** are added.
- **Test runs.** Run each task's targeted test files while working on it. Run the full suite once, at the end (`light-local-checks`).

## Decisions taken here (the spec leaves them open)

- **Which controls go into ⋯.** The spec says "controls that do not fit go into ⋯". This plan makes that a count: at most `MAX_INLINE_CONTROLS = 3` agent controls inline, in the order model, mode, effort, then the agent's extras. The rest go into ⋯. Measuring the row would depend on layout jsdom cannot see. A count also never reshuffles chips while the window is resized.
- **The search footer** reads "N of M <label>s". The plural is the lowercased label plus "s", unless the label already ends in "s" (`models`, `efforts`).
- **The risky mode's words.** "Lets the agent act without asking" becomes a visible line under the option, in the attention color, next to its `ShieldAlert`. The composer chip's own icon stays `text-danger`, since the spec names only the menu.
- **The draft drops `WorkspaceSummary`.** The folder and branch chips now say where the session runs. `WorkspaceSummary` stays where `App.tsx:1055` still uses it.
- **The compare note** becomes "Each agent starts in its safest mode, in its own worktree, and uses its own quota." That is the spec's wording plus the quota line the current note already carries.

## Review Focus

1. **The composer keeps its text when the draft becomes a session**, and when the user switches sessions. The new layout must not re-parent or re-key `ComposerDock`. Task 7's test pins this.
2. **Overflowed controls stay usable from the keyboard.** Tab reaches ⋯ and Return opens it. A pick sends `onChange` and closes the menu. Escape gives focus back to ⋯ (Task 5).
3. **A long branch, folder or model name never widens the row** past the 680px column. Chips truncate, and the full name is in `title` (Tasks 2 and 6).
4. **The draft still explains itself under the title.** With no agent ready it says why (`unavailableReason`). With no folder it says to open one (Task 7).
5. **Mentions and commands keep their keys.** ↑ ↓ wrap, Return or Tab picks, Escape closes, and the prompt keeps focus. Only the markup and the headers change (Task 3).

---

### Task 1: Popover additions and match highlighting

**Files:**
- Modify: `src/components/ui/Popover.tsx`
- Create: `src/lib/match-segments.ts`, `src/components/ui/Highlighted.tsx`
- Test: `src/test/ui-primitives.test.tsx`, `src/test/match-segments.test.ts`

**Interfaces:**
- Produces:
  - `PopoverList({ label: string; children: ReactNode })` renders a `<div role="listbox" aria-label={label}>` and sets the role context to `listbox`. Its `PopoverOption`s are then `role="option"`, inside a `role="dialog"` popover that also holds a search field.
  - `PopoverOption` gains `isRadio?: boolean`. Inside a menu it becomes `role="menuitemradio"` with `aria-checked={selected}`. Its `description` widens to `ReactNode`.
  - `export const POPOVER_PANEL_STYLE` is the panel's look (border, surface, shadow, radius, padding) without positioning. It is for the `/` and `@` menus, which cannot be a `Popover`.
  - `matchSegments(text: string, query: string): { text: string; isMatch: boolean }[]` is case-insensitive and finds every occurrence. An empty query gives one unmatched segment.
  - `Highlighted({ text, query })` renders the segments, with matches as `<mark>` styled `bg-transparent font-semibold text-fg`.

- [ ] **Step 1: Write the failing tests.**
  - `matchSegments("ReadMe.md", "me")` → `[{text:"Read",isMatch:false},{text:"Me",isMatch:true},{text:".md",isMatch:false}]`.
  - `matchSegments("aaa", "a")` gives three matched segments.
  - `matchSegments("x", "")` → `[{text:"x",isMatch:false}]`.
  - In `ui-primitives.test.tsx`, a menu with `<PopoverOption isRadio selected>` gives `getByRole("menuitemradio", { checked: true })`.
  - A dialog popover holding `<PopoverList label="Models">` gives `getByRole("listbox", { name: "Models" })`, whose children are `role="option"`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/match-segments.test.ts src/test/ui-primitives.test.tsx`. Expected: FAIL, because `matchSegments` and `PopoverList` are not exported.
- [ ] **Step 3:** Implement. `matchSegments` uses `indexOf` on the lowercased text in a loop, never a regex, so a query with `(` or `*` cannot throw.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: popover lists, radio items and match highlighting`.

### Task 2: Composer chip style and OptionDropdown on the popover

**Files:**
- Create: `src/components/composer/chip-style.ts`
- Modify: `src/components/composer/OptionDropdown.tsx`
- Test: `src/test/option-dropdown.test.tsx`, `src/test/composer-dropdown-renders.test.tsx`

**Interfaces:**
- Consumes: Task 1's `Popover`, `PopoverList`, `PopoverOption` and `Highlighted`.
- Produces:
  - `COMPOSER_CHIP = "focus-ring inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"`, used by every composer and draft chip.
  - `RISKY_LINE = "Lets the agent act without asking"`.
  - `pluralOf(label: string): string`.
  - `OptionDropdown`'s props are unchanged.

- [ ] **Step 1: Write the failing tests** in `option-dropdown.test.tsx`.
  - Open a 12-option list. The search field is named "Search model". Typing "son" bolds "son" in each match (`container.querySelectorAll("mark")` text is "son"). The footer reads "3 of 12 models".
  - With a risky option, the open menu shows the text "Lets the agent act without asking" and an `aria-hidden` `ShieldAlert`. The line's class has `text-status-attention`.
  - The selected option is `aria-selected="true"` and shows the check.
  - The chip has `h-6` and `text-ui-sm`, and its `title` holds the full value.
  - Keep the existing tests: Enter picks the first match, the "[Provider]" chip label, and focus goes back to the chip after a search menu closes (now `Popover`'s job). Change their queries only where the markup moved.
- [ ] **Step 2:** Run `pnpm vitest run src/test/option-dropdown.test.tsx src/test/composer-dropdown-renders.test.tsx`. Expected: FAIL on the footer, the risky line and the chip classes.
- [ ] **Step 3:** Rebuild `OptionDropdown`.
  - The chip is a `<button className={COMPOSER_CHIP}>` with the same aria attributes.
  - It sits inside `Popover` with `side="top"`, `align` mapped `left→start` and `right→end`, `isOpen`, and `onClose={onToggle}`.
  - Without a search field, the popover's role is `listbox` and the options are `PopoverOption`.
  - With a search field, the role is `dialog`, holding the search input, then `PopoverList`, then a caption footer.
  - Drop `OptionList`'s own focus-return cleanup, since `Popover` returns focus.
  - Keep `max-h-72 overflow-y-auto` on the list and `max-w-80` on the panel.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: composer menus in the one popover style`.

### Task 3: Slash and mention menus

**Files:**
- Modify:
  - `src/components/composer/SlashCommandMenu.tsx`
  - `src/components/composer/MentionMenu.tsx`
  - `src/components/ComposerDock.tsx`
  - `src/App.tsx` and `src/components/PopoutApp.tsx` (both pass `agentName`)
- Test: `src/test/composer-slash.test.tsx`, `src/test/composer-mentions.test.tsx`

**Interfaces:**
- Consumes: `POPOVER_PANEL_STYLE`, `Highlighted`.
- Produces:
  - `ComposerDockProps.agentName?: string`, the agent's name for the `/` header.
  - `SlashCommandMenu` gains `agentName?: string`.
  - `MentionMenu` gains `folderName: string` and `query: string`.

- [ ] **Step 1: Write the failing tests.**
  - Typing `/` with `agentName="Codex"` shows the header "Commands from Codex" above the `listbox` named "Slash commands". Without `agentName`, the header reads "Commands".
  - Typing `@rea` with the mention root `/w/agent-desktop` shows "Files in agent-desktop". The option for `docs/README.md` shows the name `README.md` with "REA" in a `<mark>`, and the folder `docs` on a separate line.
  - The existing key tests stay unchanged: ↑ ↓ wrap, Return, Tab, Escape, and the prompt keeps focus.
- [ ] **Step 2:** Run `pnpm vitest run src/test/composer-slash.test.tsx src/test/composer-mentions.test.tsx`. Expected: FAIL on the headers.
- [ ] **Step 3:** Implement.
  - Each menu is a `<div className={\`absolute bottom-full left-0 mb-2 w-full ${POPOVER_PANEL_STYLE}\`}>`. It holds a header `<p className="px-2 pt-1 pb-1.5 text-caption font-medium text-fg-muted">`, then the `ul role="listbox"`, which keeps its `aria-label`.
  - Rows are `min-h-7.5 rounded px-2 py-1 text-ui-sm`.
  - Command names are in mono. Descriptions are `text-fg-muted` and truncated.
  - Mention rows have two lines: the name in mono with `Highlighted`, then the folder in `text-caption text-fg-muted`. A file at the root has no folder line.
  - `ComposerDock` passes `mentionMenu.mention?.query ?? ""` and the root's last path segment.
  - `App` passes `activeAgent?.name` for a session and `newSessionAgent?.name` for a draft. `PopoutApp` passes its session's agent name.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: slash and mention menus with their headers`.

### Task 4: The composer card

**Files:**
- Modify: `src/components/ComposerDock.tsx`, `src/components/composer/AttachmentChips.tsx`, `src/components/composer/ContextMeter.tsx`, `src/components/ui/IconButton.tsx`
- Test: `src/test/composer-dock.test.tsx`, `src/test/composer-attachments.test.tsx`, `src/test/context-meter.test.tsx`, `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `IconButton` gets an `"outline"` variant: `rounded-lg border border-border-strong text-fg enabled:hover:bg-surface-hover disabled:opacity-40`.
  - `ComposerDockProps.sendLabel?: string`. When it is set, Send is a text `Button variant="primary"` showing that label, instead of the icon. It keeps the same `aria-describedby` and disabled rules, and its text is its name.

- [ ] **Step 1: Write the failing tests.**
  - In `composer-dock.test.tsx`:
    - While `isThinking` with `onStop`, "Stop agent" has `border` and no `bg-primary`.
    - With `sendLabel="Start 2 sessions"`, a button named "Start 2 sessions" sends the prompt on click, and there is no "Send message" button.
    - The prompt has `text-body`, and the note has `text-caption`.
  - In `composer-attachments.test.tsx`, a ready image preview renders an `img` with `h-16 w-24`, and its remove button is named "Remove shot.png".
  - In `context-meter.test.tsx`:
    - `used 38, size 100` shows the text "38% of context".
    - The meter keeps `role="meter"` and `aria-valuenow=38`.
    - With an unknown size it still shows "N tokens".
- [ ] **Step 2:** Run `pnpm vitest run src/test/composer-dock.test.tsx src/test/composer-attachments.test.tsx src/test/context-meter.test.tsx src/test/ui-primitives.test.tsx`. Expected: FAIL on those assertions.
- [ ] **Step 3:** Implement.
  - The card keeps `rounded-xl border bg-surface-2 p-3 shadow-popover`.
  - The prompt is `text-body text-fg placeholder-fg-subtle`.
  - The note is `text-caption text-fg-muted`.
  - Thumbnails are `h-16 w-24 object-cover rounded-md`, and file chips are `text-caption`.
  - The meter reads `{percent}% of context`. The details popover's `text-xs` becomes `text-ui-sm`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: composer card, thumbnails and Stop as outline`.

### Task 5: The bottom row and the ⋯ overflow

**Files:**
- Create: `src/lib/composer-overflow.ts`, `src/components/composer/MoreControls.tsx`
- Modify: `src/components/ComposerDock.tsx`
- Test: `src/test/composer-overflow.test.ts`, `src/test/composer-dock.test.tsx`

**Interfaces:**
- Consumes: `Popover` and `PopoverOption isRadio` (Task 1), `OptionDropdown` (Task 2).
- Produces:
  - `MAX_INLINE_CONTROLS = 3`.
  - `splitControls<T>(controls: readonly T[], max = MAX_INLINE_CONTROLS): { inline: T[]; overflow: T[] }`.
  - `MoreControls({ controls: { id: string; label: string; control: ComposerControl }[]; isOpen; onToggle; onPicked: () => void })`.
  - `OpenDropdown` gains `"more"`.

- [ ] **Step 1: Write the failing tests.**
  - `splitControls([a,b,c,d,e])` → inline `[a,b,c]`, overflow `[d,e]`. Three or fewer controls give no overflow.
  - In `composer-dock.test.tsx`, with model, permission, effort and one extra ("Collaboration"):
    - Three chips are inline, in the order Model, Permission mode, Effort. "Collaboration" is not a chip.
    - A "More options" button opens a menu. It has a group named "Collaboration", whose `menuitemradio` for the current value is checked.
    - Clicking another value calls that control's `onChange` with it, and closes the menu.
    - Opening the menu with the keyboard and pressing Escape leaves focus on "More options".
  - With only three controls there is no "More options" button.
- [ ] **Step 2:** Run `pnpm vitest run src/test/composer-overflow.test.ts src/test/composer-dock.test.tsx`. Expected: FAIL, because nothing is exported and there is no button.
- [ ] **Step 3:** Implement the row.
  - **Left:** attach, then the inline chips, then ⋯ (`IconButton label="More options"`, `MoreHorizontal`).
  - **Right** (`ml-auto`): `ContextMeter`, then Send or Stop.
  - **Control order:** the agent's controls are listed as `[model, permission, effort, ...extras]`, with absent ones dropped. Each keeps the icon and the `showLabel` / `description` it has today.
  - **`MoreControls`** is a `Popover role="menu" side="top" align="start" label="More options"`. Each control is a `<div role="group" aria-label={label}>` holding a `PopoverHeader` and `PopoverOption isRadio` items.
  - The folder and agent chips leave this row (Task 6 moves them).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: composer controls that do not fit go into a menu`.

### Task 6: Draft chips: folder, branch, agent

**Files:**
- Create: `src/components/composer/DraftChips.tsx`, `src/components/composer/BranchPicker.tsx`
- Modify:
  - `src/components/composer/FolderPicker.tsx` (loses its branch and worktree rows)
  - `src/components/composer/AgentMultiPicker.tsx`
  - `src/components/ComposerDock.tsx`
  - `src/lib/composer-controls.ts`
- Test: `src/test/draft-chips.test.tsx` (new), `src/test/compare-composer.test.tsx`, `src/test/composer-dropdown-renders.test.tsx`, `src/test/composer-controls.test.ts`

**Interfaces:**
- Consumes: `COMPOSER_CHIP`, `Popover`, `PopoverList`, `PopoverOption`, `PopoverHeader`. `FolderControl` and `BranchControl` are unchanged, so `App` passes the same props.
- Produces:
  - `AgentChoice.signIn: SignInState`, set by `compareAgentOptions`.
  - `DraftChips({ folder?, agent?, agents?, openDropdown, toggle })`. `ComposerDock` renders it above the card when `folder` is given, in a `flex flex-wrap gap-1.5 mb-2` row.

- [ ] **Step 1: Write the failing tests**, in `draft-chips.test.tsx` unless noted.
  - **Folder chip:**
    - The chip is named "Folder: agent-desktop".
    - It opens a dialog named "Choose a folder" holding a search field named "Search folders", a header "Recent folders", and a `listbox` named "Recent folders" with the selected folder checked.
    - The dialog ends with a button "Open another folder…".
  - **Branch chip** (when `folder.branch` is given):
    - The chip is named "Branch: main". While the worktree is on, it reads "main · new worktree".
    - Its open dialog has "Search branches", a header "Local branches", and the current branch checked.
    - A switch named "New worktree" carries the line "Works on its own copy from main. Your checkout stays as it is."
    - With `lockedReason`, the switch is disabled and the reason shows.
    - With an 80-character branch name, the chip keeps `max-w-full` with `truncate`, and its `title` holds the whole name.
  - **Agent chip** (with `agents`):
    - Each option shows the agent's logo (`AgentLogo`), its name, and its readiness word from `SIGN_IN_LABELS` ("Ready" or "Not checked").
    - A disabled row says why, and its checkbox has `aria-disabled`.
    - The header reads "Pick more than one to compare them in a run."
    - The footer reads "Each agent runs in its own worktree, in its safest mode."
  - In `composer-controls.test.ts`, `compareAgentOptions` sets `signIn` to the state `signInStateOf` returns.
  - Migrate `compare-composer.test.tsx` and `composer-dropdown-renders.test.tsx` from the folder popover's inner branch rows to the branch chip.
- [ ] **Step 2:** Run `pnpm vitest run src/test/draft-chips.test.tsx src/test/compare-composer.test.tsx src/test/composer-dropdown-renders.test.tsx src/test/composer-controls.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **`FolderPicker`** keeps its search, the recent folders, and "Open another folder…" (renamed from "Open folder…").
  - **`BranchPicker`** takes `BranchControl` plus `worktree`, and renders `BranchList`'s search and list. It still loads branches through `onOpen` when it opens. Its switch moves the copy from `title` into visible text.
  - **`AgentMultiPicker`** keeps its pick-alone and checkbox behavior and its arrow keys, restyled into `Popover`.
  - The non-repository draft keeps `OptionDropdown` for "Agent".
  - Every chip uses `COMPOSER_CHIP`, and its text span gets `truncate`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: folder, branch and agent chips above the draft composer`.

### Task 7: The centered draft and "Start N sessions"

**Files:**
- Modify:
  - `src/components/workspace/NewSessionView.tsx`
  - `src/App.tsx`
  - `src/lib/composer-state.ts`
  - `src/components/workspace/AgentSessionList.tsx` (type scale only)
- Test: `src/test/new-session.test.tsx`, `src/test/composer-state.test.ts`, `src/test/compare-composer.test.tsx`

**Interfaces:**
- Consumes: `ComposerDockProps.sendLabel` (Task 4).
- Produces:
  - `NewSessionHeading({ workspace?, unavailableReason? })` sits in the chat's slot as a `flex-1 flex flex-col justify-end items-center pb-6` block. It shows one of:
    - "New session in <name>", with `unavailableReason` under it when one is given;
    - "New session" with "Open a project folder to start a session in it." under it, when there is no folder.
  - `NewSessionBelow({ sessionList? })` is a `flex-1` block after the composer's slot. `App` renders it only while `isNewSessionDraft`.
  - These two replace `NewSessionView`.

- [ ] **Step 1: Write the failing tests.**
  - In `new-session.test.tsx`:
    - A draft in the folder `agent-desktop` shows the heading "New session in agent-desktop", and no `WorkspaceSummary`.
    - "Continue a session from Codex" renders after the composer in document order (`compareDocumentPosition`).
    - **Review Focus 1:** type "hello" in the draft's prompt and keep the `textarea` element. Start the session. The session's prompt is the same element (`toBe`). After a failed start, the composer still holds "hello". Use the failed-start helper this file already has, or `giveBack`.
  - In `compare-composer.test.tsx`, with two agents ticked, the primary button reads "Start 2 sessions" and the note reads "Each agent starts in its safest mode, in its own worktree, and uses its own quota."
  - In `composer-state.test.ts`, migrate `compareNote`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/new-session.test.tsx src/test/composer-state.test.ts src/test/compare-composer.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement in `App.tsx`.
  - The ternary's draft branch renders `NewSessionHeading`.
  - Right after the composer's `<div hidden={isComposerHidden}>`, add `{isNewSessionDraft && <NewSessionBelow sessionList={draftSessionList.sessionList} />}`. The composer's slot keeps its index and gets no `key`.
  - Pass `sendLabel={compare.agentIds.length >= 2 ? \`Start ${compare.agentIds.length} sessions\` : undefined}`.
  - Drop the props that are now unused: `details` and `worktreeBaseBranch`.
  - In `AgentSessionList`, `text-sm` becomes `text-ui` and `text-xs` becomes `text-caption`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the new-session draft centers its composer`.

### Task 8: Docs, changelog and the full run

**Files:**
- Modify:
  - `docs/design-system/components/Composer/README.md` and `preview.html`
  - `docs/design-system/components/Popover/README.md` and `preview.html`
  - `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts` (unchanged), and the full suite.

- [ ] **Step 1:** Update the design-system docs.
  - The Composer README covers: the card, the thumbnails, the bottom row's order, `MAX_INLINE_CONTROLS` and ⋯, "N% of context", Send/Stop and `sendLabel`, and the draft chips.
  - Update the Composer preview to match, keeping its `@dsCard` group.
  - The Popover README adds `PopoverList`, `isRadio`, `POPOVER_PANEL_STYLE` and `Highlighted`.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**The composer is calmer.** Image attachments show as thumbnails, controls that do not fit go into a ⋯ menu, Stop sits where Send was, and a new session starts from a centered composer with folder, branch and agent chips."
- [ ] **Step 3:** Run `pnpm lint`. Expected: clean.
- [ ] **Step 4:** Run `pnpm test > .superpowers/sdd/2026-11-05-redesign-phase-4b-composer/full.log 2>&1`, then read its last 20 lines. Expected: all files pass. Migrate any test that pinned the old copy or markup, and record a ruling for each.
- [ ] **Step 5:** Commit `docs: the composer in the design system`.
