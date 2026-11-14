# Redesign v2, phase 3: chat and composer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat its v2 look (agent tile in the message header, tool calls as a ghost summary over a rail, titled notices, the tighter permission card) and the composer its filled chips, context ring and menu rows.

**Architecture:** Almost all of it is class changes in existing components. Three pieces carry logic: the failed-turn and stalled-agent texts are returned as `{ title, body }` parts by their `lib/` functions (never split by regex); a tool row derives "New" inside its existing counts memo; and the model search passes its first match down so the row Return would pick is highlighted. No hook, session logic, persistence or Tauri command changes.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, sections "Chat" and "Composer and menus". Artboards in `docs/superpowers/specs/2026-11-11-redesign-v2-artboards/`: `ChatStates.dc.html`, `ChatCards.dc.html`, `ComposerMenus.dc.html`, `SmallStates.dc.html`, and the chat and composer of `Main.dc.html`. Read them before Task 1. Phases 1 and 2 (PRs 186 and 195) are merged: `AgentTile`, `POPOVER_PANEL_STYLE`, `ground`, `sheet`, `chip` and `rounded-panel` exist.

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. Letter tiles in the artboards stand for the real `AgentLogo`, which `AgentTile` draws.
- Copy and `aria-label`s stay as they are in the app. This phase adds one string, exactly: "Waiting for you". It also adds the word "New" on a tool row, and changes one sentence's punctuation (see Decisions, 3).
- A function the artboards do not draw stays: Read aloud and Copy under an agent message; Copy and Rewind under a user message; Details and Dismiss on the failed-turn notice; the Dismiss X on an elicitation card; a tool row's open chevron and its diff view; "N failed" on the tool summary; the prompt paragraph, mode note, question fields and "You chose" line of a permission card; file attachment chips and "Image not found"; the composer's note line and delegation line; the `info` toast.
- 30px in an artboard means today's 28px control. No new `Button` or `IconButton` size.
- Where two artboards disagree, `Main` and the spec win: the tool verb column is 44px (not `ChatStates`' 52px); the composer card keeps 12px padding and its row keeps `gap-1` (not `ComposerMenus`' 10px and its own gap).
- No keyboard shortcuts are added. No raw colors; `sheet-fills.test.ts` keeps passing, and its exemption of `chip-style.ts` stays (phase 5 owns `DRAFT_CHIP`).
- `tools-part-rerender-cost.test.tsx` and `tool-call-list-diff-cost.test.tsx` pass **unchanged**. Do not edit them.
- `DraftChips`, `AgentMultiPicker`, `FolderPicker`, `BranchPicker` and `DRAFT_CHIP` belong to phase 5: do not restyle them.
- Run targeted Vitest files, not the whole suite. Nothing under `src-tauri/**` changes, so no cargo.
- Stage explicit paths, never `git add -A`. Conventional Commits, no `Co-Authored-By` trailer.

## Decisions taken in this plan (each is reported in the PR body)

1. **The tool summary loses the last-touched path.** The summary is now a ghost button as wide as its words, and the artboards and the spec name only "N still running" beside it. `lastTouchedLabel` stays in `lib/tool-summary` with its tests; `ToolsPart` stops rendering it. "N failed" stays.
2. **A tool row's open chevron moves to the right end**, after the status, in a fixed 12px slot that every row reserves, so the icon and verb columns line up whether or not a row can open.
3. **The generic failed-turn title drops its colon.** Today's one sentence "The agent's turn failed: <error>" becomes the title "The agent's turn failed" over the error as the body. The network case splits with no change (summary, then hint). No other wording changes.
4. **The mention menu's rows take the slash menu's new row classes** in Task 8, though the menu belongs to phase 7, because the two share the row style and would drift otherwise. Nothing else in `MentionMenu.tsx` changes.

## Review Focus

