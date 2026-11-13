# Redesign v2, phase 5: draft, compare run and states — Implementation Plan

**Goal:** The new-session draft shows its agents as tiles you tick, the compare run becomes side-by-side columns with each agent's files, last message and open request, and the blocker cards, update notice and sign-in dialog take the v2 look.

**Architecture:** Unlike phases 2 to 4, this phase adds behaviour. Three pure helpers carry it (`shownTiles`, `columnFiles`, `lastAgentText`) and are unit-tested; two new components draw it (`AgentTiles`, `CompareColumn`). `useCompareDraft`, the pick rules, the run's start and Pick logic, every hook and every Tauri command stay as they are: the tiles call the same `onChange` and `onPick` the popover calls today.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, sections "New-session draft", "Compare run" and "Blockers, empty state, update notice, dialogs", with rows 1, 4 and 6 of its defaults table. Artboards: `Home`, `DraftPickers`, `Compare`, `DraftBlockers`, `EmptyUpdate`, `SignInDialog`. Built on phase 4 (PR 201).

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. New strings, exactly, as the spec names them: "New session" (the draft's heading), "Agents", "Tick two or more to compare them.", "All agents", "Last message", "Waiting for your answer", "Open to answer", "1 more file" / "N more files". Every other string stays, including the Qwen Code setup card's text (default 6) and the install sentence with its versions and sizes.
- What the artboards do not draw stays: the unavailable-folder line, the folder menu, the worktree switch, the popover's hold-back lines ("You can compare up to 4 agents.", "Set up <Agent> first."), "Continue a session", the failed state of the sign-in dialog, Review on a compare column's numbers, the run's notices.
- No rule of `useCompareDraft` changes: the limit stays `MAX_COMPARE_AGENTS` (4), a blocked agent cannot be ticked, the last ticked agent cannot be unticked, and outside a repository there is one agent.
- 30px in an artboard means today's 28px control. No new `Button` or `IconButton` size or variant.
- No raw colors. `DRAFT_CHIP` goes away, so `sheet-fills.test.ts` loses its exemption for `chip-style.ts`.
- Nothing under `src-tauri/**` changes; `tauri-contract.test.ts` passes unchanged. Run targeted Vitest files only. Stage explicit paths.

## Decisions taken in this plan

1. **Which four tiles show.** The first four agents in use, in their order. A ticked or picked agent outside those four takes the place of the last tile that is not ticked, so what is chosen is always on screen. (The spec's default 4 says only "the first four".)
2. **Outside a repository** the tiles still show; a press picks that one agent, nothing is ticked, and the hint "Tick two or more to compare them." is not shown.
3. **Four columns sit two by two.** At the panel's 1040px, four columns would leave one alone under three; a run of four uses two columns. Two and three agents sit in one row.
4. **A request's buttons in a column carry the agent's own option names**, as the permission card does today (an agent may say "Reject" for Deny). Only the allow-once and the reject option show there; "Always allow" stays in the session.
5. **Open and Pick are both outline buttons** of equal width; Open reads in `fg-secondary`. The artboard's quieter edge on Open would need a new `Button` variant.
6. **Two container tokens**: `container-draft` (720px) and `container-compare` (1040px), in `globals.css` and `tokens.json`.
7. **The draft's chips move into the heading row through a slot**, as the blocker cards already do (`aboveCardSlots`), so the composer keeps one "open menu" state for all its menus.

## Review Focus

1. **The tiles and the popover must agree.** Both read the same `options` and call the same `onChange` / `onPick`; a test ticks in one and reads the other.
2. **A press that cannot tick says why.** A full set gives the unticked tile the limit sentence as its description and does nothing; a blocked tile picks alone, which opens its install or sign-in card.
3. **A column's request answers the right session.** `onChoose(sessionId, cardId, optionId)` is the call `CompareRunRow` makes today; a question or a form never gets buttons, only "Open to answer".
4. **Text from an agent.** The last message and a request's one line go through `escapeVisible` and are clamped; they are never markdown.
5. **Equal columns.** The file list reserves three rows and the "more" line, so "Last message" starts at the same height in every column.
6. **The many tests that find the Agent chip by name.** About seventy uses across `compare-run-start`, `compare-composer`, `compare-run-sign-in`, `agent-install` and others. They move to the tile or to "All agents"; none is deleted.

## Tasks

### Task 1: Tokens and the draft's chips

`globals.css`, `tokens.json`, `composer/chip-style.ts`, `FolderPicker.tsx`, `BranchPicker.tsx`, `ComposerDock.tsx`, `sheet-fills.test.ts`; tests `draft-chips`, `draft-layout`, `design-system-docs`.

- Add `--container-draft: 720px` and `--container-compare: 1040px` with their `tokens.json` entries.
- Delete `DRAFT_CHIP`; the folder and branch chips use `COMPOSER_CHIP` (26px, radius 6, `chip` fill). Remove `chip-style.ts` from `KEEPS_OLD_SURFACES`. The worktree switch's knob becomes `bg-surface-3`.

### Task 2: Draft column and heading

`workspace/NewSessionView.tsx`, `App.tsx`, `ComposerDock.tsx`, `composer/DraftChips.tsx`; tests `draft-layout`, `new-session`.

- Column `max-w-draft`, top padding 64px (the growing offset goes), 20px between blocks. A draft's composer footer uses the same width.
- Heading "New session" in a wrapping row with a slot at its right; `ComposerDock` portals `DraftChips` into it. The unavailable-folder line stays under the heading.
- The compare note moves from the control row to a line under the card.

### Task 3: Agent tiles

New `lib/agent-tiles.ts` (`shownTiles(options, chosenIds, limit = 4)`), new `composer/AgentTiles.tsx`; `AgentMultiPicker.tsx`, `ComposerDock.tsx`, `App.tsx`; tests `agent-tiles` (new), `agent-picker`, `compare-composer`, `compare-run-start`, `compare-run-sign-in`, `agent-install`, `agents-in-use`, `auth-scope`, `review-message`, `new-session`.

- `shownTiles`: Decision 1, as a pure function with unit tests (fewer than four agents, a chosen agent outside the four, several outside, all four ticked).
- The row: "Agents" (12px, 500, `fg-secondary`), the hint (11px, `fg-subtle`, only where ticking is possible), "All agents" at the right (a ghost 24px button that opens today's popover).
- A tile is a button: min-height 48px, padding 8px 12px, gap 10, radius 10, a `border` edge; a 22px `AgentTile`, the name (13px), and a status line (11px `fg-muted`, with a 6px dot: `status-running` for Ready, `status-attention` for Sign in, none for Not checked or Not installed). Ticked: `aria-pressed="true"`, `border-strong`, `surface-2`, the name at 500 in `fg`, a 14px check at the right. Blocked: no `aria-pressed`, a muted chevron-right at the right, named "<Agent>, sign in first" or "<Agent>, install first".
- Press: a blocked tile, or any tile while the only ticked agent is blocked, calls `onPick`; otherwise `onChange` where ticking is possible and `onPick` where it is not. A full set gives an unticked tile `LIMIT_REASON` as its description and does nothing.
- The popover: rows 28px with radius 6, a 16px `AgentTile`, a dot for Ready too, ordered runnable, then needs sign-in, then not installed (stable). Its trigger is the "All agents" button.
- The single-agent `OptionDropdown` chip in the draft goes; `App.tsx` passes the agents with whether ticking is possible.

### Task 4: Compare run columns

New `lib/compare-column.ts` (`columnFiles(stats, limit = 3)` → `{ shown, more }`, most changed first, ties by path; `lastAgentText(messages)`; `columnRequest(facts)` → `plain` with its one line and two options, `open`, or none), new `compare/CompareColumn.tsx`; `CompareRunPanel.tsx`, `CompareRunRow.tsx` (replaced), `lib/compare-run.ts`; tests `compare-column` (new), `compare-run-look`, `compare-run-panel`.

- Panel: padding 36px 28px 120px, `max-w-compare`, 24px between blocks; a grid of columns 12px apart, `auto-fit` with a 280px minimum, two columns for a run of four.
- Column (`surface-2`, radius 12, padding 16, gap 14, `border-strong` while it is being picked): a 28px `AgentTile`, the name (14px, 600), the status words; the total (the Review button, as today) and up to three files (24px, mono 11px, counts in `status-running` and `danger`) and "N more files", with empty rows reserved; "Last message" over three clamped lines in `fg-secondary`; at the bottom Open and Pick, equal widths.
- An open request replaces "Last message": "Waiting for your answer", then for a plain permission a one-line box on `ground` (the command, else the edited paths, else the prompt) with the reject and allow-once buttons (26px) under it; for a question or a form one prompt line, and Open reads "Open to answer".
- Confirm bar: 20px above the bottom, at most 640px, padding 12px 12px 12px 16px; the question at 600 over the stops line in `ui-sm` `fg-muted`.

### Task 5: Blocker cards, update notice, sign-in dialog

`ui/BlockerCard.tsx`, `AgentInstallPanel.tsx`, `RemovedAgentPanel.tsx`, `AuthPanel.tsx`, `AppUpdateNotice.tsx`, `TerminalSignInDialog.tsx`; tests `ui-primitives`, `agent-install`, `auth-panel`, `app-update`, `terminal-sign-in`.

- `BlockerCard`: padding 16, no shadow, a 28px `AgentTile`, title block 2px apart, an `action` at the header's right, and a slot under the header for the install bar. Install and Add move to the header; Cancel moves there while installing, with the 4px bar under the header.
- `AuthPanel`: Dismiss in `fg-secondary`; nothing else.
- Update notice: `rounded-panel` and an accessible name. It stays in the toast stack.
- Sign-in dialog: a 22px `AgentTile` in its header; the terminal box radius 6.

### Task 6: Docs and checks

Design-system pages (Composer, BlockerCard, the compare run), a `CHANGELOG.md` line, `pnpm lint`, the targeted tests plus `sheet-fills`, `design-tokens`, `theme-contrast`, `design-system-docs`, `tauri-contract`; grep `src/test` for `Agent: ` and `DRAFT_CHIP` leftovers; self-review; push; a PR against `main` listing the seven decisions. The in-app check is done after, with phases 3 and 4.
