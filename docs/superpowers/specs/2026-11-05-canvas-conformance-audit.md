# Main window vs the design canvas: conformance audit

On 2026-11-05 the user ran the app after phases 1–7 and reported that much of it does not match the design canvas. The canvas is the "Zorvo redesign layouts" Design artifact, https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz, with its artboards under `project/*.dc.html`.

Phases 1–7 were built from the text of `2026-11-04-main-window-redesign-design.md`. They were checked by tests of text and behavior, not against the artboards, so about 150 visible differences remained. This file lists them and records the user's decisions. Phase 8's plans fix them, in four parts.

## The user's decisions (2026-11-05)

- **Order.**
  - Phase 8 is "match the canvas", main window first, in four parts with one PR each:
    - **8a** shell and sidebar;
    - **8b** chat and composer;
    - **8c** inspector;
    - **8d** compare run, blocker cards, dialogs, empty state and update card.
  - Settings as a full page with a left nav is sub-project 2 (`2026-11-04-onboarding-settings-redesign-design.md`), which was never planned. It comes after phase 8.
- **Extras the canvas does not draw.**
  - Keep a function people need, restyled to the canvas. Examples: the X that closes a terminal tab, Dismiss on cards, the Activity filters, Settings' Check again.
  - Drop pure decoration the canvas leaves out:
    - the "WORKSPACES" heading;
    - the "Zorvo vX" footer line;
    - the folder/branch card above the first message (`WorkspaceSummary` in a session).
- **Authority.**
  - Where the spec text and an artboard disagree, the **artboard decides the look** and the spec still decides behavior.
  - Choices the user made explicitly earlier stay:
    - the agent chip stays in the composer;
    - message actions are a plain icon row under the message;
    - the branch and PR chips are borderless;
    - chips use radius 6;
    - the terminal stays an inspector tab that widens to 560px.
- **User requests beyond the canvas.** An agent logo in each sidebar session row (the artboard has only the status dot).

## How the canvas maps to the code

The canvas variables map to tokens as follows:

| Canvas | Token |
|---|---|
| `--bg` | `bg` |
| `--s1` | `surface-1` |
| `--s2` | `surface-2` |
| `--s3` | `surface-3` |
| `--hover` | `surface-hover` |
| `--line` | `border` |
| `--strong` | `border-strong` |
| `--fg` | `fg` |
| `--fg2` | `fg-secondary` |
| `--muted` | `fg-muted` |
| `--subtle` | `fg-subtle` |
| `--run` | `status-running` |
| `--att` | `status-attention` |
| `--unread` | `status-unread` |

Type sizes: 13/18 is `text-ui`, 12 is `text-ui-sm`, 11 is `text-caption`, 14/22 is `text-body`.

Three causes run through most of the differences:

- **`ui/Button` is `text-xs`.** It renders 12px text and is about 30px tall. The artboards' buttons are 13px, at 28–32px for main actions and 24–26px for small ones.
- **`ui/IconButton` is always 28px and muted.** The artboards' small icon buttons are 22–26px, usually in `--fg2`.
- **Two bases are `text-xs`.** The sidebar `<aside>` (`Sidebar.tsx:172`) and `ChangesPanel` set `text-xs` as their base, so their text is 12px where the artboards use 13px.

Fixing the primitives (button sizes, an open state on chips) clears many items at once, so each part starts there.

## 8a: shell and sidebar (artboards `Main`, `Sidebar`, `SidebarStates`, `TopBar`, `TopBarPopovers`, `SmallStates`)

### Points the user reported

1. **The Agents menu is cut off at the window's left edge.**
   - Code: `AgentsMenu.tsx`, `align="end"`, `w-64`, on a trigger in the middle of the sidebar.
   - Artboard: the panel spans the sidebar, at `left 8px; right 8px; bottom 60px`.
