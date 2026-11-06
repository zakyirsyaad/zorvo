# Composer

The message box of a session: a floating card at most 680px wide, with a growing textarea above a row of the agent's controls, ending in Send. One `ComposerDock` serves every session and the new-session draft, and stays at one place in the window, so what you typed survives a switch.

The consumer provides the controls and the send handler. Without a placeholder of its own, the composer reads "Reply to <Agent>". While a permission or question card waits, the app passes "Answer the request above to continue".

- **Dock.** 24px at the sides and 20px under the card in a session. A draft's composer sits inside its column, with no bottom padding.
- **Card.** A column with a 10px gap and 12px padding, on `surface-2` with a `border` edge, `radius-xl` and `shadow-popover`. The edge turns `border-strong` while focused.
- **Text.** The prompt starts two lines tall (44px) in `body` on `fg`, with the placeholder in `fg-subtle`. The note under it is `caption` in `fg-muted`: why Send is blocked, else that the agent's options are loading.
- **Attachments.** Images show above the textarea as 96×64 thumbnails, with an 18px round remove button inside the corner. Clicking one opens `ImagePreviewDialog`. Other files are name chips.
- **Bottom row, left.** No divider above it; its controls sit 4px apart.
  - Attach is a 28px paperclip button in `fg-muted`.
  - In a running session the agent comes next, as a label: its 16px logo and name, not a button, since a session cannot change its agent.
  - Then the agent's controls, in the order model, mode, effort, then the agent's extras (collaboration mode, fast mode and so on).
  - Each control is a 28px borderless chip with `radius-md` (6px), in `ui-sm` and `fg-secondary`, with no leading icon and a 12px chevron in `fg-muted`. An open chip is filled `surface-hover` with `fg` text.
  - A risky mode's chip ends its name with a 12px `ShieldAlert` in `status-attention`.
- **Overflow.** At most `MAX_INLINE_CONTROLS` (3) controls sit in the row. The rest go into the **More options** ⋯ menu, as one group per control with its choices as radio items. It is a count, not a measurement, so the chips never move while the window is resized.
- **Bottom row, right.** The context use as plain words, "38% of context", in `caption` and `fg-subtle`. It turns `status-attention` from 80% and `danger` from 95%, and opens the numbers behind it. Then Send.
- **Send.**
  - Send is the only primary control: 28px, `radius-lg`, with an arrow up. It is disabled while the text is empty, and while Send is blocked it is `aria-describedby` the note.
  - `sendLabel` words it ("Start 2 sessions"), at 13/500 with a 12px arrow up after the label.
  - While the agent works, Stop takes its place: an outline icon button with an 11px square.
- **Menus.** The mode, model and other chips open `Popover`s above themselves, with the check on the left and descriptions in `fg-subtle`.
  - The mode menu is headed "Mode". A risky mode shows its shield after its name, and "Lets the agent act without asking." on its line.
  - A list over 10 choices gets the 30px "Search <label>" field, with the matches in bold and "N of M <label>s" under it in `fg-subtle`.
  - A menu whose choices have a line under them is 300px wide; a short plain list is as wide as its words.
- **`/` and `@`.** These open lists above the prompt with the popover's look. The prompt keeps focus, and ↑ ↓, Return, Tab and Escape drive the list.
  - "Commands from <Agent>": each command in mono 12 over its description in 11/15 `fg-subtle`.
  - "Files in <folder>": a file icon, the name in mono 12 with the match in bold, and its folder in mono 11 `fg-subtle`.
- **New-session draft.** A left-aligned 680px column from 120px down: "New session in <folder>" at 20/28, 600, `-0.02em`. Then the chips, the card, and 24px under it the agent's own sessions.
- **Draft chips.** 28px, `radius-lg` (8px), a `border` edge on `surface-1`, `ui-sm` in `fg-secondary`, 8px apart and 16px above the card. A 12px leading icon and chevron are in `fg-muted`. An open chip is filled `surface-hover`, edged `border-strong`, in `fg`.
  - **Folder:** search, "Recent folders", **Open another folder…**.
  - **Branch** (in a repository): the branch name in mono 11, and "· new worktree" in `fg-subtle` while that switch is on.
    - Its menu is 360px wide: the search field, then "Local branches" in mono 12 with the check on the left, and "checked out" on the folder's own branch.
    - A line separates the **New worktree** switch, which sits on the left with its label over "Works on its own copy from <branch>. Your checkout stays as it is.".
  - **Agent:** the ticked agents' 16px logos, overlapping, and their names, with "· compare" in `fg-subtle` for two or more.
    - Its menu (in a repository) is 380px wide, headed "Agents" with "Pick more than one to compare".
    - Each row is a 14px checkbox, filled `fg` when ticked, then the logo, the name and a status: "Ready" (`fg-muted`), "Not checked" (`fg-subtle`), "Needs sign-in" (`status-attention`, after a dot) or "Not installed" (`fg-subtle`).
    - An agent that cannot join is at 55% opacity, and its status describes its checkbox.
    - The footer says "With two or more agents, each runs in its own worktree in its safest mode."
- **Compare note.** With two or more agents ticked, "Each agent starts in its safest mode, in its own worktree." sits in the control row after attach, in `caption` and `fg-subtle`. Every other note stays under the prompt.
- **The agent's sessions.** Once asked for, a header reads "Continue a session from <Agent>" (`caption`, 500, `fg-muted`) with "N in this folder" (`fg-subtle`) on the right.
  - Each session is a plain 44px row, `radius-lg`, in `fg-secondary`, with its time in `caption` and `fg-subtle`.
  - The hovered or focused row fills `surface-hover` and shows an outline **Continue** at 26px. Continue is not part of the row's name.