1. **The cost tests.** `ToolsPart` stays memoised by tool identity, `ToolCallRow` stays `memo`, the list mounts only while open, and `ToolDetails` only while its row is open. "New" reads `isNewFile` from the stored diff detail inside the existing `editCounts` memo (key `[tool.kind, tool.details]`) and never calls `diffRows`.
2. **Titles made from arbitrary text.** A raw agent error or a model name can hold periods. Task 3 returns the parts from the functions that build the sentences; nothing splits a finished string.
3. **"Waiting for you" on an answered card.** It shows only while `card.status === "pending"`, never beside "You chose".
4. **The highlighted first match.** It shows only while the search has text and matches, is the same row Return picks (`visible[0]`), and is distinct from the current model's check.
5. **The context ring with an unknown window.** `size <= 0` keeps today's "12K tokens" with no ring and no `role="meter"`.
6. **Contrast on `chip`.** Chip text is `fg-secondary` on `chip` over `surface-2`; `theme-contrast.test.ts` already flattens `chip` over `surface-2`. Run it after Task 6.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/components/ChatCanvas.tsx` | modify | Column top padding and block gap |
| `src/components/chat/MessageRow.tsx`, `src/components/MessageActionBar.tsx` | modify | 80% bubble; 22px tile, name in `fg`; 28px actions |
| `src/components/chat/ToolsPart.tsx`, `ToolCallList.tsx` | modify | Ghost summary, rail, row, "New", running arc, output indent |
| `src/components/chat/ReplyExtras.tsx` | modify | Working dot's halo |
| `src/lib/turn-error.ts`, `src/lib/agent-stall.ts` | modify | `title` / `body` parts |
| `src/components/FailedTurnBanner.tsx`, `chat/AgentStallNotice.tsx` | modify | Titled cards |
| `src/components/ActionCard.tsx`, `chat/ElicitationCard.tsx` | modify | Card paddings, "Waiting for you", Deny tone, 22px tile |
| `src/components/chat/SelectionToolbar.tsx`, `ui/Toast.tsx`, `composer/ImagePreviewDialog.tsx` | modify | Popover panel; toast padding and stack offset; one-row header |
| `src/components/ComposerDock.tsx`, `composer/chip-style.ts`, `composer/AttachmentChips.tsx` | modify | Agent label tile, filled chips, skeletons, thumbnail |
| `src/components/composer/ContextMeter.tsx` | modify | The 14px ring |
| `src/components/ui/Popover.tsx`, `composer/OptionDropdown.tsx`, `SlashCommandMenu.tsx`, `MentionMenu.tsx` | modify | Row sizes and tones, mode width, count line, first-match highlight |
| `docs/design-system/**`, `CHANGELOG.md` | modify | Docs in step |

---

### Task 1: Column and messages

**Files:** `ChatCanvas.tsx`, `chat/MessageRow.tsx`, `components/MessageActionBar.tsx`; tests `chat-column.test.tsx`, `chat-messages.test.tsx`, `message-row-delegation.test.tsx`.

- [ ] **Step 1: Update the tests first** to the values below, and see them fail: column `pt-7 px-6 pb-4 space-y-[22px]`; user bubble `max-w-[80%]`; agent header holds an `AgentTile` of 22px (`size-[22px]`), the name `text-ui-sm font-medium text-fg`, header `gap-2 mb-2`; action buttons `h-7 w-7`.
- [ ] **Step 2: Column.** In `ChatCanvas.tsx` the scroll area's `pt-8` becomes `pt-7` and `space-y-6` becomes `space-y-[22px]`. `px-6`, `pb-4` and the 680px `max-w-chat` stay.
- [ ] **Step 3: User bubble.** `max-w-[85%]` becomes `max-w-[80%]`. Nothing else: its time tooltip, Copy and Rewind stay.
- [ ] **Step 4: Agent header.** Replace the reply header's `AgentLogo` (size 16) with `<AgentTile profileId={…} name="" size={22} />`; the name goes from `text-fg-secondary` to `text-fg`; `mb-2.5` becomes `mb-2`. Do the same for the delegation-report header, which the artboards do not draw but which must match. The body's hover fill is already `surface-2`.
- [ ] **Step 5: Action row.** In `MessageActionBar.tsx` the buttons go from `IconButton size="sm"` to `size="md"` (28px). Read aloud, Copy and the "Copied" state stay; no Rewind is added here.
- [ ] **Step 6:** Run the three test files; commit `feat: give agent messages a tile header and the v2 column rhythm`.

### Task 2: Tool calls

**Files:** `chat/ToolsPart.tsx`, `chat/ToolCallList.tsx`; tests `tool-card.test.tsx`, `tools-part.test.tsx`, `tool-call-list.test.tsx`. Do not touch the two cost tests.

**Artboard values:** summary button height 28, padding `0 8px 0 4px`, margin-left −4, radius 6, 12px `fg-secondary`, "1 still running" 11px `fg-subtle`; rail margin-left 7, 1px `border` left edge; step height 28, padding `0 8px 0 14px`, gap 8, radius 6; icon 14px `fg-muted`; verb 44px `fg-muted`; path mono 11px, `fg` for an edit; counts mono 11px; "New" 11px `fg-subtle` before the counts; output margin `0 8px 8px 36px`.

- [ ] **Step 1: Update the tests first.** Summary: no card (`rounded-lg`, `border`, `bg-surface-2` gone from the wrapper), button `h-7 self-start -ml-1 pl-1 pr-2 rounded-md`, no `w-full`, no `border-b`, no touched label. List wrapper `ml-[7px] border-l border-border`. Row `h-7 pl-3.5 pr-2 rounded-md`; verb `w-11`; an edit's path `text-fg`; a new file's row shows "New" before its counts; a running row has the arc in the icon slot and the word "Running" alone at the right; the open chevron is the row's last child in a `w-3` slot, and a row that cannot open has the empty slot; opened output `ml-9 mr-2 mb-2`. Keep the assertions on `aria-expanded`, the status colors, "N still running", "N failed", `font-mono` and `[direction:rtl]`.
- [ ] **Step 2: Summary and rail.** Remove the card wrapper. The button: `focus-ring flex h-7 self-start -ml-1 items-center gap-2 rounded-md pl-1 pr-2 text-ui-sm text-fg-secondary hover:bg-surface-hover` (the outer element becomes a `flex flex-col` so `self-start` holds). Keep `title={label}`, `aria-expanded`, the "still running" and "failed" spans. Stop rendering `lastTouchedLabel` (Decision 1). Wrap the open list in `ml-[7px] border-l border-border`.
- [ ] **Step 3: Row.** `ROW` becomes `flex h-7 w-full items-center gap-2 rounded-md pl-3.5 pr-2 text-left text-ui-sm text-fg-secondary`, hover fill kept. Verb `w-14` → `w-11`. An edit's path takes `text-fg` (check how `ui/PathText` takes a class before adding one). Move the chevron to the end in a `w-3 shrink-0` slot that renders empty when the row cannot open (Decision 2).
- [ ] **Step 4: "New".** Have the existing `editCounts(tool)` function (which the row already calls inside its `useMemo`) also return `isNew`: true when one of the tool's stored diff details has `isNewFile`. Render `<span className="shrink-0 text-caption text-fg-subtle">New</span>` before the counts when it is true. Same memo key; no new memo, no `diffRows` call.
- [ ] **Step 5: Running.** While the tool has no status word, the icon slot shows `LoaderCircle` (14px, `text-status-running motion-safe:animate-spin`) in place of the kind icon, and the right side shows only "Running" in `text-status-running`. Done, Failed and "Did not finish" are unchanged.
- [ ] **Step 6: Output.** The opened details container goes from `ml-[76px] mr-3` to `ml-9 mr-2`; `mb-2` stays. Diff views sit in the same container and move with it.
- [ ] **Step 7:** Run the three test files **and both cost tests**; commit `feat: draw tool calls as a ghost summary over a rail`.

### Task 3: Working line and the two notices

**Files:** `chat/ReplyExtras.tsx`, `lib/turn-error.ts`, `lib/agent-stall.ts`, `FailedTurnBanner.tsx`, `chat/AgentStallNotice.tsx`; tests `turn-error.test.ts`, `agent-stall.test.ts`, `chat-states.test.tsx`, `failed-turn-banner.test.tsx`, `agent-stall-notice.test.tsx`.

**Interfaces:**
- `TurnErrorExplanation` gains `title: string` and `body?: string`. Network: `title = summary`, `body = hint`. Generic: `title = "The agent's turn failed"`, `body = <the error>`. Empty: `title = summary`, no body. `summary`, `hint` and `details` stay as they are.
- `stallNoticeParts(agentName, state): { title: string; body?: string } | null`. Failures: title `"<agent>'s requests[ to <model>] failed N times in a row."`, body `"Last error: <asSentence(detail)>"` when there is a detail. Silence: title `"<agent> hasn't sent anything for N minute(s)."`, body `"It may be stuck."`. `stallNoticeText` stays and returns the parts joined with a space, so its tests pass unchanged.

- [ ] **Step 1: Failing unit tests** for the new fields and for `stallNoticeParts`, including a model name and an error detail that hold periods (the title must still end at "in a row."). Update the two `toEqual` assertions in `turn-error.test.ts` for the new fields.
- [ ] **Step 2: Implement** the parts in the two `lib/` files. No regex over finished sentences.
- [ ] **Step 3: Working line.** The dot's `ring-status-running/20` becomes `ring-chip`. Update `chat-states.test.tsx`.
- [ ] **Step 4: Failed-turn card.** Wrapper `rounded-xl py-3 pr-3 pl-4 gap-3`, still `border-danger bg-danger-surface`. The single paragraph becomes a column: title `text-ui font-semibold text-fg`, body `text-ui text-fg-muted` (omitted when there is none). Try again, Details and Dismiss stay; re-check the details block's left indent against the new padding.
- [ ] **Step 5: Stalled card.** Wrapper `rounded-xl py-3 pr-3 pl-4 gap-3`, still `border-border bg-surface-2`. Title and body as above. Stop goes from `size="sm"` to `size="md"`.
- [ ] **Step 6:** Update the class assertions in the three component tests, run all five files; commit `feat: title the failed-turn and stalled-agent notices`.

### Task 4: Permission and elicitation cards

**Files:** `ActionCard.tsx`, `chat/ElicitationCard.tsx`; test `chat-cards.test.tsx`, `elicitation-card.test.tsx`.

- [ ] **Step 1: Update the tests first:** card `px-4 py-3.5`; icon `size-3.5`; a pending card shows "Waiting for you" (`text-caption text-fg-muted`) at the right of its title row and an answered card does not; Deny carries the secondary ghost tone; the elicitation title row holds a 22px `AgentTile`.
- [ ] **Step 2: Permission card.** `p-4` → `px-4 py-3.5`; the icon `h-4 w-4` → `size-3.5`; the title row aligns `items-center` and gains the "Waiting for you" span while `card.status === "pending"` only. The reject choice's ghost button takes `tone="secondary"`. Edited-file rows `py-1.5` → `py-[7px]`. Everything else (prompt, mode note, question fields, hint, "You chose", the no-options message) stays.
- [ ] **Step 3: Elicitation card.** Swap `AgentLogo size={16}` for `<AgentTile profileId={…} name="" size={22} />`. Nothing else changes.
- [ ] **Step 4:** Run both test files; commit `feat: tighten the permission card and give the elicitation card a tile`.

### Task 5: Reply toolbar, toasts, image preview

**Files:** `chat/SelectionToolbar.tsx`, `ui/Toast.tsx`, `composer/ImagePreviewDialog.tsx`; tests `chat-messages.test.tsx`, `ui-primitives.test.tsx`, `image-preview-dialog.test.tsx`.

- [ ] **Step 1: Update the tests first:** toolbar `rounded-panel p-1`; toast `py-3 pr-3 pl-3.5`, stack `right-6 bottom-6`; the preview's name and meta share one row.
- [ ] **Step 2: Toolbar.** `rounded-lg` → `rounded-panel`, `p-0.5` → `p-1`. Check `TOOLBAR_HEIGHT` still clears the selection (the bar is now 38px).
- [ ] **Step 3: Toast.** `p-3` → `py-3 pr-3 pl-3.5`; icon 15 → 14; stack `right-5 bottom-5` → `right-6 bottom-6`. The stack keeps its anchor at the composer's edge.
- [ ] **Step 4: Image preview.** The header becomes one row: the name `min-w-0 flex-1 truncate`, then the meta `shrink-0`, then Close. The overlay still covers the window.
- [ ] **Step 5:** Run the three test files; commit `feat: bring the reply toolbar, toasts and image preview to the popover panel`.

### Task 6: Composer label, chips and attachments

**Files:** `ComposerDock.tsx`, `composer/chip-style.ts`, `composer/AttachmentChips.tsx`; tests `composer-card.test.tsx`, `option-dropdown.test.tsx`, `composer-loading.test.tsx`, `composer-details.test.tsx`, `composer-attachments.test.tsx`, `theme-contrast.test.ts`.

**Artboard values:** chip height 26, padding `0 8px`, gap 6, radius 6, `chip` fill, 12px `fg-secondary`, chevron 12px `fg-muted`, open `surface-hover` with `fg`; agent label height 26, padding `0 6px 0 2px`, a 16px tile; thumbnail 96×64, radius 8, `ground`, 1px `border`; remove button 18px with a 1px `border`.

- [ ] **Step 1: Update the tests first** to: `COMPOSER_CHIP` has `h-6.5` and `bg-chip`; the agent label is `h-6.5 pl-0.5 pr-1.5` and holds a 16px `AgentTile`; skeleton chips are `h-6.5 bg-chip`; the thumbnail button is `rounded-lg bg-ground`; its remove button has `border border-border`.
- [ ] **Step 2: Chips.** In `COMPOSER_CHIP` only: `h-7` → `h-6.5`, add `bg-chip`. Keep the hover and `aria-expanded` pair, the label prefix, the risky shield, the truncation. `DRAFT_CHIP` is untouched. The More button (`IconButton` md) is unchanged.
- [ ] **Step 3: Agent label.** Wrap the logo in `<AgentTile size={16} …>`; the span becomes `h-6.5 pl-0.5 pr-1.5`. The compare chips' icons stay as they are.
- [ ] **Step 4: Skeletons.** `h-7 … bg-surface-hover` → `h-6.5 … bg-chip`; widths and the pulse stay; the sr-only status stays.
- [ ] **Step 5: Attachments.** Thumbnail `rounded-md` → `rounded-lg` with `bg-ground`; the remove button gains `border border-border`. File and failed-image chips take `bg-chip` in place of `bg-surface-2` and lose their border, like the control chips. "Image not found", `aria-busy` and `title` stay.
- [ ] **Step 6:** Run the six test files; commit `feat: fill the composer's chips and tile its agent label`.

### Task 7: Context ring

**Files:** `composer/ContextMeter.tsx`; tests `context-meter.test.tsx`, `composer-details.test.tsx`.

**Artboard values:** a 14px SVG, viewBox 16, rotated −90°; track circle r 6, stroke 2, `surface-hover`; arc r 6, stroke 2, round cap, `fg-muted`; arc length = percent × 37.7 / 100; gap 6 before the words; margin-right 6.

- [ ] **Step 1: Failing tests:** with a known window the trigger holds an `svg` of two circles before "38% of context", and the arc's `stroke-dasharray` starts with `14.3` for 38%; the arc's class is `stroke-fg-muted` below 80, `stroke-status-attention` from 80 and `stroke-danger` from 95; with `size: 0` there is no `svg` and the text is "12K tokens". The `aria-valuenow` and label assertions stay. Invert the old "svg is null" assertion for the known-window case.
- [ ] **Step 2: Implement.** Draw the ring inside the meter element (`aria-hidden`), `gap-1.5` before the words; `mr-2` → `mr-1.5`. The tone thresholds are the ones the words use today; name the circumference as a constant. The details popover takes `rounded-panel` in place of `rounded-lg`. The unknown-window branch is not touched.
- [ ] **Step 3:** Run both test files; commit `feat: draw the context meter as a ring`.

### Task 8: Menus

**Files:** `ui/Popover.tsx`, `composer/OptionDropdown.tsx`, `composer/SlashCommandMenu.tsx`, `composer/MentionMenu.tsx`; tests `popover-rows.test.tsx`, `composer-menus.test.tsx`, `option-dropdown.test.tsx`, `composer-menu-fixes.test.tsx`, and any mention-menu test that pins row classes.

**Artboard values:** row min-height 28, padding `5px 8px`, gap 8, radius 6, 13px; check 14px; description 11/15 `fg-subtle`; selected `surface-hover` with the name in `fg`, other names `fg-secondary`; mode menu 260px, model menu 300px; search 28px; count line `6px 8px 4px`, 11px `fg-muted`; slash name mono 12px, `fg` when highlighted, else `fg-secondary`.

- [ ] **Step 1: Update the tests first:** `PopoverOption` rows `min-h-7`, two-line rows `py-[5px]`; an unselected row's name is `text-fg-secondary`, a selected or highlighted one `text-fg`; a menu with a heading and descriptions that is not searchable is `w-65`; the count line is `text-fg-muted pb-1`; with "son" typed, the first visible row has `bg-surface-hover` and `data-highlighted`, the current model keeps its check, and with an empty query no row is highlighted; slash rows are `rounded-md py-[5px]` with `text-fg-secondary` names except the highlighted one.
- [ ] **Step 2: Rows.** `PopoverOption` serves every menu in the app (the sidebar's session and new-session menus, the top bar, Settings' default-agent picker, the diff header, the folder and branch pickers, the agent catalog), so split the change in two. For every row: `min-h-7.5` → `min-h-7` and `py-1.75` → `py-[5px]`, which the spec's popover panel asks for everywhere ("one-line rows 28px"). Only for a pick list, meaning a caller that passes the `selected` prop at all: the name is `text-fg` when `selected || highlighted` and `text-fg-secondary` otherwise. An action row, which never passes `selected`, keeps `text-fg`. Add an optional `highlighted` prop that paints `bg-surface-hover` and sets `data-highlighted`. Run `popover-rows.test.tsx`, `top-bar.test.tsx`, `navigation.test.tsx` and `session-row.test.tsx` to confirm the other menus still pass; fix a height assertion there if one pinned 30px, and say so in the PR.
- [ ] **Step 3: Widths.** Keep `w-75` for the searchable model menu. Give the described, non-searchable menu (modes) `w-65`. A plain menu keeps `w-max min-w-40 max-w-80`. Confirm `w-65` resolves to 260px in this Tailwind setup; if not, use `w-[260px]`.
- [ ] **Step 4: Search.** The count line: `text-fg-subtle` → `text-fg-muted`, `pb-0.5` → `pb-1`. In `SearchableOptions`, pass `visible[0]?.value` down as the highlighted value only while `query.trim() !== ""`; `OptionRows` and `OptionRow` hand it to `PopoverOption`. Return's own logic is not changed.
- [ ] **Step 5: Slash and mention rows.** `rounded` → `rounded-md`, `py-1.75` → `py-[5px]`; names not highlighted become `text-fg-secondary`. Apply the same three changes to the mention menu's rows and nothing else there (Decision 4).
- [ ] **Step 6:** Run the test files; commit `feat: bring the composer's menus to the v2 row and mark the first match`.

### Task 9: Docs and checks

- [ ] **Step 1: Docs.** Update the design-system pages and previews for the components this phase changed (message row, tool calls, cards, composer chip, context meter, toast, popover option), in `docs/design-system/`. `design-system-docs.test.ts` must pass. No token changes are expected; if one is needed, change `globals.css` and `tokens.json` together.
- [ ] **Step 2: Changelog.** One or two lines under `Unreleased` in `CHANGELOG.md`.
- [ ] **Step 3: Checks.** `pnpm lint`; then the targeted tests of every task, plus `sheet-fills.test.ts`, `design-tokens.test.ts`, `theme-contrast.test.ts`, `tools-part-rerender-cost.test.tsx`, `tool-call-list-diff-cost.test.tsx`. Grep `src/test` for the old classes (`h-[34px]`, `ml-[76px]`, `max-w-[85%]`, `ring-status-running/20`, `h-7.5`, `py-1.75`) to catch a test the plan did not name.
- [ ] **Step 4: Self-review** the whole diff against `main`: every "stays" item of Global Constraints is still rendered; no component of phase 5 or 7 changed beyond Decision 4; no test was deleted to make it pass.
- [ ] **Step 5: Push and PR.** Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, never skipping the pre-push hook. Open a PR against `main` whose body lists the four Decisions and any departure from this plan. Do not merge.

**Not in this plan's steps:** the in-app check against the artboards in both themes. The orchestrator does it after the PR is open, with a seeded transcript that holds tool calls, a failed turn and a permission request.
