# Main window redesign

Date: 2026-11-04. Status: design approved in conversation, awaiting written-spec review.

Mockups: the Design canvas "Zorvo redesign layouts" (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz). Each artboard named below is the reference for its section; where this text and an artboard differ, this text wins.

## Goal

Make Zorvo's main window calmer, tidier and easier to use, with one focused session as the first priority, while parallel sessions, review and compare stay one click away.

## Scope

The redesign is split into two sub-projects, each with its own spec, plan and implementation:

1. **Main window** (this spec): sidebar, top bar, chat and composer, inspector.
2. **Onboarding and Settings** (later spec): reuses the visual language settled here.

Out of scope here: onboarding, Settings content, popout layout beyond what is stated, keyboard shortcuts and voice input (both declined earlier), any new agent or backend capability except two: the file viewer's read command and the agent setup terminal (see "Other states").

## Decisions

| Topic | Decision |
| --- | --- |
| Brand | Keep: monochrome zinc palette, color only for state, no emoji or gradients, one primary action per view. |
| Structure | Rebuild: layout, hierarchy, spacing and components may change. |
| UI font | SF Pro (system font). Instrument Sans leaves the UI; it stays only inside the logo wordmark SVG. |
| Code font | Geist Mono, unchanged. |
| Layout | Approach A: focused chat in the middle, collapsible sidebar on the left, inspector with tabs on the right, closed by default. Approaches B (two panes always) and C (rail) were rejected. |
| Shortcuts | None added. Every action is reachable by pointer and Tab. |

## Visual foundations

- `--font-sans` in `src/styles/globals.css` becomes `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`. `docs/design-system/tokens.json` `type.families.sans` changes with it (`design-system-docs.test.ts` checks the two agree). The `@fontsource-variable/instrument-sans` import leaves the app bundle.
- Type sizes: `ui` 13px (default UI text, rows, menus), `ui-sm` 12px (composer chips, tool rows, small buttons; new style), `caption` 11px (hints, timestamps, paths in mono), `body` 14/22 (messages, composer), `micro` 10px (badges only). `title` and `heading` stay for dialogs, onboarding and Settings.
- Spacing: session rows 44px with two lines; chat area padding 32px; 20 to 24px between messages.
- Radius: chips use `radius-md` (6px), the same as icon buttons. `radius-full` stays reserved for status dots.
- Colors, shadows, focus ring and status tokens are unchanged.
- New design-system components: `Tabs` (2px underline on the active tab), `Chip` (24px, 11px text, 6px radius; a borderless variant for session info, a bordered variant for clickable contextual chips), `StatusLine` (dot plus status word).

## Layout

Artboard: "A · Fokus, inspector saat perlu".

- Three zones: sidebar 256px, main area (fills the rest), inspector on the right.
- Chat messages and the composer sit in a column at most 680px wide, centered in the main area.
- The sidebar can collapse to zero; its show button moves into the top bar.
- The inspector is closed by default, opens from the top bar, and is 380px wide by default. Its left edge drags between 320 and 720px; the width is remembered (UI setting, not per session).
- The Terminal tab and the file viewer widen the inspector to at least 560px while they show, and return to the remembered width when left.
- When the window is narrower than about 1100px and the inspector opens, the sidebar collapses so the chat column never drops below 560px.
- Popout windows have no sidebar and no inspector, as today.
- The compare-run panel still replaces the chat area; the composer stays mounted and hidden.

## Sidebar

Artboards: "Sidebar · default, hover, fork, compare" and "Sidebar · dilipat, arsip, menu Agents".

Order from top: traffic-light space with the hide button, **New session** (outline), **Search sessions**, **Pinned** (only when something is pinned), folder groups, **Archived (N)** (folded, at the bottom), footer.