2. **The title is cramped against the traffic lights.**
   - Code: `TopBar` spans the whole window above the sidebar.
   - Artboard:
     - the sidebar runs the full height, with its own 48px header holding the traffic-light space and **Hide sidebar**;
     - the top bar sits only above the chat column: 48px, title 13px weight 600 in `fg`, 12px gaps;
     - with the sidebar hidden, the top bar starts with **Show sidebar**, then Back and Forward.
3. **The terminal tab strip has no height** (`TerminalDrawer.tsx:108`). Fixed in 8c; see below.
4. **Add the agent logo to each session row.**

### Layout and top bar

- **Top bar:**
  - height `h-11` (44px) → 48px;
  - title `font-medium text-fg-secondary` → weight 600 `fg`;
  - gaps `gap-2` and `gap-1.5` → 12px.
- **Inspector toggle, pressed:** a `surface-hover` fill with the icon in `fg-secondary`. The code only recolors the icon.
- **More menu:**
  - 220px wide;
  - each item has a 14px muted icon (external-link, folder, pencil, archive);
  - a separator before Archive;
  - text in `fg-secondary`.
  - The code is plain text options at `min-w-48`.
- **The More and Inspector buttons when open:** a `surface-hover` fill.
- **Pull request chip:**
  - 24px tall;
  - a 12px icon in `status-running`;
  - "#134" in mono `fg-muted`, then the state word ("Open") in sans `fg-secondary`.
  - The code never shows the state word.
- **Branch chip:** padding `0 4px`, the icon in `fg-muted`.
- **Plan chip:** a list-checks icon in `fg-muted`, "3/7" in mono `fg-muted`.
- **Background tasks chip:** a spinner arc in `status-running` (stroke 2.25). The code shows a `ListChecks` icon, which looks like the Plan chip's.
- **Diff chip:** mono.
- **Open chip state:** a `surface-hover` fill and a `border-strong` edge. `Chip` ignores `aria-expanded`.
- **The cluster shown when the sidebar is hidden:**
  - Show sidebar in `fg-secondary`;
  - Back in `fg-muted`;
  - a disabled Forward in `fg-subtle`, not at 40% opacity;
  - the buttons overlap by 8 and 10px, and the title follows 4px after.
- **Plan popover:**
  - header on one row: "Plan from Claude Code" (13/600 `fg`), with "3 of 7 done" on the right (11px `fg-subtle`);
  - steps 30px tall with a 10px gap:
    - done: a circle-check, text in `fg-muted`;
    - current: an arc in `status-running` on a `surface-hover` row with radius 6, text in `fg`;
    - pending: an empty circle in `fg-subtle`, text in `fg-secondary`;
  - width 340.
- **Background tasks popover:**
  - header "Background tasks" (600 `fg`), with "2 running" on the right in `fg-subtle`;
  - each task row:
    - a 28px icon tile (`surface-hover`, radius 6);
    - the name in mono 12px for a shell task, else 13px at weight 400;
    - status and time right-aligned (the time in mono);
    - buttons 24px, 12px;
    - a hover fill;
  - the footer adds "Stop ends the process.".

### Sidebar

- **No `border-b` under the top block.** It keeps `0 12px 12px` padding.
- **New session button:**
  - 32px tall;
  - content left-aligned;
  - 13px, `fg`, weight 500;
  - a 14px icon with an 8px gap.
- **Search field:**
  - 30px tall, radius 8;
  - a `surface-2` fill and **no border**;
  - text 13px `fg`.
  - The code has `border-border-strong`, a strong visible outline.
- **Headings:**
  - Drop the "WORKSPACES" heading and its FolderPlus button. Opening a folder is still possible from the New session menu and the draft's folder chip.
  - "Pinned" gets a 12px pin icon and is sentence case, 11px, weight 500, `fg-muted`. The code's `SECTION_HEADER` is uppercase, tracked and semibold in `fg-subtle`.
