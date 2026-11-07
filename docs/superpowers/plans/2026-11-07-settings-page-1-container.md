# Settings page, part 1 (container, General, Appearance, GitHub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings becomes a full page in the main window, with a left navigation and **Back to sessions**, and its General, Appearance and GitHub sections drawn as on the canvas.

**Architecture:** A `useSettingsPage` hook owns which section shows and where focus goes back. While a section shows, `App.tsx` hides the sidebar-and-main `<section>` with `hidden`, which keeps it mounted, and renders `components/settings/SettingsPage.tsx` beside it. The page is made of `SettingsNav` plus one section component per nav item, all built from shared `SettingsGroup`/`SettingsRow` parts. Agents keeps today's `AgentCatalogPanel` until part 2 restyles it.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-onboarding-settings-redesign-design.md`. This plan covers its "Suggested phases" step 1: "Settings page container and navigation, with General, Appearance and GitHub".

**Artboards:**
- `project/SettingsGeneral.dc.html` and `project/SettingsAppearanceGithub.dc.html` in https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz.
- Saved copies are in this session's scratchpad, under `canvas/project/`.
- Where the spec text and an artboard differ, the artboard decides the look and the spec decides behavior (audit decision of 2026-11-05).

**Branch:** `feat/redesign-settings-page`, from main 55fb3ec, in the `redesign-foundations` worktree.

## Global Constraints

- **Canvas to token mapping:**
  - `--s1` → `surface-1`; `--s2` → `surface-2`; `--hover` → `surface-hover`; `--line` → `border`; `--strong` → `border-strong`.
  - `--fg` → `fg`; `--fg2` → `fg-secondary`; `--muted` → `fg-muted`; `--subtle` → `fg-subtle`; `--run` → `status-running`.
  - Type: 13/18 → `text-ui`, 12 → `text-ui-sm`, 11 → `text-caption`, 20/28 → `text-xl`.
- No raw colours in components (`design-tokens.test.ts`). The fixed light and dark colours of the theme previews live in `globals.css` (Task 4).
- **Buttons:**
  - The canvas's `.ob` button (28px tall, 12px text, `border-strong`, radius 8) is `Button variant="outline" size="md"`; 8d ruled the same way.
  - A caller's className never sets padding, height or text size on a `Button`.
  - An outline label that must read `fg` is wrapped in `<span className="text-fg">`, because a className colour loses to the variant's colour in the built CSS.
  - **Known gap, kept app-wide:** the canvas's 28px buttons have 12px text at weight 400, and `Button size="md"` has 13px at weight 500. Every 28px button since phase 8 has the same gap. Closing it means changing `Button`'s `md` size for the whole app, which is not part of this plan.
- **Gaps differ per section, as drawn:**
  - General: 28px between the header and the groups and between groups (`gap-7`).
  - Appearance and GitHub: 16px between the header and their content (`gap-4`).
  - Agents: 24px (`gap-6`).
  
  Each section component owns its own column. The page adds no gap of its own.
- **Row gaps are drawn two ways:** 16px in General (`gap-4`) and 12px in GitHub and Agents (`gap-3`). `SettingsRow` takes `isTight` for the second.
- **A green dot that does not pulse:** "Up to date" and "Connected as …" have a still green dot on the canvas. `StatusLine`'s `running` pulses, since it means working. Task 2 adds a `ready` status: the same colour, with no pulse.
- Every focusable control has `focus-ring`. Copy is in sentence case, uses "you", and names the agents.
- No keyboard shortcuts. Escape no longer closes Settings: it is a page, not a dialog (see Rulings).
- The app never asks for or stores tokens. GitHub stays read through the user's own `gh`.
- Popouts have no Settings. Only `App.tsx` renders the page, so this holds already.
- Stage explicit paths only (`git add <paths>`), never `git add -A`.

## Rulings made while planning (the user can overturn them at plan review)

