# Composer

The message box of a session: a floating card at most 680px wide, with a growing textarea above a row of the agent's controls, ending in Send. One `ComposerDock` serves every session and the new-session draft, and stays at one place in the window, so what you typed survives a switch.

The consumer provides the placeholder (name the active agent), the controls and the send handler.

- **Card.** `surface-2` with a `border` edge, `radius-xl` and `shadow-popover`. The edge turns `border-strong` while focused.
- **Text.** The prompt is `body` on `fg`, with the placeholder in `fg-subtle`. The note under it is `caption` in `fg-muted`: why Send is blocked, else that the agent's options are loading.
- **Attachments.** Images show above the textarea as 96×64 thumbnails with a round remove button, and clicking one opens `ImagePreviewDialog`. Other files are name chips.
- **Bottom row, left.** Attach, then the agent's controls in the order model, mode, effort, then the agent's extras (collaboration mode, fast mode and so on). Each is a 24px bordered chip in `ui-sm` with `radius-md`. A risky mode's chip carries `ShieldAlert`.
- **Overflow.** At most `MAX_INLINE_CONTROLS` (3) controls sit in the row. The rest go into the **More options** ⋯ menu, as one group per control with its choices as radio items. It is a count, not a measurement, so the chips never move while the window is resized.
- **Bottom row, right.** The context meter ("38% of context", which opens the numbers behind it), then Send.
- **Send.**
  - Send is the only primary control. It is disabled while the text is empty, and while Send is blocked it is `aria-describedby` the note.
  - `sendLabel` words it ("Start 2 sessions") in place of its icon.
  - While the agent works, Stop takes its place, as an outline icon button.
- **Menus.** The mode, model and other chips open `Popover`s above themselves. A list over 10 choices gets "Search <label>", with the matches in bold and "N of M <label>s" under it. A risky mode says "Lets the agent act without asking" in the attention color.
- **`/` and `@`.** These open lists above the prompt with the popover's look: "Commands from <Agent>" with command names in mono, and "Files in <folder>" with the file name in mono, the match in bold and its folder under it. The prompt keeps focus, and ↑ ↓, Return, Tab and Escape drive the list.
- **Draft chips.** Before a session starts, three chips sit above the card:
  - **Folder:** search, "Recent folders", **Open another folder…**.
  - **Branch** (in a repository): search, "Local branches", and the **New worktree** switch with "Works on its own copy from <branch>. Your checkout stays as it is.". While the switch is on, the chip reads "<branch> · new worktree".
  - **Agent:** in a repository, a multi-select list with each agent's logo, name and readiness. Agents that need a sign-in or an install are dimmed and say why.

  The draft centers the composer: "New session in <folder>" above it, and the agent's own sessions to continue below it.