- **List padding:** 8px at the sides (the code uses `p-3`).
- **Session row:**
  - padding 8, gap 10, top-aligned, the dot at `margin-top 6px`, about 50px tall. The code is `h-11`, centered;
  - titles:
    - idle title in `fg-secondary` (the code uses `fg-muted`);
    - active title in `fg`, weight 500;
    - unread title in `fg-secondary`, weight 500;
  - subtitle: idle in `fg-subtle`, active in `fg-muted`;
  - a worktree row starts its subtitle with an 11px branch icon. The code puts a 12px icon at the far right;
  - hover actions: Stop and ⋯ are 24px buttons in the row's flow, in `fg-secondary` with 12px icons, and the title truncates before them. The code uses an absolute overlay;
  - the working dot does not pulse;
  - **the user's request:** the agent's logo (14px) before the agent's name in the subtitle line.
- **Forks:** indent `margin-left 11px; padding-left 10px`, and the subtitle ends with "· fork".
- **Expanded folder header:**
  - a 12px folder icon;
  - the name at 11px, weight 500, `fg-muted`;
  - on the right, a 22px "+" button (radius 4), then a 22px chevron-down fold button.
- **Folded folder row:**
  - 32px tall, with the chevron-right on the left and no folder icon;
  - the name at 13px in `fg-secondary`;
  - the summary on the right with a 6px dot: attention for "1 waiting", running for "2 working" (`fg-muted`), no dot for "4 sessions" (`fg-subtle`).
- **Compare run row:**
  - the title "Compare · 3 agents", the subtitle "2 working, 1 finished";
  - on the right, 16px rounded-square logos overlapping by 4px with a 2px `surface-1` ring;
  - an idle title in `fg-secondary`.
- **Archived:**
  - pinned to the bottom of the list by a spacer;
  - the heading "Archived" in sentence case (11px, 500, `fg-muted`, chevron-down), with the count in `fg-subtle` at weight 400;
  - an archived row shows an inline 24px Unarchive button on hover.
- **Footer:**
  - 52px tall, the same `surface-1` as the sidebar, one top border. The code is `bg-bg` with a double border;
  - avatar 24px, 10px text, no ring;
  - name 13px `fg-secondary` at weight 400, with no version line;
  - the Agents button:
    - 16px rounded-square logos with a 2px ring;
    - an attention dot at 3px/3px with a ring;
    - a `surface-hover` fill when open;
  - the Settings icon is the "settings-2" glyph.
- **Agents menu rows:**
  - logos 16px;
  - "Ready" in `fg-muted` with only the dot green;
  - "Needs sign-in" is an outline "Sign in" button (24px, 11px `fg`) on a `surface-hover` row;
  - "Not checked" in `fg-subtle` with no dot;
  - "Manage agents" has a 14px muted settings-2 icon and text in `fg-secondary`, after a separator with 6px margins.

### Small states

- **Rename in the sidebar:**
  - the row stays on `surface-hover` with its dot;
  - the input is 26px tall, radius 6, a 1px `fg` border, a `bg` fill, padding `0 8px`;
  - a hint, "Return saves, Esc cancels" (11px `fg-subtle`).
- **Delete confirm:** an inline "Delete?" pill on the row where the actions sit (24px, `danger-surface` fill, `danger` text, 12px/500, radius 4). The code puts it inside the ⋯ popover.
- **Toast:**
  - the warning icon is a circle-alert in `status-attention`;
  - status text in `fg-secondary`;
  - Dismiss is 22px with a 12px icon;
  - the action button is 24px, 12px `fg`;
  - `App.tsx` must pass a warning tone where the notice is a warning, not always `error`.
- **Image preview:**
  - 520px wide;
  - header padding `10px 12px 10px 16px`, with a meta line ("1280 × 800 · 214 KB", `fg-subtle`);
  - title 13/500;
  - image inset `0 12px 12px`.

## 8b: chat and composer (artboards `Main` chat column, `ChatStates`, `ChatCards`, `NewSession`, `ComposerMenus`, `DraftPickers`, `DiffReview`)

- **Drop the folder/branch card above the first message** (`App.tsx` header with `WorkspaceSummary`). Keep `HistoryElsewhereNote` for an imported session, restyled as a quiet note.
- **Column and canvas:**
  - the column is 680px everywhere: messages, footer, working line, stall notice, banner and composer. The code uses `max-w-3xl` (768px);
  - canvas padding 32px at the top, 24px at the sides, 16px at the bottom.