**Session row** (44px, two lines):
- Line 1: the session title; weight 500 while unread.
- Line 2: agent, a middle dot, then the status in words: "Waiting for you", "Working", "Finished, unread", or a relative time when idle. A small branch icon when the session runs in its own worktree. Words come from the existing `statusOf` labels, so the row and its tooltip agree.
- The status dot sits on the left and never hides. On hover or focus, the row's actions appear on the right: Stop while the agent works, and a ⋯ menu with Rename, Pin, Archive, Delete (Delete keeps its confirm step).
- Forks are indented under their source with a thin guide line.

**Folder header:** folder icon and name; on hover, a **+** (new session in this folder, with the agent menu) and the fold chevron. A folded folder shows a summary on its right: "1 waiting" (attention color), "2 working", or "N sessions". Rows never reorder when a status changes.

**Compare run:** one group row inside its folder: stacked agent logos, "Compare · 3 agents", and a summary ("2 working, 1 finished"). Click opens the run panel; it expands to its sessions.

**Footer:** avatar and name from the current `ProfileFooter` chain: GitHub name or `@login` while `gh` is signed in (the only case with the GitHub mark), else `git config --global user.name`, else `user.email`, else "Local user"; initials from the name or email. GitHub stays optional: without it only pull-request data is missing. Then an **Agents** button made of the stacked logos of the agents in use (at most three) with an attention dot when one needs sign-in, and a **Settings** button (sliders icon). The Agents button opens a menu: "Agents in use", each agent with its sign-in state (Ready, Not checked, or a **Sign in** button), then "Manage agents" (Settings → Agents). The installed-agents list leaves the sidebar body.

## Top bar

Artboards: "Top bar · biasa, chip kontekstual + menu, sidebar diciutkan" and "Top bar · chip Plan dan background tasks saat ditekan".

