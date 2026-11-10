# Redesign v2: layered and calm

Date: 2026-11-11. Status: look approved on the canvas; this written spec awaits review.

Mockups: the Design canvas "Zorvo redesign v2" (https://claude.ai/artifact/NkShdh56RavBM73MEb9WbU), direction A, 43 artboards. Local copies for agents that cannot open the canvas: `docs/superpowers/specs/2026-11-11-redesign-v2-artboards/*.dc.html` (same file names as the canvas; refresh them when the canvas changes).

This spec replaces the look of `2026-11-04-main-window-redesign-design.md` and `2026-11-04-onboarding-settings-redesign-design.md`. Their behaviour rules stay unless a section below changes them.

## Goal

Make Zorvo nicer to look at and easier to use without changing its brand: give the window depth so its areas read as separate, put the agents in front where the user chooses them, and make "which session needs me" answerable from the sidebar.

## Scope

In: the window shell, sidebar, top bar, chat, composer and menus, inspector, full diff review, new-session draft, compare run, blocker cards and dialogs, Settings, onboarding, and the Delegate screens.

Out, each with its own later plan:

- **Private mode.** Its eleven artboards are drawn, but the hackathon branch keeps the old canvas until its deadline (2026-11-14).
- **Settings → MCP servers.** The app has only the dimmed "Soon" item and no backend. `SettingsMcp.dc.html` is the look for when its backend spec lands.
- Keyboard shortcuts and voice input (declined earlier), and any new agent or backend capability. This redesign needs no new Tauri command.

## Decisions

| Topic | Decision |
| --- | --- |
| Direction | A, "layered and calm": the sidebar sits on the window ground; chat and inspector are raised sheets. Direction B (dense workbench) was not chosen. |
| Brand | Unchanged: monochrome zinc, color only for state and always beside a word or icon, SF Pro for UI, Geist Mono for code, weights 400/500/600, one filled primary action per view. |
| Earlier rulings that stay | The agent is a static label in a running session's composer; message actions are a plain icon row; branch and PR chips are borderless; chips use radius 6; the terminal is an inspector tab that widens to 560px. |
| New in v2 | Sheets; an agent tile with a status badge in every session row; a sidebar filter; agent tiles in the draft; compare columns side by side; a segmented control in place of underline tabs. |

## How to read the artboards

- **The artboard decides the look** (sizes, tokens, structure). **This text decides behaviour and copy.** Where they differ, this text wins and the difference is listed under "Canvas corrections".
- **Letter tiles (C, X, Q, G) are stand-ins.** The app draws the real `AgentLogo` inside the tile.
- **A function the artboards do not draw stays, restyled.** This is the rule from the 2026-11-05 audit. It covers, at least: the Close buttons of the inspector and the diff view, Refresh in Changes and Files, the close X on terminal tabs, Details and Dismiss on the failed-turn notice, the Dismiss X on an elicitation card, Read aloud, Rewind on user messages only (with its current icon), Delete on a saved comment, the pull-request list, the Activity filters, Check again in onboarding, Run setup again in Settings, the "Registry checked" line, the PR checks mark, the comment count in the diff chip, the Delegate items of the More menu, and the Terminal tab's empty and exited states.
- **Copy and `aria-label`s stay as they are in the app**, except the strings this spec names. The artboards' labels are drafts.
- **30px in an artboard means today's 28px control.** Card buttons stay `Button` `md`; Send and Stop stay at `size-control`. No new button size.
- The artboards' `@media (max-width: 900px)` rule is for the canvas only. The app keeps `isCrowded`.

## Visual foundations

Change `src/styles/globals.css` and `docs/design-system/tokens.json` together.

| New token | Dark | Light | Use |
| --- | --- | --- | --- |
| `ground` | `#0a0a0b` | `#f4f4f5` | The window behind the sidebar and the sheets; code boxes and inputs that sit on a sheet. |
| `sheet` | `#111113` | `#fafafa` | Chat, inspector, diff review, the Settings content, the onboarding card. |
| `chip` | `rgba(255,255,255,0.06)` | `rgba(9,9,11,0.05)` | Fill of composer and draft chips, agent tiles, segmented tracks, small tags. |
| `radius-panel` | `10px` | `10px` | Sheets, menus, popovers, toasts. |

- In dark, `ground` and `sheet` equal today's `bg` and `surface-1`; in light the two are swapped, which is why they are new tokens and not aliases. `bg` and `surface-1` keep their values. Each phase moves its own area to the new tokens; the last phase lists what still uses the old two.
- Layer order on a sheet: cards, inputs and the composer `surface-2` with a `border` edge and radius 12; menus and popovers `surface-3` with `border`, `radius-panel` and `shadow-popover`; dialogs `surface-2` with `shadow-dialog` over `overlay`.
- `theme-contrast.test.ts`: add `ground` and `sheet` to the surfaces; check text on `chip` by flattening it over `sheet` and over `surface-2`.

New primitives in `src/components/ui/`:

- **`Segmented`**: a track (`bg-chip`, radius 8, 2px padding, 2px gap) of 26px buttons (10px side padding, radius 6, 12px `fg-muted`; selected `surface-hover` with `fg`; hover `fg`). It serves three roles: tabs (`Tabs` renders through it, keeping its roles and arrow keys), a radio group (Appearance), and a toggle group. `Tabs` is used only by the inspector today.
- **`AgentTile`**: a rounded square with `chip` fill and an inset 1px `border` ring, holding the agent's logo or an icon. Sizes 16 (radius 4), 22 (radius 6) and 28 (radius 8). It can carry a status badge: an 8px dot at its lower right with a 2px ring in the color behind the tile.
- **Popover panel**: `radius-panel`, 4px padding; rows radius 6, one-line rows 28px.

## Window shell

Artboard: `Main`.

- The root paints `ground`. The sidebar is 264px wide (`SIDEBAR_WIDTH` in `lib/inspector.ts`), sits on the ground and loses its right border; its footer loses its fill and top border.
- The rest is a stage: `display: flex`, 8px gap, padding 8px on the top, right and bottom and 0 on the left (8px while the sidebar is hidden).
- **Chat sheet**: `sheet` fill, `border`, `radius-panel`, clipped. The top bar (48px, bottom hairline) moves inside it, above the chat.
- **Inspector sheet**: a sibling of the chat sheet, full height, with its own 48px header. It no longer starts under the top bar.
- The diff view shares the chat's sheet, under the same top bar: beside the chat it is separated by a hairline, and in the chat's place it fills the sheet. It stays one element in one place, so Expand and Shrink never remount it.
- **Window drag**: the stage's 8px strips become drag regions, next to the sidebar header and the top bar.
- **Traffic lights**: the sidebar header and the top bar share one center line, 32px from the window's top (8px inset plus half of 48px). Place the native lights on that line with the window's traffic-light position if Tauri 2.12 supports it; otherwise size the sidebar header to the lights. Check both the sidebar-shown and sidebar-hidden states in the running app. The 78px inset of the hidden-sidebar top bar stays.
- **Popout windows**: `ground` root with one sheet inset 8px, the top bar inside it.
- `isCrowded` counts the 264px sidebar and the 16px of insets.
- **Nothing may vanish.** Everything that paints `surface-1` on the chat today disappears on a sheet. Phase 1 repaints, at least: the tool group, the reply hover fill, the stalled-agent notice, markdown code blocks, the image preview dialog, the file list of the diff review and the inspector's panel roots.

## Sidebar

Artboards: `Sidebar`, `SidebarStates`, and the sidebar of `Main`.

**Top.** A 32px row: **New session** (fills the row, `surface-2`, `border`, radius 8, weight 500) and a 32px **Search sessions** icon button. Pressing Search swaps this row for the search field (same height, focused, with a close X); Escape or the X closes and clears it. The query logic is unchanged.

**Filter.** Three toggle buttons under the top row: **All**, **Needs you** with its count in `status-attention`, **Working** with its count.

- *Needs you* = sessions waiting for you (permission, question, sign-in) plus sessions that finished unread. *Working* = busy sessions; the members of a compare run count one each.
- A filter hides folders with no match and applies to Pinned. Archived shows only under All. Forks stay under a matching parent, as search does today.
- An empty result reads "No sessions need you." or "No sessions are working."
- The inputs exist: `statusOf` and `RowStatus.tone` in `lib/sidebar-status.ts`; the filter is a second predicate beside the search's `filterNodes`.

**Session row.** Padding 7px 8px, radius 8, 10px gap; selected fill `surface-hover`.

- Left: a 22px `AgentTile` with the badge: `status-attention` waiting, `status-running` working, `status-unread` finished unread, none when idle. The dot does not pulse.
- Line one: the title, with today's weight and color rules.
- Line two: "Agent · Status words", with today's worktree mark, "· fork" and "· delegated". An idle row shows only the agent there.
- An idle row's time moves to the right of line one, 11px `fg-subtle`, in a short form ("2 h ago", "Yesterday", "Oct 28"), from the same timestamp as today.
- On hover or focus, the Stop and More buttons (22px) take the time's place.

**Folder header.** Folder icon, name, and the folder's session count in `fg-subtle`; **+** and the fold chevron (22px) on hover. A folded folder keeps today's summary.

**Compare run row.** A tile with the columns icon and the badge of the run's most urgent state; the title is the run's task (`CompareRun.name`); line two reads "Compare · 2 working, 1 finished". The agent count moves to the tooltip. This reverses the phase 8a ruling that hid the task.

**Forks** sit on a rail: 18px left margin, 8px padding, 1px `border`.

**Footer.** Same content as today. The Agents button stacks 16px tiles; its menu follows `SidebarStates` (tile, name, the sign-in word with its dot, a **Sign in** button where needed, then "Manage agents").

## Top bar

Artboards: `TopBar`, `TopBarPopovers`.

- A breadcrumb before the title: the folder in `fg-muted`, a slash in `fg-subtle`, then the title (13px, weight 600). A compare run takes its folder from its first session and adds "Compare · N agents" with the columns icon. A draft reads "folder / New session" and shows no branch chip.
- Padding 0 10px 0 18px, 10px gap.
- The Plan, background-task and diff chips are 28px tall with 12px text, a `border` edge and radius 6; open is `surface-hover` with `border-strong`.
- The Plan, background-task and More popovers take the new popover panel.

## Chat

Artboards: `Main`, `ChatStates`, `ChatCards`, `SmallStates`.

- Column: 680px, padding 28px 24px 16px, 22px between blocks.
- **User message**: the bubble's `max-width` becomes 80%.
- **Agent message**: a 22px `AgentTile`, the name in 12px weight 500 `fg`, the time in 11px `fg-subtle`; the hover fill becomes `surface-2`. The action row keeps its buttons at 28px.
- **Tool calls** lose their card. A ghost summary button (28px, chevron, 12px `fg-secondary`, with "1 still running" beside it), then the steps on a rail (7px left margin, 1px `border`). Each step is 28px: icon, verb (44px, `fg-muted`), mono 11px path, then the result word or the counts; an edited file's path is `fg`, and a new file shows "New" before its counts. A running step shows the `status-running` arc in the icon's place and "Running" at the right. An opened command's output stays the terminal block, indented 36px under its step.
  - Keep the cost design: `ToolsPart` memoised by tool identity, `ToolCallRow` memoised, the list mounted only while open, details out of the DOM until a row opens. Derive "New" inside the existing counts memo. `tools-part-rerender-cost.test.tsx` and `tool-call-list-diff-cost.test.tsx` must pass unchanged.
  - The summary's wording stays `summarizeTools`. The verbs stay as they are.
- **Working line**: the dot's halo uses `chip`.
- **Failed turn and stalled agent**: a card (radius 12, padding 12px 12px 12px 16px) with the first sentence of today's text as a title in weight 600 and the rest as a `fg-muted` sentence. No new copy. The failed card is `danger-surface` with a `danger` edge on all sides; the stalled card is `surface-2`.
- **Permission card**: padding 14px 16px, a 14px icon, and "Waiting for you" in 11px `fg-muted` at the right of the title row while the request is open. Deny is a ghost button in `fg-secondary`.
- **Elicitation card**: the title uses a 22px tile.
- **Reply toolbar, toasts, image preview**: the new popover panel; the preview dialog is `surface-2` with its name, size and close on one row.

## Composer and menus

Artboards: `Main`, `ChatStates`, `ComposerMenus`.

- The card is unchanged (`surface-2`, radius 12, 12px padding, `shadow-popover`).
- The agent label: a 16px tile and the name in 12px `fg-secondary`.
- Controls are chips: 26px, radius 6, `chip` fill, a 12px `fg-muted` chevron; open is `surface-hover` with `fg`. `MAX_INLINE_CONTROLS` stays 3.
- **Context meter**: a 14px ring (track `surface-hover`, arc `fg-muted`, the arc taking the warning tones the words take today) before the words. It stays a meter inside the button that opens its details. With an unknown window size it shows the count and no ring.
- Menus: the mode menu is 260px wide, the model menu 300px; the search field is 28px; the first match of a model search shows the hover fill, since Return picks it.

## Inspector

Artboards: `InspectorChanges`, `InspectorActivity`, `InspectorFiles`, `InspectorFileView`, `InspectorTerminal`.

- **Frame**: a sheet. The widths (380 default, 560 for Terminal and the file viewer, 320 to 720 by drag) now include its border. The resize handle moves to a wrapper the sheet's clipping does not cut; its hit zone lies in the 8px gap.
- **Header**: 48px, the tabs as a `Segmented` track at the left, Close at the right.
- **Changes**: padding 14px, 10px gaps. Every file row is a `surface-2` card (radius 8): a 14px checkbox, the kind letter in mono `fg-muted`, the path, the comment count, the counts, and the chevron last. Diff rows keep today's gutters. The comment box has a `border` edge and a `ground` field; a saved comment is a `surface-2` card with its buttons right-aligned under the text. The comments bar sits at the bottom of the scroll area. The commit area keeps today's structure: the message field and a full-width primary "Commit N files".
- **Activity**: the unreported-files card is an attention card (radius 12) with its paths in a `ground` code box; its two explanatory lines stay. The filters become a `Segmented` control. Rows show what they show today.
- **Files and file view**: 28px header buttons; the filter field is 32px with a `border` edge; the breadcrumb separates its parts; the code well is `ground`; the add-lines popover takes the new panel.
- **Terminal**: unchanged apart from the sheet's corners; its empty, starting and exited states move to `sheet`.

## Full diff review

Artboard: `DiffReview`.

- It sits on the chat's sheet (see "Window shell"); the artboard shows it filling that sheet, without the top bar above it. Header padding 0 10px 0 12px.
- The file list loses its fill (it sits on the sheet).
- The sections stay a stack of collapsible files; each header is 36px with the full path in mono 12px.
- The comments bar floats: a `surface-3` popover card centred 16px above the bottom, with the primary "Add N comments to message". Its other lines (Clear sent, the reason, gone and elsewhere lists) stay inside it. The scroller gets 80px of bottom padding.

## New-session draft

Artboards: `Home`, `DraftPickers`.

- Column 720px, top padding 64px, 20px gaps.
- **Heading row**: "New session" (20/28, weight 600) with the folder and branch chips at its right. The chips are 26px `chip`-filled chips and move out of `ComposerDock`.
- **Agents row**, new, between the heading and the composer: "Agents", the hint "Tick two or more to compare them.", and an **All agents** button.
  - Up to four tiles: the first four agents in use, in today's order. Each tile (48px minimum, radius 10, `border`) shows a 22px `AgentTile`, the name and the sign-in word with its dot: Ready (`status-running`), Sign in (`status-attention`), Not checked (no dot), Not installed.
  - A ticked tile has a `border-strong` edge, `surface-2` fill and a check; it is a toggle (`aria-pressed`). Ticking follows today's rules: at most `MAX_COMPARE_AGENTS`, one always ticked, a blocked agent cannot be ticked.
  - A tile that needs a sign-in or an install is not a toggle: pressing it picks that agent alone, which opens its sign-in or install card, as the picker's name button does today.
  - Outside a repository the tiles pick one agent.
  - **All agents** opens today's list as a popover (380px): one row per agent with its checkbox, 16px tile, name and status; runnable agents first, then those that need a sign-in, then not installed. Its header, footer and hold-back lines keep today's copy.
- **Composer**: per-agent model chips as today, restyled. `COMPARE_NOTE` moves under the card.
- The blocker cards keep their place above the composer, under the Agents row.
- **Continue a session** list: 44px rows, radius 8.

## Compare run

Artboard: `Compare`.

- Column 1040px; the cards form a grid, `repeat(auto-fit, minmax(min(280px, 100%), 1fr))`, 12px gap, equal heights. A fourth agent wraps to a second row.
- **Card** (`surface-2`, radius 12, 16px padding, 14px gaps; `border-strong` while it is the one being picked):
  - a 28px tile, the name (14/20, weight 600) and the status words (12px `fg-muted`, a check for Finished);
  - the total "N files +A −R" as the button that opens the review, then up to three files with their counts, most changed first, then "N more files"; the states "No changes yet" and "—" stay. `session_diff_stats_since` already returns each file;
  - "Last message" with the agent's newest message as plain text through `escapeVisible`, clamped to three lines;
  - **Open** and **Pick** at the bottom, each half the width.
- **An open request** takes the place of "Last message", under the label "Waiting for your answer":
  - *A plain permission* (a command to run, files to edit; a card with no questions and no form): the command or the file list in a `ground` code box (mono 11px, one line, cut with an ellipsis), then **Deny** (ghost) and **Allow once** (outline, `border-strong`), 26px, right-aligned. They answer through the same `onChoose` path as today's card. "Always allow" and any other option stay in the session, behind Open.
  - *Anything else* (Qwen Code's questions, an elicitation form): one line of the request's own prompt, and the footer's Open reads "Open to answer" with the strong edge. It is answered in the session.
  - Allow once is not filled here: several columns can ask at once, and the confirm bar holds the view's one primary button.
- **Confirm bar**: a `surface-3` card (radius 12, at most 640px) with the question in weight 600 and the stops line in 12px `fg-muted` under it; Cancel and the primary "Pick {agent}".

## Blockers, empty state, update notice, dialogs

Artboards: `DraftBlockers`, `EmptyUpdate`, `SignInDialog`.

- **Blocker card**: `surface-2`, radius 12, 16px padding, no shadow. Its header row holds a 28px tile, the title and sentence, and the card's main action at the right. Install progress: Cancel in the header row, the 4px bar across the card under it.
- **Sign-in card**: the method list as today; "Check again" is an outline button. All copy stays.
- **Empty state**: unchanged apart from the sheet.
- **Update notice**: `radius-panel`, an accessible name; it stays in the toast stack.
- **Terminal dialog**: `surface-2`; a 22px tile in its header; the terminal box radius 6.

## Settings

Artboards: `SettingsGeneral`, `SettingsAgents`, `SettingsAppearanceGithub`.

- **Frame**: the nav (240px, items 30px with radius 8, the current one `surface-hover`) sits on the ground with no border; the content is one sheet inset 8px, padded 48px 40px, its column 720px wide.
- **Groups** stay `surface-2` cards with no clipping; row descriptions become 12px `fg-muted`.
- **Appearance**: a `Segmented` radio group (System, Light, Dark) replaces the three preview tiles; "follows your Mac" shows beside it while System is selected.
- **Agents**: 28px tiles; the sign-in chip is `chip`-filled with the word in `fg-secondary` and a dot in every state (`status-running`, `status-attention`, `fg-subtle`); an opened row has no tint and its method list is `sheet`-filled. All copy stays.
- **GitHub**: unchanged apart from tokens; the heading stays "Connection" and the avatar keeps initials.

## Onboarding

Artboard: `Onboarding`.

- The page paints `ground`; the content is one centred sheet (640px, radius 12, 32px padding) that still scrolls when tall.
- The page title is 20/28, weight 600.
- Agent rows: padding 10px 14px, a 22px tile, the name in weight 500, and **the tick at the right**, after the row's buttons.
- Row words, Check again, and the hover-only Make default stay as they are. The artboard's "Open setup" button and its percent progress are not built.

## Delegate

Artboards: `DelegateMenu`, `DelegateDialog`, `DelegateSource`, `DelegateTarget`, `DelegateReport`, `DelegateMention`.

- The More menu and the mention list take the new popover panel; mention rows are 28px with 16px tiles.
- **Dialog**: `surface-2`; the title in 14/22 weight 600; agent rows with 22px tiles; "Needs sign-in" in `fg-muted` beside an attention dot; the task field `ground`-filled; chips as in the composer.
- **Status line** in the source session: 13px `fg-muted` with the running arc; Open is a ghost button.
- **"Delegated from" line**: a leading icon, 12px `fg-muted`.
- **Report**: the header takes the 22px tile; the bubble follows the user bubble.
- **Failed and needs-your-answer** become cards (radius 12, padding 10px 12px): `danger-surface` with a `danger` edge, and `attention-surface` with `attention-border`, each with a weight-600 title and an outline **Open**.

## Defaults taken where the canvas is silent or disagrees

Each is this spec's call until the user says otherwise.

| # | Topic | Default |
| --- | --- | --- |
| 1 | An open request in a compare column | Decided by the user on 2026-11-11: a plain permission keeps Deny and Allow once in the column; questions and forms get "Open to answer". |
| 2 | "Needs you" | Waiting for you plus finished unread. |
| 3 | The open search field | It replaces the New session row until closed. |
| 4 | Which draft tiles show | The first four agents in use; the rest under All agents. |
| 5 | Data the app does not keep | A command's exit code and duration, counts on Activity rows, search result counts and a "Stopped" Activity row are not shown. |
| 6 | Qwen Code setup card | Today's copy, which names no providers. |
| 7 | Commit area | Today's structure, as `InspectorChanges` draws it. |
| 8 | Tool summary and verbs | Today's wording. |
| 9 | Image preview overlay | Covers the window, as today. |

## Canvas corrections

Artboards to bring in line with this text when the canvas is next edited: the commit area in `Main` (outline "Commit" and "3 of 3 files"); the "Needs you" count in `Sidebar` and `SidebarStates`; the tool summaries ("Read 2 files, edited 2"); "Exit 0 · 2.1 s" in `ChatStates`; the Activity rows with counts, results and "Stopped"; the action row under an agent message in `ChatCards` (Rewind there, no Read aloud); "Add 2 to message" in `DiffReview`; "Open setup" and the percent progress in `Onboarding`; the provider names in `DraftBlockers`; the person icon in the GitHub row; the missing Close, Refresh and Dismiss buttons listed above.

## Phases

One pull request each; the app stays usable after every one. A phase's plan is written when the phase starts, quotes the artboard's values for each element, and ends with a side-by-side check of the running app against the artboards in both themes.

| # | Phase | Artboards | Main code | Tests that pin today's look |
| --- | --- | --- | --- | --- |
| 1 | Foundations and shell: tokens, `Segmented`, `AgentTile`, popover panel, the stage and sheets, drag regions, traffic lights, popout, the "nothing may vanish" pass | `Main` | `globals.css`, `tokens.json`, `ui/*`, `App.tsx` layout, `Sidebar.tsx` and `Inspector.tsx` frames, `DiffView.tsx` frame, `PopoutApp.tsx`, `lib/inspector.ts`, `tauri.conf.json` | `design-system-docs`, `theme-contrast`, `chrome-wiring`, `top-bar`, `profile-footer`, `inspector-frame`, `inspector-layout`, `use-inspector`, `ui-primitives`, `popover-rows`, `popout` |
| 2 | Sidebar and top bar | `Sidebar`, `SidebarStates`, `TopBar`, `TopBarPopovers` | `Sidebar.tsx`, `sidebar/*`, `lib/sidebar-status.ts`, `ProfileFooter.tsx`, `TopBar.tsx`, `topbar/*` | `navigation`, `session-row`, `sidebar-compare`, `sidebar-status`, `top-bar` |
| 3 | Chat and composer | `ChatStates`, `ChatCards`, `ComposerMenus`, `SmallStates` | `chat/*`, `ActionCard.tsx`, `FailedTurnBanner.tsx`, `lib/turn-error.ts`, `lib/agent-stall.ts`, `ComposerDock.tsx`, `composer/*`, `ui/Toast` | `tool-card`, `tools-part`, `chat-states`, `chat-messages`, `chat-column`, `chat-cards`, `elicitation-card`, `composer-card`, `composer-details`, `composer-dock`, `composer-menus`, `option-dropdown`, `image-preview-dialog` |
| 4 | Inspector and diff review | the five `Inspector*`, `DiffReview` | `inspector/*`, `changes/*`, `activity/*`, `FilesPanel.tsx`, `files/*`, `terminal/*` | `changes-tab-look`, `activity-tab-look`, `files-tab-look`, `file-view-look`, `terminal-tab-look`, `diff-review-look`, `diff-view`, `comment-look`, `inspector-app` |
| 5 | Draft, compare and states | `Home`, `DraftPickers`, `Compare`, `DraftBlockers`, `EmptyUpdate`, `SignInDialog` | `workspace/*`, `composer/DraftChips.tsx`, `AgentMultiPicker.tsx`, `lib/composer-controls.ts`, `compare/*`, `lib/compare-run.ts`, `ui/BlockerCard`, `AgentInstallPanel.tsx`, `AuthPanel.tsx`, `AppUpdateNotice.tsx`, `TerminalSignInDialog.tsx` | `draft-layout`, `new-session`, `draft-chips`, `compare-composer`, `compare-run-look`, `compare-run-panel`, `agent-install`, `auth-panel`, `app-update`, `terminal-sign-in` |
| 6 | Settings and onboarding | `SettingsGeneral`, `SettingsAgents`, `SettingsAppearanceGithub`, `Onboarding` | `settings/*`, `agents/*`, `Onboarding.tsx`, `onboarding/*` | `settings-parts`, `settings-appearance`, `settings-general`, `settings-agents-look`, `settings-sign-in`, `agent-catalog-ui`, `github-section`, `onboarding`, `onboarding-welcome` |
| 7 | Delegate, then the sweep for leftover `bg` and `surface-1` | the six `Delegate*` | `delegation/*`, `composer/MentionMenu.tsx`, `chat/MessageRow.tsx` | `delegation-ui`, `mention-delegation`, `message-row-delegation` |

Later, outside this plan: Private mode after 2026-11-14, and MCP servers with their backend spec.

Phase 1 changes what lies under the chat, so phases 1 to 3 should land close together.

## Testing and verification

- The design-token, docs and contrast tests must pass in intent: no raw colors, `globals.css` and `tokens.json` in step, text at 4.5:1 on `ground`, `sheet` and on `chip` over both.
- Unit tests for `Segmented` (three roles, arrow keys), `AgentTile` (sizes, badge), the short time format, the two filter predicates and their counts, the file order and "N more files" of a compare column, and the last-message helper.
- Component tests for the search field's open and close, the filter with Pinned and Archived, the draft tiles (tick, limit, a blocked tile picks alone, single pick outside a repository), and the compare column with a request open.
- `tauri-contract.test.ts` needs no change: no command, argument or event is added.
- Run targeted Vitest files while building; CI runs the full suite.
- After each phase: the running app beside the artboards, dark and light, then republish the Design System reference from `docs/design-system/`.
- `CHANGELOG.md` gets a line under Unreleased per phase.