- **Your bubble:** padding 10/14, radius 12, with no time under it.
- **Agent header:**
  - the name 12px at weight 500;
  - the time in `fg-subtle`;
  - a 10px gap to the text.
- **Tool card:**
  - a `surface-1` fill, a 34px header at 12px;
  - the touched file on the right in mono 11px `fg-subtle`;
  - rows 30px, 12px:
    - a fixed 56px verb column in `fg-muted`;
    - the full path as one mono 11px span;
    - "Done" in `fg-subtle`, not green;
    - Running as an arc in `status-running` with the visible word "Running";
    - counts in mono;
    - no dividers between rows;
    - command status "Exit 0 · 2.1 s";
  - command output indented 76px, with `terminal-fg` text and no border.
- **Failed turn:**
  - one row: a danger icon, the text in `fg` at 13px, and **Try again** on the right (28px, radius 8, 13px);
  - Dismiss and Details stay, restyled;
  - inline after the failed message.
- **Working line:**
  - a 6px dot with a 4px soft ring and a 10px gap;
  - the text 13px `fg-secondary`, the time 11px `fg-subtle`.
- **Permission card:**
  - buttons right-aligned, no divider, 30px, 13px, no icons; Allow once primary;
  - an edit lists its files with +N/−N;
  - the title at weight 600.
- **Question (elicitation) card:**
  - the agent's logo, then "Codex needs a few details" (13/600), then the message (13px `fg-muted`);
  - labels 13/500;
  - inputs 32px, radius 8, `border-strong`, `bg` fill;
  - Decline (ghost) then Submit (primary), right-aligned; Dismiss kept, restyled.
- **Stall notice:**
  - a clock icon in `status-attention`;
  - 13px `fg-secondary`;
  - Stop 26px with a square icon.
- **Message actions:**
  - the whole message gets a `surface-1` fill on hover (padding 12, radius 10);
  - icons 26px in `fg-secondary`: Copy, Fork, Rewind.