Left to right:
- Session title (double-click to rename).
- Branch chip and pull-request chip, borderless: branch icon plus mono name; PR icon in the PR's state color, "#134" in mono, then the state word.
- Space.
- Contextual chips, bordered, shown only when they have content: **Plan 3/7**, **N background tasks**, and the diff chip `+42 −11` (opens the inspector on Changes).
- Inspector toggle (one button replaces today's four panel buttons).
- ⋯ menu: Open in new window, Open in Finder, Rename, Archive.
- While the sidebar is collapsed: show-sidebar button, then Back and Forward, before the title.

**Plan popover:** "Plan from Claude Code", "3 of 7 done", one row per step: done (check in the running color), in progress (spinner), not started (empty circle).

**Background tasks popover:** "Background tasks · N running", one row per task as in today's `BackgroundTasksMenu`: kind icon (shell, subagent, agent session), name (shell commands in mono), origin ("Shell · started by Claude Code"), status word in color (Running, Working, or "Needs approval" in attention color), elapsed time, **Open** (subagent or session) and **Stop**. A closing line says tasks keep running when you switch sessions.

## Chat and composer

Artboards: "A · Fokus…", "Chat · gagal, tool dibuka, sedang bekerja", "Kartu · permission, elicitation, macet, aksi pesan, Reply", "Draft sesi baru · compare dua agent".

**Messages**
- Your message: a `surface-2` bubble on the right, at most 85% wide.
- Agent message: no bubble; a header (logo, name, time) then body text 14/22 in `fg-secondary`. Code blocks keep a header with language and Copy.
- Message actions (Copy, Fork from here, Rewind to here) are a plain row of icon buttons under the message text, left-aligned with it, shown on hover or focus.
- The selection **Reply** popover stays as today.

**Tool calls:** one summary row per agent turn ("Read 2 files, edited 1, ran 1 command"; while something still runs, "1 still running" on the right). Expanded: one row per tool with icon, verb, mono target and a status word; a status is claimed only at `completed` (same rule as `lib/activity.ts`), a running tool shows a spinner, a tool left running when the session goes idle reads "Did not finish". Edits show `+N −N` and open that file in the inspector's Changes tab. Commands show exit code and duration and expand to their output on a terminal-dark ground.

**Cards that wait for you**
- Permission: `attention-surface` with a full `attention-border`, a sentence title ("Claude Code wants to edit 2 files"), mono details, then Deny (ghost), Always allow (outline), **Allow once** (primary). Risky modes keep the `ShieldAlert` mark.
- Elicitation: the same card shape on `surface-2` with `border-strong`, since it is not a permission. Decline (ghost), **Submit** (primary).

**Turn status** under the last message:
- Working: pulsing running dot, "Claude Code is working", elapsed time. No Stop here; Stop lives in the composer.
- Stalled: a muted notice ("Qwen Code hasn't sent anything for 2 minutes. It may be stuck.") with Stop, since the composer may not be visible.
- Failed: a `danger-surface` banner with the reason and **Try again**.

**Composer** (floating card, max 680px):
- Image attachments show as 96×64 thumbnails with a round remove button; clicking opens `ImagePreviewDialog`. Other attachments keep the name chip.
- Bottom row: attach, agent chip, model, mode, then agent-reported extra controls (effort, collaboration mode and so on); controls that do not fit go into a ⋯ menu.
- Right side: context use ("38% of context"), then Send (primary). While the agent works, Send becomes Stop (outline). While Send is blocked, the reason shows in the composer note as today (`composerNote`), linked with `aria-describedby`.
- `/` and `@` menus open as popovers above the composer.

**New-session draft:** the composer moves to the middle with a short title ("New session in agent-desktop"). Above it: folder chip, branch chip (with "new worktree"), agent chip (multi-select for compare). With two or more agents the primary button reads "Start N sessions" and a note says each agent starts in its safest mode in its own worktree. Below: "Continue a session from <Agent>" with the agent's own sessions to import (`AgentSessionList`).

## Inspector

Artboards: "Inspector · Changes, komentar, commit", "Inspector · Activity, laporan agent per giliran", "Inspector · Files, pohon file + Add to prompt", "Inspector · Files, isi file (baca saja)", "Inspector · Terminal melebar ke 560".

Tabs: **Changes**, **Activity**, **Files**, **Terminal**. Opening from the diff chip or a tool row selects the matching tab and file. The inspector's state is one `activeTab | null`, replacing today's separate open flags.

**Changes:** "3 files changed +42 −11", the target picker (Since session start, Uncommitted, Start of this worktree), files with expandable diffs. Line comments work as today (`DiffView` review props); when comments are not yet in a message, a bar "N comments not in a message · Add N" sticks to the bottom. Footer: a commit-message field, **Commit N files** (primary in this view) and **Create pull request** (outline). When `gh` is missing or signed out in a github.com repository, one line explains it and links to Settings → GitHub.

**Activity:** a line saying this is the agent's own report and that rewinding removes entries; the "N files changed that <Agent> didn't report" card with "Show in Changes"; then a timeline per turn, newest first ("Turn 3 · 4 min ago · start of your message"), one row per action with verb, mono target and status. Timeline dots: running color for done, empty for "Did not finish", danger outline for denied or failed. Rules unchanged from `lib/activity.ts`.

**Files:** folder name and path, Refresh, Reveal in Finder, "Filter files", the tree in mono. Hovering a file shows **Add to prompt**. New: git markers on the right of rows ("M" modified in attention color, "A" added in running color, a dot on folders that contain changes), from the diff stats Zorvo already reads.

**File viewer (new):** clicking a file opens it read-only inside the Files tab:
- Header: "← Files", the path as a mono breadcrumb with its git marker, Add to prompt, Open in editor, Copy path.
- Info line: language, line count, "Read only", and a "Mark changed lines" checkbox.
- Body: line numbers, a thin gutter bar on changed lines (running color for added, attention color for modified), monochrome syntax (keywords brighter, strings muted, comments subtle italic).
- Selecting lines shows **Add lines A–B to prompt**, which inserts the path, line range and text into the composer.
- Backend: one new async command that reads a file inside a known workspace (`files::ensure_known_workspace`), with a size cap; binary and oversized files show a message instead of content. The UI sends a workspace and a relative path, never an absolute path of its choosing.

**Terminal:** the workspace terminal moves from the bottom drawer into this tab: shell tabs per folder, new-tab button, columns×rows readout, always dark (`terminal-bg`). `useWorkspaceTerminals` and `pty-output-store` stay; closing the tab or the inspector does not end a shell.

## Other states

Artboards: "Compare run · kartu per agent + konfirmasi Pick", "Draft · install, sedang install, sign-in banyak metode, setup Qwen, agent dihapus", "Keadaan kosong + notice update", "Dialog terminal · setup Qwen Code (pilih provider)".

**Compare run panel** (in the chat's place, max 680px): the task as title, "N agents, each in its own worktree · started 12 min ago", then one card per agent: logo and name, status word with dot (Working, Finished, Waiting for you, Needs sign-in, Stopped, from `rowStatus`), the diff numbers `4 files +86 −12` (opens review on Start of this worktree), **Open** and **Pick**. Pick is disabled while a row has no changes. Pick raises a confirm bar at the bottom: "Keep Codex's work and archive the others?" plus, when some are still working, who will be stopped; Cancel and **Pick <Agent>** (primary).

**Draft blockers** take the composer's place as one `surface-2` card each, all with the agent's logo, a title, one or two sentences, and their actions on the right:
- Install: "<Agent> isn't installed yet", what gets downloaded, **Install <Agent>**. While installing: the step and size in a `role="status"` line, a progress bar, Cancel.
- Sign-in: "Sign in to <Agent>" and **every method the agent reports**, as a list. Methods Zorvo can run (`agent`, `terminal`) get a button worded by `signInButtonLabel`; methods it cannot run (`explain`: API keys, Vertex AI, gateway) show their name and "In your shell" with one line on what to set, never a field for the secret. Footer: the status line (checking, failed reason via `plainReason`, or "Your message will be sent again after you sign in" while `pending`), Dismiss, **Check again**.
- Agent setup (new, see below): "Set up <Agent>", why (the agent picks its provider in its own setup), **Open setup in terminal**, and "Already set up? Check again."
- Removed agent: "<Agent> is no longer in use", "Add it again to continue this session. Its messages stay here either way.", **Add <Agent>**.

**Terminal dialog** (sign-in and setup): a 760px dialog over `overlay` with `shadow-dialog`, the agent's logo and "Sign in to <Agent>" or "Set up <Agent>", the agent's own program in a dark interactive terminal (about 90 columns, 380px tall) so menus such as Qwen Code's "Connect a Provider" fit and work with ↑ ↓ and Return, a status line ("Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this."), and **Close**. Failures show the reason as today (`failure_message`).

**Agent setup terminal (new backend capability).** Qwen Code 0.26.6, asked with a bare `initialize`, reports a single method over ACP: `openai` ("Use OpenAI API key") in the older `_meta.type: "terminal"` form with `args: ["--auth-type=openai"]`, which Zorvo today shows as text only. Its provider choice (QwenCloud, Alibaba ModelStudio, third-party, custom) lives in its interactive setup, which runs when the program starts without `--acp`. The redesign adds:
- An agent setup command that runs the agent's own program, resolved from the registry by agent id exactly as `launch_for` does, with the ACP arguments taken off, in the sign-in PTY under the existing `signin-` route. The UI sends only the agent id and folder; no command, argument or environment comes from the UI, and the folder passes `files::ensure_known_workspace`.
- It is offered only for agents whose registry entry or reported methods mark an interactive setup (for now Qwen Code: its legacy terminal method), never as a general "run any agent" door.
- When the dialog closes, Zorvo re-checks sign-in through the existing `checkSignIn` path (after `refreshLoginEnv`), and a held message is resent as today.
- Zorvo never copies the agent's provider list into its own UI, so a provider Qwen adds or renames needs no Zorvo change.
- The exact way to strip the ACP arguments (and whether the legacy method's own `args` are passed) is settled in the plan against the real Qwen Code build, with a test against the fake agent.

Per-agent methods, for reference (Qwen Code checked live on 2026-11-04; the others from the repository's tests and the terminal sign-in spec): Claude Code offers Claude Subscription and Anthropic Console as terminal methods; Codex offers ChatGPT (also as a device code) and an API key; Gemini CLI offers Log in with Google, a Gemini API key, Vertex AI and an AI API Gateway.

**Empty state** (no folder yet): a 48px icon tile, "Open a folder to start", one sentence ("Pick a project folder. Your agents work inside it, and its sessions show in the sidebar."), **Open folder** (primary). The real Zorvo symbol (`docs/brand/assets/zorvo-symbol.svg`) may replace the tile; it is never redrawn. A folder with no sessions opens the new-session draft.

**App update notice:** a card at the bottom right of the main area: "Zorvo <version> is ready", the `restartWarning` line ("Restarting stops 2 agents mid-turn and 1 shell."), Later and **Update & restart** (outline, since the view's primary stays with the chat). During the install it reads "Downloading…" then "Installing…".

**Popout window:** the chat column and composer only, with a short top bar (title, agent, status). No sidebar, inspector, terminal or Reply, as today.

## Menus, pickers, full diff review and small states

Artboards: "Menu composer · mode, model + cari, slash, mention", "Picker draft · branch + worktree, agent multi-pilih", "Review diff penuh · komentar baris", "Rename, Delete?, toast, pratinjau gambar". Names of models and commands in the mockups are examples; the app shows what the agent reports.

**One popover style** for every menu and picker: `surface-3`, `border`, `shadow-popover`, radius 8, 6px padding, options 30px tall with radius 4, a small `fg-muted` header line where a group needs one, the selected option with a check and `surface-hover`.

**Composer menus** (`OptionDropdown`, opened from the composer chips, anchored above them):
- Mode: each option with its name and description; the current one checked; a risky mode carries the `ShieldAlert` mark in the attention color with the label "Lets the agent act without asking".
- Model and other lists: name and description; over 10 choices a "Search <label>" field sits on top, matches are bold, and a footer reads "N of M <label>".
- `/` menu (`SlashCommandMenu`): header "Commands from <Agent>", command names in mono with their description.
- `@` menu (`MentionMenu`): header "Files in <folder>", file name in mono with the match bold and its folder under it.

**Draft pickers** (chips above the centered draft composer):
- Folder (`FolderPicker`): "Search folders", "Recent folders", **Open another folder…**.
- Branch: "Search branches", "Local branches" with the checked-out one marked, and a **New worktree** switch with "Works on its own copy from <branch>. Your checkout stays as it is."
- Agent (`AgentMultiPicker`): a multi-select list with checkboxes, logo, name and readiness (Ready, Not checked). Agents that need a sign-in or an install are dimmed, cannot be ticked, and say why. The header says more than one agent makes a compare run; the limit stays `MAX_COMPARE_AGENTS`; a footer line says each runs in its own worktree in its safest mode.

**Full diff review** (`DiffView` expanded from the Changes tab, taking the chat area):
- Header: the target picker, file count and `+N −N`, Search files, ⋯ (Collapse all, Expand all, Refresh), **Shrink**.
- Left: changed files with their counts. Right: the file path, "Click a line number to comment", the diff with two line-number columns.
- Writing a comment opens a box under that line ("Comment on line 42", Cancel, Save comment); saved comments show a small marker on their line with their status (Current, Outdated, Unknown, as `commentStatus` decides).
- A bar at the bottom: "N comments not in a message" and **Add N to message** (primary in this view).
- All review behavior stays as described in CLAUDE.md "Diff comments"; only the layout changes.

**Small states**
- Inline rename: the row turns into a text field with a visible border; "Return saves, Esc cancels" under it.
- Delete: the trash button becomes "Delete?" on `danger-surface` in the danger color, and turns back by itself, as today.
- Notices (`setNotice`) become toasts at the bottom right of the main area: icon, one sentence, an optional action, a dismiss button; warnings use the attention icon, errors a danger border and `role="alert"`.
- Image preview (`ImagePreviewDialog`): a dialog over `overlay` with file name, size, Close, and the image fitted inside.

## Accessibility

- Every status is a word next to its dot; color never carries meaning alone.
- Text meets 4.5:1 on its ground in both themes; `fg-subtle` is not used on `surface-hover`.
- Real buttons, tabs (`role="tab"`, `aria-selected`), tree (`role="tree"`), the resize handle as `role="separator"` with value attributes, icon buttons with `aria-label`.
- Hover-only actions (row actions, message actions, Add to prompt) also appear on keyboard focus.
- Focus ring on every control, as today.

## Code impact

- `globals.css` and `tokens.json` together (font family, `ui` size, new `ui-sm`); `theme-contrast.test.ts` and `design-tokens.test.ts` keep passing.
- New UI primitives in `src/components/ui/`: `Tabs`, `Chip`, `StatusLine`.
- `Sidebar.tsx` / `SessionList.tsx`: two-line rows, left status, hover actions, folded summaries, compare group row, footer Agents menu.
- `TopBar.tsx`: chips, one inspector toggle, ⋯ menu, conditional back/forward; `PlanMenu` and `BackgroundTasksMenu` restyled.
- A new inspector container replaces the separate Changes, Files, Activity panels and `TerminalDrawer` placement; its state lives in a focused hook rather than growing `App.tsx`.
- Chat components (`MessageRow`, `ToolCallList`, `ActionCard`, `ElicitationCard`, `AgentStallNotice`, `FailedTurnBanner`, `MessageActionBar`) restyled; `ComposerDock` gets thumbnails and the overflow menu.
- One new Tauri command for the file viewer, registered in `generate_handler!`, with Rust tests for the workspace check, size cap and binary detection.
- One new Tauri command for the agent setup terminal (next to `acp_start_terminal_sign_in` in `acp/terminal_auth.rs`), with Rust tests that the program comes only from the registry entry, the ACP arguments are removed, the folder is checked, and an agent without a setup is refused.
- A shared popover primitive in `src/components/ui/` used by `OptionDropdown`, `SlashCommandMenu`, `MentionMenu`, `FolderPicker`, `AgentMultiPicker`, `PlanMenu` and `BackgroundTasksMenu`; a `Toast` primitive replaces today's notice banner; `DiffView`'s expanded layout gains the file list on the left.
- `AuthPanel` becomes the method-list card; `CompareRunPanel`/`CompareRunRow`, `AgentInstallPanel`, `RemovedAgentPanel`, `AppUpdateNotice`, `AppPlaceholders` and `TerminalSignInDialog` restyled.
- `CHANGELOG.md` gets a line under Unreleased.

## Suggested phases

Each phase ships on its own and leaves the app usable:

1. Foundations: font, type scale, `Tabs`, `Chip`, `StatusLine`.
2. Sidebar.
3. Top bar and the inspector container (moves the four panels and the terminal into tabs).
4. Chat, cards and composer.
5. Files tab git markers and the read-only file viewer (includes the backend command).
6. Other states: compare run, draft blockers with the method list, terminal dialog, empty state, update notice.
7. Agent setup terminal for Qwen Code (backend command, setup card, re-check after close).

The popover primitive and the toast belong in phase 1; the composer menus and draft pickers in phase 4; the full diff review in phase 3 with the inspector.

## Testing

- Unit tests for the new primitives and for the folded-folder summary and status-word helpers.
- Component tests for the inspector (tab switching, width memory, Terminal and viewer widening), the sidebar row (status visible during hover, actions on focus) and the composer (Send becomes Stop, overflow menu).
- Existing design-system, contrast and token tests must pass unchanged in intent.
- Rust tests for the file read command and the agent setup command.
- Component tests for the sign-in card (one row per method, buttons only for runnable methods, no secret field) and the setup card (Open setup in terminal, re-check on close).
- A manual pass in both themes against the canvas artboards.