1. **Kept mounted.** The sidebar-and-main `<section>` is hidden, not unmounted, while Settings shows. The composer's text, review comments in a message, scroll positions and terminal views therefore survive a visit to Settings. The spec's "sessions keep running; Back returns to the session that was on screen" then holds with no extra state.
2. **MCP servers shows as "Soon"** (the user's choice, 2026-11-07).
   - The nav draws "MCP servers" where the canvas puts it, between Agents and GitHub. It is dimmed, carries a "Soon" tag, and cannot be clicked: it is not a link and is not in the Tab order.
   - A screen reader reads it as "MCP servers, coming soon".
   - There is still no placeholder page, as the spec says, and `SettingsTab` gains `appearance` and `github` only.
   - Part 4 removes the tag and makes it a link.
3. **Agents uses today's catalog.** The Agents section shows today's `AgentCatalogPanel` under the page heading "Agents" and one sentence. Part 2 restyles it.
4. **Run setup again is kept.** It becomes a row in General's About group ("Setup", "Pick agents and a folder again.", **Run setup again**). The canvas does not draw it, but it is the only way back to onboarding; this follows the audit's "keep a function, restyle it".
5. **Escape no longer closes Settings.** A page has **Back to sessions** instead. No other key is added.
6. **GitHub's states:**
   - Signed out shows only **Connect**: the canvas shows no Check again, and the window-focus re-check already covers a login made elsewhere.
   - Not installed shows `brew install gh` as selectable mono text and drops the Copy button, as the canvas does.
   - The GitHub group's heading is "Connection".
7. **Notices show on the page.** A notice raised while Settings shows (`notice` in `App.tsx`) appears in a `ToastStack` at the page's bottom right. The update card does not: the About row stands in for it.
8. **Navigation items are links.** They are `<a href="#settings-<id>">` with `aria-current="page"`, as the spec's accessibility section says. A click calls `preventDefault()`, so the URL never changes.
9. **Focus.**
   - Opening Settings moves focus to the section's `h1`, which has `tabIndex={-1}`.
   - A nav click keeps focus on the link.
   - Back gives focus to the control that opened Settings when it is still in the document. Otherwise it goes to the sidebar footer's Settings button, which is the case for the Agents menu's Manage agents, whose popover has closed.
10. **Three nav icons are drawn by hand.**
    - lucide has no glyph matching the canvas's Appearance icon (a circle with its left half filled), its GitHub icon (three circles and a bent line, no arrow) or its MCP plug.
    - `SettingsNav` therefore draws all three as inline SVGs copied from the artboard (`viewBox="0 0 24 24"`, stroke 1.75, round caps and joins, 14px).
    - General (`Settings2`), Agents (`LayoutGrid`) and Back (`ChevronLeft`) match lucide.
11. **One update count.** The Agents badge shows `agentUpdates.updateCount`, the count the sidebar footer shows, as the spec says ("from `useAgentUpdates`"). Today's dialog computed its own `pendingUpdates(...)`.

## Review Focus

Most likely first:

1. **Text in the composer** (and comments already in its message) is still there after Settings → Back. *Task 6, test "keeps the composer's text across a visit to Settings".*
2. **Focus after Back when the opener is gone** (Manage agents in the closed Agents menu) lands on the footer's Settings button, not on `body`. *Task 6, test "Back from Manage agents gives focus to the footer's Settings button".*
3. **An update the user hid with Later** still shows in About, with **Update & restart**. *Task 1, test "available keeps an update hidden by Later"; Task 3, test "shows an update hidden by Later with Update & restart".*
4. **A GitHub sign-in started in Settings keeps its dialog after Back**: the dialog belongs to a running login. *Task 6, test "the GitHub sign-in dialog stays after Back".*
5. **Check now while an install runs** does nothing, and a manual check that fails says so; an automatic failure stays silent. *Task 1, tests "checkNow does nothing while installing" and "a failed checkNow sets checkFailed".*
6. **The terminal inspector after Settings**, checked in the app (jsdom cannot measure layout): a shell that was open shows its output again at full width when the page is hidden and shown. `TerminalView.fit` already skips a container with no size.

---

### Task 1: `useAppUpdate` checks on request and remembers when it last checked

**Files:**
- Modify: `src/hooks/useAppUpdate.ts`, `src/lib/app-update.ts`
- Test: `src/test/app-update.test.tsx` (extend)

**Interfaces:**
- Produces, on `AppUpdate`:
  - `available: AppUpdateInfo | null`: the found update, even when Later hid it;
  - `isChecking: boolean`;
  - `checkedAt: number | null`: the epoch ms of the last check the backend answered;
  - `checkFailed: boolean`: the last check made with `checkNow` could not be made;
  - `checkNow: () => Promise<void>`.
- Produces `checkedWords(ms: number): string` in `src/lib/app-update.ts`: under 60 000 ms it returns "just now", otherwise `` `${elapsedWords(ms)} ago` ``, with `elapsedWords` imported from `lib/compare-run.ts`.

- [ ] **Step 1: Write the failing tests**:
  - `checkNow asks the backend and records checkedAt`: fake timers with `Date` set to `T`. After `act(() => result.current.checkNow())`, `invoke` was called with `'app_update_check'`, `checkedAt === T`, `isChecking === false` and `checkFailed === false`.
  - `a failed checkNow sets checkFailed`: `invoke` rejects, so `checkFailed === true` and `checkedAt` is unchanged. A failed automatic check, after `FIRST_CHECK_DELAY_MS`, leaves `checkFailed === false`.
  - `available keeps an update hidden by Later`: the check answers `{version: '0.9.0', …}`. After `dismiss()`, `update === null` and `available?.version === '0.9.0'`.
  - `checkNow does nothing while installing`: `install()` is pending, so `checkNow()` makes no `app_update_check` call.
  - `isChecking is true while the check is in flight`: a deferred promise.
  - `checkedWords`: `checkedWords(30_000)` is "just now", `checkedWords(2 * 3_600_000)` is "2 h ago" and `checkedWords(5 * 60_000)` is "5 min ago".
- [ ] **Step 2: Run** `pnpm vitest run src/test/app-update.test.tsx`. Expected: FAIL (`checkNow is not a function`, `checkedWords` not exported).
- [ ] **Step 3: Implement.**
  - The scheduled `check()` sets `checkedAt` on an answer.
  - `checkNow` shares `check` through a ref, sets `isChecking` around it and sets `checkFailed` from its result. A `checkingRef` stops a second call while one runs, and `isInstallingRef` stops a call during an install.
  - `available = found`. `update` keeps its hidden-version rule.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/hooks/useAppUpdate.ts src/lib/app-update.ts src/test/app-update.test.tsx && git commit -m "feat: check for a Zorvo update on request and remember when"`

### Task 2: Settings building blocks: navigation, section header, groups and rows

**Files:**
- Create: `src/components/settings/SettingsNav.tsx`, `src/components/settings/SettingsGroup.tsx`
- Modify: `src/components/ui/StatusLine.tsx` (status `ready`)
- Test: `src/test/settings-parts.test.tsx`

**Interfaces:**
- Produces in `SettingsNav.tsx`:
  - `export type SettingsTab = "general" | "appearance" | "agents" | "github"`.
  - `export const SETTINGS_SECTIONS: readonly { id: SettingsTab; label: string }[]`: General, Appearance, Agents, GitHub, in that order.
  - `SettingsNav({ current, onSelect, onBack, updateCount }: { current: SettingsTab; onSelect: (tab: SettingsTab) => void; onBack: () => void; updateCount: number })`.
- Produces in `SettingsGroup.tsx`:
  - `SettingsHeader({ title, children, titleRef }: { title: string; children: ReactNode; titleRef?: Ref<HTMLHeadingElement> })`;
  - `SettingsGroup({ heading, children }: { heading: string; children: ReactNode })`;
  - `SettingsRow({ label, description, control, leading, isTight }: { label: ReactNode; description?: ReactNode; control?: ReactNode; leading?: ReactNode; isTight?: boolean })`.
- Produces in `StatusLine.tsx`: `Status` gains `"ready"`, whose dot is `bg-status-running` with no pulse.

**Canvas values (SettingsGeneral):**
- **Nav:**
  - `nav aria-label="Settings"`: `w-55 shrink-0 flex flex-col gap-0.5 px-2.5 bg-surface-1 border-r border-border select-none`.
  - First comes a `data-tauri-drag-region` block, `h-12 shrink-0`, where the window's own buttons sit.
  - **Items**: an `a` with `flex h-8 items-center gap-2.5 rounded-md px-2.5 text-ui text-fg-secondary hover:bg-surface-hover focus-ring`, and a 14px icon with `aria-hidden`.
  - **Back to sessions**: `ChevronLeft`, `text-fg-muted`, `mb-2.5`, `href="#sessions"`.
  - The **current item** adds `bg-surface-hover text-fg font-medium` and `aria-current="page"`.
  - **Icons**:
    - General is lucide `Settings2`, Agents is lucide `LayoutGrid`, Back is lucide `ChevronLeft`.
    - Appearance is inline: `<circle cx="12" cy="12" r="9"/>` and `<path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>`.
    - GitHub is inline: circles at (6,6), (6,18) and (18,18) with r 2.5, and `<path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-3"/>`.
    - MCP servers is inline: `<path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4"/>`.
    - Both inline icons use `fill="none" stroke="currentColor" strokeWidth={1.75}`, round caps and joins, size 14, and `aria-hidden`.
  - **MCP servers (Soon)**, between Agents and GitHub:
    - a `div` (not a link, no `tabIndex`) with the item's layout but no hover, in `text-fg-subtle`;
    - the tag "Soon" uses the badge's shape (`ml-auto flex h-4.5 items-center rounded-md bg-surface-hover px-1.5 text-caption text-fg-muted`) and is `aria-hidden`;
    - a sr-only ", coming soon" follows the name.
  - **Agents badge**, shown only when `updateCount > 0`: `ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-md bg-surface-hover px-1.25 text-caption text-fg`, with `aria-hidden` plus a sr-only `, N update(s)`.
- **Header**: `flex flex-col gap-1`. The `h1` is `text-xl font-semibold tracking-[-0.02em] text-fg` with `tabIndex={-1}` and `outline-none`. The sentence below it is `text-ui text-fg-muted`.
- **Group**:
  - `<section aria-labelledby>`;
  - its heading is a `div` with `px-1 pb-2 text-caption font-medium text-fg-muted`;
  - its card is `flex flex-col overflow-hidden rounded-xl border border-border bg-surface-2`.
- **Row**:
  - the row is `flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0`, or `gap-3` with `isTight`;
  - the label column is `flex min-w-0 flex-1 flex-col gap-0.5`, with the label in `text-ui text-fg` and the description in `text-ui-sm text-fg-subtle`;
  - `leading` is drawn before the label column, and the control after it with `shrink-0`.

- [ ] **Step 1: Write the failing tests** in `settings-parts.test.tsx`:
  - `the nav marks the current section`: `getByRole("navigation", { name: "Settings" })` holds the links "Back to sessions", "General", "Appearance", "Agents" and "GitHub". Only `current` has `aria-current="page"` and `bg-surface-hover`.
  - `a nav click selects without changing the URL`: clicking "Appearance" calls `onSelect("appearance")`, the click event is `defaultPrevented`, and `location.hash` is unchanged. "Back to sessions" calls `onBack`.
  - `the Agents link counts updates in words`: with `updateCount=2`, the link's accessible name is "Agents, 2 updates". With 1 it is "Agents, 1 update". With 0 there is no badge.
  - `a group is a labelled card of rows`: `getByRole("region", { name: "Recent folders" })` holds a card with `rounded-xl` and `bg-surface-2`. Each row has `px-4` and `py-3`, and its description has `text-fg-subtle`.
  - `the header's title can take focus`: `titleRef.current` has `tabIndex === -1` and the class `text-xl`.
  - `MCP servers shows as coming soon`:
    - the text "MCP servers" sits between the "Agents" and "GitHub" links;
    - `queryByRole("link", { name: /MCP servers/ })` is null;
    - the item's text content reads "MCP servers, coming soon" (with "Soon" `aria-hidden`);
    - tabbing from "Agents" lands on "GitHub".
  - `a tight row has the narrower gap`: `isTight` gives `gap-3`, and the default gives `gap-4`.
  - `the hand-drawn icons match the canvas`: the Appearance link's svg holds a path with `d="M12 3a9 9 0 0 0 0 18z"`, and the GitHub link's svg holds three circles.
  - `ready is a still green dot`: `StatusLine status="ready"`'s dot has `bg-status-running` and no `animate-pulse`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-parts.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both files from the values above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/settings/SettingsNav.tsx src/components/settings/SettingsGroup.tsx src/components/ui/StatusLine.tsx src/test/settings-parts.test.tsx && git commit -m "feat: settings navigation, header, groups and rows"`

### Task 3: General section

**Files:**
- Create: `src/components/settings/GeneralSection.tsx` and `src/components/settings/DefaultAgentPicker.tsx`
- Test: `src/test/settings-general.test.tsx`

**Interfaces:**
- Consumes `SettingsHeader`, `SettingsGroup` and `SettingsRow` (Task 2), and `AppUpdate`'s `available`, `isChecking`, `checkedAt`, `checkFailed`, `checkNow`, `install`, `isInstalling` and `progress`, plus `checkedWords` (Task 1).
- Produces `GeneralSection(props: GeneralSectionProps)`, where `GeneralSectionProps` is:
  - `titleRef`;
  - `agents: readonly AgentSummary[]`: the agents in use;
  - `defaultAgentId: string | null`;
  - `onChangeDefaultAgent(id)`;
  - `recentFolders: readonly FolderOption[]` and `onRemoveRecentFolder(path)`;
  - `appVersion?: string`;
  - `appUpdate: Pick<AppUpdate, "available" | "isChecking" | "checkedAt" | "checkFailed" | "checkNow" | "install" | "isInstalling" | "progress">`;
  - `restartNote: string | null`: `restartWarning(busy, terminals) || null`, since `restartWarning` returns `''` when nothing would stop;
  - `onRunOnboarding()`.

**Canvas values and copy:**
- **Header**: "General", and below it "How new sessions start, and the folders Zorvo remembers."
- The section's root is `flex flex-col gap-7` (28px between the header and each group).
- **New sessions** group, row "Default agent":
  - Its description is "New sessions start with this agent. You can switch in each draft."
  - **Control**: a `Popover` (`role="listbox"`, `label="Default agent"`, `align="end"`) whose trigger is `Button outline size="md"`, with `aria-haspopup="listbox"` and `aria-expanded`. The trigger holds:
    - a `size-4 rounded bg-surface-hover` tile with `AgentLogo size={12}`;
    - the name in `span.text-fg`;
    - a `ChevronDown` at 12px in `text-fg-muted`.
  - The list holds one `PopoverOption` per `readyAgents(agents)`, `selected` on the default, each with `AgentLogo size={12}`.
  - The trigger names the agent `defaultAgentId` points to, looked up in `agents`, even when that agent is not ready. With `defaultAgentId === null`, or an id no agent in use has, it reads "Choose an agent" with no logo tile.
  - With no ready agent the control is `<span className="text-ui-sm text-fg-subtle">No agents are installed yet.</span>`.
- **Recent folders** group:
  - one row per folder: label = `folder.name`, description = `folder.path` in `font-mono text-caption`, control = `Button ghost tone="muted" size="md"` "Remove" with `aria-label="Remove {name} from recent folders"`;
  - with no folders, a single row labelled "No recent folders yet." in `text-fg-subtle`, with no control.
- **About** group:
  - Row "Zorvo version". Its description is a `StatusLine`. The first state that applies wins:
    - installing: `idle`, "Downloading {available.version} · {p}%" while `progress.phase` is `downloading` and `downloadPercent(progress)` is a number, "Downloading {available.version}…" without a percent, and "Installing {available.version}…" in the `installing` phase;
    - available: `attention`, "{available.version} is ready";
    - checking: `idle`, "{version} · Checking for updates…";
    - failed: `attention`, "{version} · Could not check for updates";
    - checked: `ready` (the still dot), "{version} · Up to date · checked {checkedWords(now - checkedAt)}";
    - not checked yet (the first 8 s after start): `idle`, "{version} · Not checked yet".
  - `now` comes from `useNow()`. The version part is left out when `appVersion` is undefined.
  - Its control:
    - **Check now** (`Button outline size="md"`, disabled while checking or installing);
    - when `available` is set, **Update & restart** (`Button primary size="md"`) instead, which calls `install()`.
  - With `available` and a `restartNote`, the note is a second description line in `text-fg-subtle`.
  - A `role="status"` sr-only span repeats the status words.
  - Row "Setup": description "Pick agents and a folder again.", control `Button outline size="md"` **Run setup again**.

- [ ] **Step 1: Write the failing tests**:
  - `default agent opens a listbox of ready agents and saves the pick`: click "Claude Code" (the trigger), and the listbox "Default agent" shows only the ready agents. Clicking "Codex" calls `onChangeDefaultAgent("codex")` and the listbox closes.
  - `with no default the picker reads Choose an agent`.
  - `with no ready agent the row says so`: "No agents are installed yet." and no button.
  - `Remove takes a folder out`: the button named "Remove agent-desktop from recent folders" calls `onRemoveRecentFolder("/Users/me/agent-desktop")`. The path text has the class `font-mono`.
  - `no recent folders reads as a row`: "No recent folders yet."
  - `About reads up to date with the time of the check`: with `checkedAt = now - 2h`, the text is "0.8.0 · Up to date · checked 2 h ago", and the dot is `bg-status-running` with no `animate-pulse`.
  - `before the first check About says so`: "0.8.0 · Not checked yet".
  - `an install shows its download`: with `isInstalling` and progress `{phase:"downloading", downloaded:42, total:100}`, the line is "Downloading 0.9.0 · 42%". With `{phase:"installing"}` it is "Installing 0.9.0…".
  - `a default agent that is not ready is still named`: the trigger reads its name.
  - `the section spaces its groups 28px apart`: the root has `gap-7`.
  - `Check now asks again`: a click calls `checkNow`. While `isChecking` the button is disabled and the line reads "0.8.0 · Checking for updates…".
  - `a failed check says so`: "0.8.0 · Could not check for updates".
  - `shows an update hidden by Later with Update & restart`: with `available={version:"0.9.0"}`, the line is "0.9.0 is ready", **Update & restart** calls `install`, and the restart note "Restarting stops 2 agents mid-turn and 1 shell." shows.
  - `Run setup again calls onRunOnboarding`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-general.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `DefaultAgentPicker.tsx` (the trigger and the list) and `GeneralSection.tsx`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/settings/GeneralSection.tsx src/components/settings/DefaultAgentPicker.tsx src/test/settings-general.test.tsx && git commit -m "feat: settings General section on the canvas"`

### Task 4: Appearance section

**Files:**
- Create: `src/components/settings/AppearanceSection.tsx`
- Modify: `src/styles/globals.css`, adding the two sample palettes
- Test: `src/test/settings-appearance.test.tsx`

**Interfaces:**
- Produces `AppearanceSection({ titleRef, appearance, onChange }: { titleRef?: Ref<HTMLHeadingElement>; appearance: Appearance; onChange: (appearance: Appearance) => void })`.

**Canvas values (SettingsAppearanceGithub):**
- **Header**: "Appearance", and below it "The terminal stays dark in every theme, since agents color their output for a dark ground."
- The section's root is `flex flex-col gap-4` (16px from the header to the tiles).
- **Radio group**: `div role="radiogroup" aria-label="Theme" className="flex gap-3"`.
- **Each tile** is a `button role="radio"` with:
  - `aria-checked`, and a roving `tabIndex` (0 on the checked tile, -1 on the others);
  - the classes `flex flex-1 flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-2 text-left focus-ring`;
  - when checked, `border-fg ring-1 ring-fg`.
- **Label**, `flex items-center gap-1.5`:
  - The checked tile's label is `text-fg font-medium`, and the others' are `text-fg-secondary`. The canvas shows System checked; the style goes with the selection, not with the tile.
  - System adds `span.text-ui-sm.text-fg-subtle.font-normal` "· follows your Mac".
- **Arrow keys**: Left/Up and Right/Down move to the previous/next tile with wrap. They select it (`onChange`) and focus it, as a native radio group does.
- **Preview** (`aria-hidden`):
  - The box is `flex h-21 overflow-hidden rounded-md border` (84px).
  - Its border follows the canvas: Light in its own line colour (`theme-sample-light border-(--sample-line)`), Dark and System in the dark line colour (`theme-sample-dark border-(--sample-line)` on the box).
  - Light and Dark: one `ThemeSample` filling the box, in the class `theme-sample-light` or `theme-sample-dark`:
    - a sidebar strip, 28% wide, in `--sample-side` with a right border in `--sample-line`;
    - a content area in `--sample-bg` with `p-2.5 flex flex-col gap-1.25`, holding two 5px bars (70% in `--sample-bar`, 50% in `--sample-bar-2`, `rounded-xs`) and a bottom card (`mt-auto h-4 rounded border`, `--sample-card` filled, `--sample-line` border).
  - System: two `ThemeSample`s side by side (light then dark), each without the card.
  - The colours are used as `bg-(--sample-bg)` and similar, and the border as `border-(--sample-line)`.
- **`globals.css`**: add, outside `@theme`:

  ```css
  .theme-sample-light {
    --sample-bg: #fafafa; --sample-side: #f4f4f5; --sample-line: #e4e4e7;
    --sample-bar: #d4d4d8; --sample-bar-2: #e4e4e7; --sample-card: #ffffff;
  }
  .theme-sample-dark {
    --sample-bg: #0a0a0b; --sample-side: #111113; --sample-line: #27272a;
    --sample-bar: #3f3f46; --sample-bar-2: #27272a; --sample-card: #18181b;
  }
  ```

  These are the canvas's own preview colours. They are fixed on purpose, since a preview shows a theme other than the one in use. If `design-system-docs.test.ts` or `theme-contrast.test.ts` reads every custom property, rule on the smallest change and ledger it.

- [ ] **Step 1: Write the failing tests**:
  - `the three themes are one radio group`: `getByRole("radiogroup", { name: "Theme" })` holds the radios "System · follows your Mac", "Light" and "Dark". Only the current one has `aria-checked="true"`, and it has the class `ring-fg`.
  - `a click picks a theme`: clicking "Dark" calls `onChange("dark")`.
  - `arrow keys move and select`: with focus on System, ArrowRight calls `onChange("light")` and focuses "Light". ArrowLeft from System wraps to "Dark".
  - `only the checked tile is in the tab order`.
  - `previews use the fixed samples`: the System radio holds `.theme-sample-light` and `.theme-sample-dark`, and the Dark radio holds only `.theme-sample-dark`.
  - `the checked tile's label is the bright one`: with `appearance="dark"`, the label "Dark" has `text-fg` and `font-medium`, and "System" has `text-fg-secondary`.
  - The header sentence is present.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-appearance.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the component and the CSS.
- [ ] **Step 4: Run** `pnpm vitest run src/test/settings-appearance.test.tsx src/test/design-tokens.test.ts src/test/design-system-docs.test.ts src/test/theme-contrast.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/settings/AppearanceSection.tsx src/styles/globals.css src/test/settings-appearance.test.tsx && git commit -m "feat: settings Appearance as three theme tiles"`

### Task 5: GitHub section as one group of rows

**Files:**
- Move: `src/components/GithubSection.tsx` → `src/components/settings/GithubSection.tsx` (`git mv`, then restyle)
- Modify: `src/test/github-section.test.tsx` (the import path, and states as below)

**Interfaces:**
- Produces `GithubSection({ titleRef, status, isChecking, onCheck, onConnect, onOpenUrl, ref })`. The props are today's plus `titleRef`. `ref` stays on the focusable group card (`tabIndex={-1}`), where focus goes after a sign-in that worked.

**Canvas values and copy:**
- **Header**: "GitHub", and below it "Optional. Zorvo reads pull requests through your own <code>gh</code> and keeps no token." `gh` is `font-mono text-ui-sm`.
- The section's root is `flex flex-col gap-4` (16px from the header to the group).
- **Group** "Connection", one row with `isTight` (12px gaps, as drawn):
  - **Checking** (`status === null`): label "Checking your GitHub connection…" in `text-fg-subtle`, no control.
  - **Signed in**:
    - `leading` is a `size-8 rounded-full bg-surface-hover text-ui-sm font-semibold text-fg-secondary` circle with the initials. Take `initialsFromName` out of `ProfileFooter.tsx` into `src/lib/initials.ts` and use it in both places. A login with no name gives the login's first letter uppercased.
    - The label is the name, or `@login`.
    - The description is a `StatusLine status="ready"` (a still dot) reading "Connected as @{login} on github.com".
    - The control is **Check again** (`Button outline size="md"`). While checking it reads "Checking…" and is disabled.
  - **Signed out**: label "Not connected"; description "Connect to see pull requests in the Changes tab and the top bar."; control **Connect** (`Button primary size="md"`).
  - **Not installed**:
    - Label "Install the GitHub CLI first".
    - Description "Run `brew install gh` in a terminal, or get it from cli.github.com. Then check again.":
      - the command is `font-mono text-caption text-fg-secondary select-text`;
      - "cli.github.com" is a `button` styled as a link, always underlined as the canvas's `<a>` is (`text-fg-secondary underline underline-offset-2 focus-ring`), calling `onOpenUrl(GITHUB_CLI_URL)`.
    - Control: **Check again**.
  - **Unknown**: label "Could not check GitHub"; description `status.message`; controls **Connect** (primary, only when `canConnect !== false`) and **Check again**.
- The sr-only `role="status"` announcement (`announcementOf`) stays, with "Connected to GitHub as …" unchanged.
- `CopyableCommand`, `Card` and the lucide icons in the buttons are removed.

- [ ] **Step 1: Update the tests first**:
  - Import from `../components/settings/GithubSection`.
  - `signed in shows initials, name and the connection line`: "ZI", "Zaky Irsyad" and "Connected as @zakyirsyaad on github.com", with the dot `bg-status-running` and no `animate-pulse`. The row has `gap-3`.
  - `signed out offers only Connect`: there is no "Check again" button.
  - `not installed shows the command as text and a link`: "brew install gh" has `select-text`, and the button "cli.github.com" calls `onOpenUrl("https://cli.github.com")`. Delete the Copy tests.
  - `unknown hides Connect when canConnect is false`.
  - `the group is labelled Connection`.
  - Keep the existing tests of the live announcement and the focusable section.
- [ ] **Step 2: Run** `pnpm vitest run src/test/github-section.test.tsx`. Expected: FAIL (module path, then the copy).
- [ ] **Step 3: Implement**: `git mv`, restyle, add `src/lib/initials.ts`, and update `ProfileFooter.tsx` to import it.
- [ ] **Step 4: Run** `pnpm vitest run src/test/github-section.test.tsx src/test/profile-footer.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/settings/GithubSection.tsx src/components/GithubSection.tsx src/lib/initials.ts src/components/ProfileFooter.tsx src/test/github-section.test.tsx && git commit -m "feat: settings GitHub section as one row card"`

### Task 6: The page, its hook and App wiring

**Files:**
- Create: `src/hooks/useSettingsPage.ts` and `src/components/settings/SettingsPage.tsx` (taking over `AppSettingsDialog`'s dialog and focus logic)
- Delete: `src/components/AppSettingsDialog.tsx` and `src/components/SettingsPanel.tsx`
- Modify:
  - `src/App.tsx`;
  - `src/components/ProfileFooter.tsx`: forward a `settingsButtonRef` to its Settings button;
  - the tests that named the dialog: `github-app.test.tsx`, `agent-updates.test.tsx`, `settings-sign-in-dialog.test.tsx`, `agent-catalog-ui.test.tsx` and `profile-footer.test.tsx`.
- Delete: `src/test/settings-panel.test.tsx`. Its cases are moved into the new tests first: the default agent, recent folders, Run setup again, the update count, the GitHub section, and the sign-in dialog over Settings.
- Test: `src/test/settings-page.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 1–5.
- Produces the hook:
  - `useSettingsPage(fallbackFocusRef: RefObject<HTMLElement | null>): SettingsPage`, where `interface SettingsPage { section: SettingsTab | null; open: (section: SettingsTab) => void; select: (section: SettingsTab) => void; close: () => void }`.
  - `open` records `document.activeElement` only when the page is closed.
  - `close` sets null. An effect then focuses the recorded element if `isConnected`, else `fallbackFocusRef.current`.
- Produces the component:
  - `SettingsPage(props: SettingsPageProps)`. The props are today's `AppSettingsDialogProps` with `isOpen`, `initialTab` and `onClose` replaced by `page: SettingsPage`, plus `appVersion?: string`, `appUpdate`, `restartNote: string | null`, and `notice?: ReactNode` (a toast).
  - When `page.section === null` it returns only the GitHub sign-in dialog, as today.
  - Otherwise it renders:
    - a `div className="relative flex min-h-0 min-w-0 flex-1"`;
    - inside it, `SettingsNav`;
    - then a `section` (not a `main`, since `App.tsx`'s outer element is already the one `<main>`) with `aria-labelledby` (the title id), `relative min-w-0 flex-1 overflow-y-auto px-10 py-14` and `data-settings-content`;
    - as the section's first child, an `absolute inset-x-0 top-0 h-12` strip with `data-tauri-drag-region`, so the window can be dragged from the top of the content as well as from the nav;
    - inside the section, a `div className="mx-auto max-w-[720px]"` with no gap of its own (each section sets its own);
    - the section that is open. For `agents` this is a `flex flex-col gap-6` holding `SettingsHeader` "Agents", with the artboard's sentence "The agents Zorvo can run. Zorvo installs them in its own folder, or uses the ones already on this Mac.", over `AgentCatalogPanel`;
    - `notice` inside a `ToastStack`;
    - the GitHub and agent sign-in dialogs.
  - `updateCount` is `agentUpdates.updateCount`, the footer's count.
  - On mount, and when it opens from closed, it focuses the section's `h1`.

**`App.tsx` changes:**
- `settingsTab` and `setSettingsTab` become `const settingsPage = useSettingsPage(settingsButtonRef)`. Every `setSettingsTab(x)` becomes `settingsPage.open(x)`:
  - `onOpenGithubSettings` becomes `open("github")`;
  - `handleRunOnboarding` calls `settingsPage.close()`.
- The sidebar-and-main `<section>` gets `hidden={settingsPage.section !== null}`. `<SettingsPage>` is rendered right after it, inside `<main>`.
- `SignInLayer`'s `showTerminal={settingsPage.section === null}`.
- Hand-written `main` outer containers keep `h-screen`, and the page fills it.
- The props for `appUpdate` and `restartNote` are built once:
  - `const busyCount = sessions.filter(…).length`, which `AppUpdateNotice` also reads;
  - `restartNote = restartWarning(busyCount, terminals.liveCount) || null`.
- The notice toast is built once and drawn in one place only:
  - the main column's `ToastStack` while Settings is closed;
  - the page's `ToastStack` while it shows.
  
  It is never mounted twice, which would run its timers twice.
- `appVersion` is `userProfile.version`. `useUserProfile` already reads it through `getAppVersion()`, which is undefined in jsdom and in a plain browser.

- [ ] **Step 1: Write the failing tests**:
  - In `settings-page.test.tsx`, rendering `App` through the existing App test harness (copy the setup that `github-app.test.tsx` uses):
    - `the footer's Settings opens the page in place of the sidebar and chat`: click "Settings". Then the navigation "Settings" is shown, `getByRole("heading", { level: 1, name: "General" })` has focus, the sidebar `aside` is not visible (`toBeVisible()` false), and no `dialog` named "Settings" exists.
    - `keeps the composer's text across a visit to Settings`: type "half a thought" in the composer, open Settings, click "Back to sessions". The composer still holds "half a thought", and the same session is on screen.
    - `Back gives focus to the control that opened Settings`: the footer's Settings button.
    - `Back from Manage agents gives focus to the footer's Settings button`: open the Agents menu and click Manage agents. The page opens on Agents ("Agents" link `aria-current="page"`). After Back, the footer Settings button has focus.
    - `the nav switches sections`: click "Appearance" and the radiogroup "Theme" shows; click "GitHub" and the heading "GitHub" shows.
    - `a notice raised in Settings shows on the page`: make `reportError` fire, for example a failed `app_update_install` after **Update & restart**. Its text is visible while the page shows.
    - `the GitHub sign-in dialog stays after Back`: start Connect from the GitHub section, then click Back. The dialog "Sign in to GitHub" is still in the document.
    - `the page has one main landmark`: while Settings shows, `getAllByRole("main")` has length 1, and the content is `getByRole("region", { name: "General" })`.
    - `the top of the content drags the window`: the content region's first child has `data-tauri-drag-region`.
    - `the Agents section reads the canvas sentence`: "The agents Zorvo can run. Zorvo installs them in its own folder, or uses the ones already on this Mac."
  - In `github-app.test.tsx`: replace `getByRole("dialog", { name: "Settings" })` with the region labelled by the open section's title. The Changes notice's settings link now opens on the GitHub section.
  - In `agent-updates.test.tsx`:
    - lines 164 and 180 use `getByRole("link", { name: /Agents/ })` with `aria-current="page"`;
    - the "not open" case reads no navigation "Settings".
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-page.test.tsx src/test/github-app.test.tsx src/test/agent-updates.test.tsx`. Expected: FAIL (no navigation "Settings"; the dialog is still there).
- [ ] **Step 3: Implement**:
  - the hook;
  - `SettingsPage.tsx`, with `AppSettingsDialog`'s `githubRef`/`hadSignInDialog` focus effect and its two dialogs moved in unchanged;
  - the `App.tsx` changes;
  - deleting the two old files, after moving their remaining cases into `settings-sign-in-dialog.test.tsx` and `agent-catalog-ui.test.tsx`, which then import `SettingsPage`.
- [ ] **Step 4: Run**: `pnpm vitest run src/test/settings-page.test.tsx src/test/github-app.test.tsx src/test/agent-updates.test.tsx src/test/settings-sign-in-dialog.test.tsx src/test/agent-catalog-ui.test.tsx src/test/profile-footer.test.tsx src/test/settings-sign-in.test.tsx && pnpm lint`. Expected: PASS, lint clean.
- [ ] **Step 5: Commit**: `git add src/hooks/useSettingsPage.ts src/components/settings/SettingsPage.tsx src/components/AppSettingsDialog.tsx src/components/SettingsPanel.tsx src/App.tsx src/components/ProfileFooter.tsx src/test/settings-page.test.tsx src/test/settings-panel.test.tsx src/test/github-app.test.tsx src/test/agent-updates.test.tsx src/test/settings-sign-in-dialog.test.tsx src/test/agent-catalog-ui.test.tsx src/test/profile-footer.test.tsx && git commit -m "feat: Settings as a full page with a left navigation"`

### Task 7: Docs

**Files:**
- Create: `docs/design-system/components/Settings/README.md` and `docs/design-system/components/Settings/preview.html` (token variables only; `design-system-docs.test.ts` requires the preview)
- Modify: `CLAUDE.md` and `CHANGELOG.md`

- [ ] **Step 1: Write the README**:
  - the page anatomy: the nav values and the header, group and row values from Task 2;
  - the General, Appearance and GitHub rows with their copy;
  - the rulings that shape behavior: kept mounted, no Escape, focus on Back, notices on the page, MCP servers shown as "Soon" until its backend lands.
  
  Write the preview: the General section and the theme tiles, built from `var(--color-…)`.
- [ ] **Step 2: Edit `CLAUDE.md`.** In "Which agents are ready" and "GitHub connection":
  - `AppSettingsDialog` becomes `SettingsPage`;
  - "Settings → General" for GitHub becomes "Settings → GitHub";
  - `components/GithubSection.tsx` becomes `components/settings/GithubSection.tsx`;
  - "the Agents tab" becomes "the Agents section".
- [ ] **Step 3: Add the `CHANGELOG.md` line** under Unreleased: "Settings is now a full page with a left navigation (General, Appearance, Agents, GitHub), Back to sessions, theme tiles, and Check now for Zorvo updates."
- [ ] **Step 4: Run** `pnpm vitest run src/test/design-system-docs.test.ts && pnpm test > "$WS/full.txt" 2>&1; tail -5 "$WS/full.txt"`, where `$WS` is the plan's workspace. Expected: PASS, the whole suite green.
- [ ] **Step 5: Commit**: `git add docs/design-system/components/Settings CLAUDE.md CHANGELOG.md && git commit -m "docs: the Settings page"`
