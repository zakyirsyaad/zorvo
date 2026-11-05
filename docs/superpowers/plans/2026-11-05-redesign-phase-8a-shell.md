# Redesign phase 8a: the shell and sidebar match the canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the window frame, the top bar, the sidebar and the small sidebar states look as the canvas draws them, and fix the four points the user reported:
- the Agents menu is cut off;
- the title is cramped against the traffic lights;
- the session rows have no agent logo;
- the terminal tabs touch the strip's edges. Point 3 is in 8c; this plan only gives the primitives it needs.

**Architecture:**
- Start with the primitives:
  - `Button` and `IconButton` get sizes;
  - `Chip` gets an open state.
  Most differences come from those three, so later tasks stay small.
- Then move the top bar into the chat column, so the sidebar runs the full height with its own 48px header for the traffic lights.
- Then restyle the top bar, the sidebar, its footer and menus, and the small states, element by element, from the audit's values.

**Tech Stack:** React 19, Tailwind 4 tokens, lucide-react, Vitest + Testing Library (jsdom).

**Spec and values:**
- The artboards: `Main`, `Sidebar`, `SidebarStates`, `TopBar`, `TopBarPopovers` and `SmallStates`, in the "Zorvo redesign layouts" canvas (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz).
- Their values are written out per element in `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, section **8a**. That section is this plan's source of numbers: each task names the bullets it applies.
- Behavior still comes from `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`.

## Global Constraints

- **The artboard decides the look; the spec decides behavior** (the user, 2026-11-05).
- **Keep every function, restyle it.** Drop only pure decoration the canvas leaves out:
  - the "WORKSPACES" heading;
  - the "Zorvo vX" footer line.
- **Earlier user choices stay:**
  - chips use radius 6;
  - the branch and PR chips are borderless;
  - the terminal stays an inspector tab.
- **Tokens only.** No raw colors, and `focus-ring` on every control. The audit's token table maps the canvas variables.
- **`ComposerDock` is never re-parented or re-keyed at runtime.** Moving the top bar into the chat column is a static structure change. No conditional wrapper may be added around the composer's slot.
- **No keyboard shortcuts and no voice input.**
- **Light checks:** targeted test files while working; `pnpm lint` and the full `pnpm test` once at the end. There are no Rust changes.

## Decisions taken here

- **Button sizes:**
  - `Button` gets `size?: "sm" | "md" | "lg"`, default `"md"`;
  - `sm` is `h-6 px-2 text-ui-sm` (24px);
  - `md` is `h-7 px-3 text-ui` (28px);
  - `lg` is `h-8 px-3 text-ui` (32px);
  - the radius stays `rounded-lg`.
  - Changing the default from today's `text-xs py-1.5` restyles every button in the app. That is intended: every artboard draws 13px buttons. A call site that needs the old density passes `size="sm"`.
- **Icon buttons:** `IconButton` gets `size?: "xs" | "sm" | "md"`, default `"md"`:
  - `xs` is 22px;
  - `sm` is 24px;
  - `md` is 28px, as today.
  - It also gets `tone?: "muted" | "secondary"`, default `"muted"`. The artboards' small row buttons use `fg-secondary`.
- **Open state:** `Chip` (and `IconButton`) draw `aria-expanded="true"` or `aria-pressed="true"` as `bg-surface-hover`, and a `Chip` also gets `border-border-strong`. These are Tailwind `aria-expanded:` variants, with no new prop.
- **The window frame:**
  - `TopBar` moves into the chat column: the first child of `App.tsx`'s `<div className="flex min-w-0 flex-1 flex-col">`.
  - The sidebar's top becomes a 48px `data-tauri-drag-region` header. It is left-padded by `TOP_BAR_TRAFFIC_LIGHT_INSET_PX` and holds **Hide sidebar** at the right.
  - **New session** and the search field move to a block under that header.
  - `TopBar` applies the traffic-light inset only while the sidebar is hidden, when the traffic lights sit over it.
- **The session row's logo:**
  - `AgentLogo` at 14px, decorative (`name=""`), before the agent's name in the subtitle line;
  - for a run's row, before the agent's own name;
  - the status dot stays where it is.
- **The Agents menu:**
  - The `Popover` is anchored to the footer, not the button. The footer becomes `relative`.
  - The panel is `left-2 right-2 bottom-[60px]` (the artboard's values), through a new `Popover` prop `panelClassName` that replaces the side and align classes when given.
- **Inline Delete?:** the row's ⋯ menu item "Delete" puts an inline "Delete?" pill in the row's action area. The ⋯ menu closes, and the pill takes focus. Return or a click deletes; Escape or a click elsewhere gives up. `SessionMenu`'s current two-step confirm inside the popover goes.
- **Toast tone:** `App.tsx`'s notice slot keeps one string. `setNotice` gains an optional tone, `setNotice(message, tone = "error")`. The existing callers that pass warnings ("Another agent is signing in…" and similar; grep `setNotice(` for non-failure wording) pass `"warning"`.

## Review Focus

1. **A narrow window (about 900px wide) with the sidebar open.** The top bar's chips and buttons must not push the title out, and the Agents menu must stay inside the sidebar (Task 2, Task 6).
2. **The sidebar hidden, then shown again.** The traffic lights must never overlap Show sidebar, and the title must not jump under them (Task 2).
3. **A long session title and a long agent name** in a row with the logo, a worktree icon and the hover actions. Everything truncates; nothing overlaps (Task 5).
4. **Inline Delete? and keyboard use.** Focus goes to the pill; Escape returns focus to the row's ⋯; Tab away gives up without deleting (Task 7).
5. **Every button in the app gets bigger with the new `Button` default.** Dense places the canvas draws small must pass `size="sm"`, and lint and the full suite must stay green: the toast action, the popover task rows, Settings' rows (Task 1, Task 8).

---

### Task 1: The primitives

**Files:**
- Modify: `src/components/ui/Button.tsx`, `src/components/ui/IconButton.tsx`, `src/components/ui/Chip.tsx`, `src/components/ui/Popover.tsx` (`panelClassName`)
- Test: `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `ButtonProps.size?: "sm" | "md" | "lg"`
  - `IconButtonProps.size?: "xs" | "sm" | "md"` and `tone?: "muted" | "secondary"`
  - `PopoverProps.panelClassName?: string`

- [ ] **Step 1: Write the failing tests.**
  - `Button` defaults to `h-7 text-ui`, and `size="sm"` gives `h-6 text-ui-sm`, `size="lg"` gives `h-8`.
  - `IconButton size="xs"` gives `h-5.5 w-5.5` (22px), and `tone="secondary"` gives `text-fg-secondary`.
  - `Chip` with `aria-expanded="true"` carries the `aria-expanded:bg-surface-hover` class.
  - `Popover` with `panelClassName="left-2 right-2"` renders the panel with those classes and without `left-0`/`right-0`.
- [ ] **Step 2:** Run `pnpm vitest run src/test/ui-primitives.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `pnpm vitest run` on the files that query buttons by class or size (grep `text-xs` in `src/test`); migrate any that pin the old classes.
- [ ] **Step 4:** Run the same, plus `pnpm exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: button and icon button sizes, and an open state for chips`.

### Task 2: The window frame (the user's point 2)

**Files:**
- Modify: `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/Sidebar.tsx`
- Test: `src/test/top-bar.test.tsx` (or the file that renders `TopBar`; grep it), `src/test/sidebar.test.tsx` (or the sidebar's test file)

**Interfaces:**
- Consumes: `IconButton` sizes and the open state (Task 1).
- Produces: `TopBarProps.isSidebarHidden?: boolean`, which decides the traffic-light inset. It replaces using `onShowSidebar` for that.

- [ ] **Step 1: Write the failing tests.**
  - In `App`, the banner (`header`) is inside the same column as the chat, after the sidebar in document order.
  - The sidebar's first child is a 48px header (`h-12`) with `data-tauri-drag-region`, a left padding of 78px, and **Hide sidebar**.
  - The top bar has a 78px left padding only when the sidebar is hidden.
  - The top bar is `h-12`, and its title is `font-semibold text-fg`.
  - **Inspector** with `aria-pressed="true"` and **More** with `aria-expanded="true"` get the open fill.
  - The More menu lists Open in new window, Open in Finder, Rename, a separator, then Archive. Each item has an icon.
  - **Review Focus 2:** after Hide then Show, the sidebar header holds the inset again and the top bar does not.
- [ ] **Step 2:** Run those files. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Points the user reported" 2 and "Layout and top bar": top bar height, title, gaps, inspector, More menu, open states, and the hidden-sidebar cluster.
- [ ] **Step 4:** Run the same, plus `src/test/composer-dock*.test.tsx`. That checks the composer still mounts once (grep the test that counts composer mounts). Expected: PASS.
- [ ] **Step 5:** Commit `feat: the sidebar runs the full height, and the top bar sits over the chat`.

### Task 3: Top bar chips and popovers

**Files:**
- Modify: `src/components/topbar/PullRequestChip.tsx`, `PlanMenu.tsx`, `BackgroundTasksMenu.tsx`, `src/components/changes/DiffStatChip.tsx`, the branch chip in `TopBar.tsx`
- Test: `src/test/top-bar.test.tsx`, `src/test/background-tasks*.test.tsx`, `src/test/plan*.test.tsx` (grep each)

- [ ] **Step 1: Write the failing tests.**
  - The PR chip reads "#134" in mono, then the state word ("Open", "Draft", "Merged", "Closed", from the pull request's state).
  - The background tasks chip has no checklist icon; a spinning arc shows while a task runs.
  - The Plan popover's header row reads "Plan from <Agent>", with "3 of 7 done" on the right. The current step's row has the highlight.
  - The tasks popover's header row reads "Background tasks", with "2 running" on the right. The footer ends with "Stop ends the process.".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Layout and top bar": the PR, branch, plan, background tasks and diff chips, and the Plan and Background tasks popovers.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the top bar's chips and popovers as drawn`.

### Task 4: The sidebar's top and lists

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/components/sidebar/SessionList.tsx`
- Test: the sidebar's test file

- [ ] **Step 1: Write the failing tests.**
  - The top block has no bottom border. **New session** is `size="lg"` with left-aligned content.
  - The search field has no border class and has a `surface-2` fill.
  - No "Workspaces" heading and no FolderPlus button. Opening a folder still works from the New session menu: test the existing route.
  - "Pinned" is sentence case with a pin icon, and is not uppercase.
  - "Archived" is sentence case, with the count in its own span. It sits after a flex spacer, so it is last in the list.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Sidebar": the top block, New session, Search, Headings, List padding and Archived. Drop the aside's `text-xs` base, so 13px is the default.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the sidebar's top block, headings and archive as drawn`.

### Task 5: Session rows, folders and the run row (the user's point 4)

**Files:**
- Modify: `src/components/sidebar/SessionRow.tsx`, `FolderGroup.tsx`, `RunGroupRow.tsx`, `NewSessionMenu.tsx`, `SessionMenu.tsx` (the button sizes only; Delete is Task 7)
- Test: `src/test/session-row*.test.tsx` and the sidebar test (grep)

- [ ] **Step 1: Write the failing tests.**
  - A session row shows the agent's logo (a decorative `img` or `svg`) before the agent's name in its subtitle.
  - A worktree row starts its subtitle with the branch icon (`role="img"`, "Runs in its own worktree"), not at the row's end.
  - Hover actions are in the row's flow, not `absolute`.
  - The working dot does not pulse.
  - A fork's subtitle ends with "· fork".
  - A folded folder shows its chevron first, and its summary has a dot for "waiting" and "working" but not for "N sessions".
  - The run row reads "Compare · 3 agents" over "2 working, 1 finished", with the logos after the text.
  - **Review Focus 3:** with a 120-character title and a long agent name, the title and the agent name each carry `truncate`, and the actions stay visible on hover.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Sidebar": Session row, Forks, Expanded folder header, Folded folder row and Compare run row.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: session rows with the agent's logo, and folders and runs as drawn`.

### Task 6: The footer and the Agents menu (the user's point 1)

**Files:**
- Modify: `src/components/ProfileFooter.tsx`, `src/components/sidebar/AgentsMenu.tsx`, `src/components/Sidebar.tsx` (the footer wrapper), `src/lib/agent-sign-in.ts` (only the menu's chip classes, if they are separate from the shared chip; otherwise a menu-specific style)
- Test: `src/test/profile-footer*.test.tsx`, `src/test/agents-menu*.test.tsx` (grep)

- [ ] **Step 1: Write the failing tests.**
  - The footer has one top border and a `surface-1` background, and no "Zorvo v" text.
  - The name is at weight 400.
  - The Agents panel carries `left-2 right-2` and sits inside the footer's `relative` box. **Review Focus 1** (the point the user reported): the panel never carries `right-0` from the button.
  - "Ready" text is `fg-muted`, with only its dot `status-running`.
  - "Needs sign-in" is an outline **Sign in** button (`size="sm"`) that runs the existing set-up handler.
  - "Not checked" has no dot.
  - "Manage agents" has an icon.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Sidebar": Footer and Agents menu rows. Settings' row chips (`AgentSignIn`) keep the shared style unless the audit names them.
- [ ] **Step 4:** Run them, plus `src/test/settings-sign-in.test.tsx`, which shares the chip styles. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the sidebar footer, and the Agents menu inside the sidebar`.

### Task 7: Small states (rename, Delete?, toast, image preview)

**Files:**
- Modify:
  - `src/components/ui/RenameField.tsx`
  - `src/components/sidebar/SessionRow.tsx`, `SessionMenu.tsx`
  - `src/components/ui/Toast.tsx`
  - `src/App.tsx` (the notice tone)
  - the hook that owns `setNotice` (grep)
  - `src/components/composer/ImagePreviewDialog.tsx`
- Test: `src/test/session-menu*.test.tsx`, `src/test/ui-primitives.test.tsx` (Toast), `src/test/image-preview*.test.tsx` (grep), plus a test of a warning notice's tone

**Interfaces:**
- Produces: `setNotice(message: string | null, tone?: "error" | "warning")`. The notice state holds `{ message, tone }`.

- [ ] **Step 1: Write the failing tests.**
  - Renaming a sidebar row keeps the row's fill and dot, and shows "Return saves, Esc cancels".
  - Choosing Delete in a row's ⋯ menu closes the menu and puts a focused "Delete?" button in the row. Return deletes; Escape gives up, and focus goes back to ⋯ (**Review Focus 4**).
  - A warning toast is `role="status"` with the circle-alert icon, and its border is not `border-danger`. An error toast is unchanged.
  - The image preview is `max-w-[520px]` and shows its size line ("1280 × 800 · 214 KB" from the image's natural size and the file size, when known).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Values: audit 8a, "Small states".
- [ ] **Step 4:** Run them, plus `src/test/notice-banners.test.tsx` and `src/test/file-drop.test.tsx`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: rename, Delete?, toasts and the image preview as drawn`.

### Task 8: Docs, the full run, and a look in the running app

**Files:**
- Modify:
  - `docs/design-system/components/Button/README.md`, `IconButton/README.md`, `Chip/README.md`, `SessionRow/README.md`, `TopBar/README.md`, `Toast/README.md`, with previews where a drawn value changed
  - `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts`, the full suite

- [ ] **Step 1:** Update the docs to the new sizes and states.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**The window matches its design.** The sidebar runs the full height with the window's buttons in its own header, the top bar sits over the chat, session rows show their agent's logo, and the Agents menu, buttons, menus, toasts and small states look as designed."
- [ ] **Step 3:** Run `pnpm lint`, then `pnpm test > <workspace>/full.log 2>&1`, and read its last 20 lines. Expected: clean and all pass. Migrate tests that pinned old classes or copy, and record a ruling for each.
- [ ] **Step 4:** Start `pnpm tauri dev` from this worktree. Ask the user to compare the sidebar, top bar, footer, Agents menu and a row's hover and rename states against the `Sidebar`, `SidebarStates`, `TopBar`, `TopBarPopovers` and `SmallStates` artboards, in both themes. Record what they report.
- [ ] **Step 5:** Commit `docs: the shell and sidebar as drawn`.