- **Reply toolbar:** 2px panel padding, Reply 28px, 13px `fg`.
- **Selection colour:** a `::selection` rule, `rgba(161,161,170,.32)`.
- **Composer:**
  - 680px wide, with 24px side and 20px bottom padding;
  - a two-row text box (44px);
  - no divider above the control row;
  - chips borderless, 28px, no leading icon (text in `fg-secondary` plus a chevron), radius 6 (the user's earlier choice). Open chips get `surface-hover` and `fg`;
  - order: Agent (logo + name) → model → mode → ⋯, with the agent chip also in a running session (the user's earlier choice);
  - the attach icon is a paperclip, the send icon an arrow-up;
  - the context reads "38% of context" in 11px `fg-subtle`;
  - placeholders: "Answer the request above to continue" while a request waits, else "Reply to <Agent>";
  - Stop is an outlined 11px square;
  - the attachment remove button is an 18px circle inside the thumbnail.
- **New-session draft:**
  - left-aligned in the 680px column from 120px down;
  - heading 20/28, weight 600, `-0.02em`;
  - chips 28px, radius 8, `surface-1` fill, 16px below the heading, 8px apart. The branch name is in mono 11px;
  - the agent chip with several agents shows overlapping logos, "Claude Code, Codex · compare";
  - the compare note sits inline in the control row: "Each agent starts in its safest mode, in its own worktree.";
  - Start is 28px, 13/500, with an arrow-up after the label;
  - the session list has a header row ("Continue a session from Claude Code", with "3 in this folder" on the right), plain 44px rows with the time, and Continue on the hovered row.
- **Draft pickers:**
  - Branch menu:
    - 360 wide;
    - a 30px search field with an icon;
    - branch names in mono 12px, the check on the left, "checked out" on the right;
    - the worktree switch on the left, with its label and description stacked.
  - Agent menu:
    - 380 wide;
    - header "Agents" with "Pick more than one to compare";
    - a 14px checkbox on the left, filled `fg` when ticked;
    - "Needs sign-in" with an attention dot;
    - "Not installed" and "Not checked" on the row itself;
    - unavailable rows at 55% opacity;
    - the footer copy as in the artboard.
- **Composer menus:**
  - Mode menu: a "Mode" heading, the check on the left, descriptions in `fg-subtle`; a risky mode shows its shield after the name and "Lets the agent act without asking." on its subtle line;
  - model search: a 30px field with an icon;
  - slash commands: the command over a subtle 11px description;
  - mentions: a file icon on each row, the folder in mono 11px `fg-subtle`.
- **Full diff review:**
  - header:
    - 48px tall;
    - target 13/600, "3 files" 12px, counts mono;
    - Shrink as an outline text button; Close kept, restyled;
  - file list:
    - 30px one-line rows, radius 6, mono 11px;
    - +N/−N only when nonzero;
    - the selected file highlighted;
  - body:
    - one 36px file header bar (mono 12 path, "Click a line number to comment") on `bg`;
    - lines mono 12/20, tinted only, the text staying `fg-secondary`;
    - the hunk row with no fill;
    - the active line with a 2px `fg` bar;
  - comment box:
    - a card indented 104px (`surface-2`, `border-strong`, radius 8);
    - a visible label "Comment on line 42";
    - Save comment in outline;
  - saved comments: a badge at the line's end ("1 comment · Current");
  - the comments bar floats as a card ("2 comments not in a message", primary "Add 2 to message").

## 8c: inspector (artboards `InspectorChanges`, `InspectorActivity`, `InspectorFiles`, `InspectorFileView`, `InspectorTerminal`)

- **Frame:**
  - tab strip 48px, padding `0 8px 0 12px`;
  - the close X kept, restyled;
  - the resize edge shows a 3px `border-strong` line and a 10×36 grip on hover or drag.
- **Changes:**
  - a summary row: "3 files changed" (600) with +42/−11 in mono 11px, and a ghost "Since session start ▾" scope button;
  - base text 13px, padding 16, 12px between blocks;
  - each file is a bordered card (radius 8):
    - a chevron;
    - the full path in mono 11px `fg-secondary`;
    - per-file +N/−N;
    - "1 comment" where it applies;
  - the diff opens inside the card:
    - one 30px gutter;
    - text in `fg-secondary`, rows tinted;
    - 18px lines;
  - line comments inline with "Add to message";
  - a bar "2 comments not in a message" with **Add 2**;
  - the commit area: two side-by-side buttons, Commit (primary) and Create pull request (outline);
  - the PR list and GitHub section kept, restyled.
- **Activity:**
  - the filters kept, restyled;
  - an intro line with an ⓘ icon: "This is <Agent>'s own report of what it did. Rewinding the chat removes its entries too.";
  - unreported files in an attention card with an amber icon, the title "2 files changed that <Agent> didn't report", mono paths and **Show in Changes**;
  - entries grouped by turn ("Turn 3 · 4 min ago · prompt"), newest turn first, in time order within a turn;
  - a 1px timeline rail with 9px status dots;
  - a 52px verb column, a truncated mono target, and the result right-aligned ("Done", "Exit 0", "8 results", +28/−6);
  - "Did not finish" in `fg-muted`, "You denied" in `danger`.
- **Files:**
  - header: the folder name (13/600 `fg`) over the path (mono 11px `fg-subtle`), no border;
  - 26px buttons with 14px muted icons; Reveal uses the external-arrow icon;
  - the filter field radius 8;
  - tree rows 26px, `fg-secondary`, radius 4, indent 4px plus 16px per level;
  - the folder icon stays closed;
  - icons in `fg-subtle`;
  - the marker 10px/600;
  - the hovered row shows an "Add to prompt" pill (20px, `border-strong`, "+"), before the marker.
- **File view:**
  - a 44px path bar (back, breadcrumb, three 26px icons), then a separate 32px meta bar;
  - the back button 26px, chevron-left, `fg-secondary`;
  - breadcrumb: segments and slashes in `fg-subtle`, the marker at 600;
  - meta text in `fg-subtle`, the checkbox label in `fg-secondary`;
  - the body on a `bg` well, padding 10px 0, 12px on 20px lines;
  - gutter 40px with 12px padding; change bar 3px with a 10px gap;
  - selected lines tinted;
  - "Add lines A–B to prompt" as a floating popover next to the selection, with a "+" icon;
  - keywords at weight 500.
- **Terminal (the user's point 3):**
  - the strip is 36px with 24px tabs, on the drawer's `terminal-bg` (the whole drawer is `#0a0a0b`);
  - each tab reads "zsh" then the folder name in mono 11px `fg-subtle`;
  - the close X kept, restyled small;
  - New terminal 24px with a 12px icon;
  - a "80 × 38" readout on the right;
  - xterm padding 12/14, `lineHeight` for 18px rows, a block cursor.

## 8d: other states (artboards `CompareRun`, `DraftBlockers`, `EmptyUpdate`, `SignInDialog`)

- **Compare run:**
  - column 680, 40px top padding;
  - title tracking `-0.02em`, subtitle 13px;
  - 16px before the list, 8px between cards;
  - each card is **one row** on `surface-2`, padding 14/16:
    - a 28px logo tile (radius 7, `surface-hover`);
    - the name over the status (12px `fg-secondary`, with a dot);
    - a mono 11px change button "3 files +54 −9" (26px);
    - ghost **Open** and **outline** Pick (28px);
  - while the confirm bar is open, the chosen card's border is `border-strong` and its Pick looks pressed;
  - status words carry the elapsed time ("Working · 12 min", "Finished · 8 min") and a blue unread dot when finished;
  - with no changes, the card reads "No changes yet" (`fg-subtle`), and the disabled Pick is an outline at 40% opacity;
  - the confirm bar floats 24px from the bottom, 680 wide, `surface-3`, `border`, padding 14/16, as one `fg` sentence including who is stopped.
- **Blocker cards (`ui/BlockerCard`):**
  - padding 18, gap 14, `shadow-popover`;
  - a 32px logo tile (radius 8, `surface-hover`);
  - title at 600, body 13px `fg-muted`;
  - **the main button on its own right-aligned row under the body**, not on the title row;
  - Install:
    - no icon;
    - copy "Zorvo downloads Codex and Node.js into its own folder…";
    - while installing, the title is "Installing Codex" and the body "Downloading Node.js · 18 of 42 MB";
    - the bar 4px on a `surface-hover` track with an `fg-secondary` fill;
    - Cancel ghost;
  - Sign-in:
    - methods as a bordered list (radius 8, rows divided, padding 10/12): the name in 13px, the description in 12px `fg-subtle`;
    - method buttons outline, with no icon;
    - "In your shell" right-aligned on its row;
    - copy "Pick how <Agent> signs in. It uses its own tool; Zorvo never sees your password or key.";
    - the status line with an attention dot, 12px `fg-secondary`, ending with a period;
  - Setup:
    - an outline **Open setup in terminal** in the body, with "Already set up in <Agent>? Check again." beside it;
    - "Not checked yet." while idle;
    - the copy names the providers;
  - Removed: the button row and shell as above.
- **Empty state:**
  - a closed folder icon at 22px in `fg-secondary`;
  - heading at 600 with `-0.02em`;
  - Open folder 32px, 13px, with a "+" icon.
- **Update card:**
  - `surface-3`, padding 14/16;
  - title at 600;
  - Later in `fg-secondary`, Update & restart in `fg`;
  - copy with counts ("Restarting stops 2 agents mid-turn and 1 shell.");
  - placed in the window's bottom-right corner (20/20), not hanging from the composer.
- **Terminal dialog:**
  - title 16/24 at 600, with no method-name subtitle for a sign-in;
  - the status line in the footer row, left of Close (12px `fg-muted`);
  - terminal padding 14/16.
