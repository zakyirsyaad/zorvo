# Composer

The message box of a session: a floating card at most 680px wide, with a growing textarea above a row of the agent's controls, ending in Send. One `ComposerDock` serves every session and the new-session draft, and stays at one place in the window, so what you typed survives a switch.

The consumer provides the controls and the send handler. Without a placeholder of its own, the composer reads "Reply to <Agent>". While a permission or question card waits, the app passes "Answer the request above to continue".

- **Dock.** 24px at the sides and 20px under the card in a session. A draft's composer sits inside its column, with no bottom padding.
- **Card.** A column with a 10px gap and 12px padding, on `surface-2` with a `border` edge, `radius-xl` and `shadow-popover`. The edge turns `border-strong` while focused.
- **Text.** The prompt starts two lines tall (44px) in `body` on `fg`, with the placeholder in `fg-subtle`. The note under it is `caption` in `fg-muted`: why Send is blocked. While the agent's options load, skeleton chips say so instead (below).
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
- **Menus.** The mode, model and other chips open `Popover`s with the check on the left and descriptions in `fg-subtle`. In a session they open above the chip, from the bottom of the window. In a draft, whose composer sits near the top of its column, they open below. In both cases a menu flips to the other side when that side has more room, and is capped and scrolls when neither side holds it, so it is never cut off.
  - A model named with a provider tag ("[OpenRouter] kimi-k2") shows its own name on its row, under one heading per provider; search still matches the tag, and the row's tooltip holds the full name.
  - The mode menu is headed "Mode". A risky mode shows its shield after its name, and "Lets the agent act without asking." on its line.
  - A list over 10 choices gets the 30px "Search <label>" field, with the matches in bold and "N of M <label>s" under it in `fg-subtle`.
  - A menu whose choices have a line under them is 300px wide; a short plain list is as wide as its words.
- **`/` and `@`.** These open lists with the popover's look: above the card in a session, under it in a draft, whose card sits near the top of its column. The prompt keeps focus, and ↑ ↓, Return, Tab and Escape drive the list.
  - "Commands from <Agent>": each command in mono 12 over its description in 11/15 `fg-subtle`.
  - "Files in <folder>": a file icon, the name in mono 12 with the match in bold, and its folder in mono 11 `fg-subtle`.
- **New-session draft.** A left-aligned 680px column, 24vh down (at least 120px as the canvas draws it, at most 260px), so in a tall window the composer sits a little above the middle; it is not centred, so nothing jumps when the agent's sessions or a sign-in panel appear below: "New session in <folder>" at 20/28, 600, `-0.02em`. Then the chips, the card, and 24px under it the agent's own sessions, which scroll in their own list (at least 160px of it) so the card stays put. When the window is too short for the rest, or a sign-in panel sits above the card, the main column scrolls instead, so Send is never out of reach; it keeps room for its scrollbar so nothing jumps sideways, never scrolls sideways, and each draft opens at its top. The drop overlay and the update banner stay on the still frame around it, and a notice that appears while the column is scrolled brings itself into view.
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
- **While the agent's options load.** A draft asks its agent what it offers. Meanwhile, three skeleton chips (28px, `radius-md`, `surface-hover`, pulsing only with motion allowed, about 72, 96 and 56px wide) sit in the row where the model, mode and effort chips will land, so nothing moves when they arrive. A screen reader hears "Loading <Agent>'s models and commands…" from an `sr-only` status. No line shows under the prompt. This is not on the canvas.
- **Panels that hold a draft back.** The sign-in and install panels sit between the draft's chips and its card, 12px above the card, so the draft reads heading, chips, what is needed, then the message. In a session they sit right above the composer.
- **Compare note.** With two or more agents ticked, "Each agent starts in its safest mode, in its own worktree." sits in the control row after attach, in `caption` and `fg-subtle`. Every other note stays under the prompt.
- **Compare models.** With two or more agents ticked, the row shows one model chip per agent, in the run's order, each led by its 16px logo and named "<Agent> model: <model>". It shows the model the agent will start on: its remembered pick, else its default.
  - An agent whose list Zorvo does not know yet reads "Default". It is asked for its models only when its chip opens. Meanwhile the menu says "Asking <Agent> for its models…" over skeleton rows. If asking fails, it says "Could not ask <Agent> for its models." with **Try again**, and the run still starts on that agent's default. An agent that answers without any model reads "<Agent> does not offer a model choice. It starts on its default."
  - A pick is that agent's remembered model, so it is also its model in its next single-agent draft. An agent that turns out to need a sign-in leaves the run, with a notice.
- **The agent's sessions.** Once asked for, a header reads "Continue a session from <Agent>" (`caption`, 500, `fg-muted`) with "N in this folder" (`fg-subtle`) on the right.
  - Each session is a plain 44px row, `radius-lg`, in `fg-secondary`, with its time in `caption` and `fg-subtle`.
  - The hovered or focused row fills `surface-hover` and shows an outline **Continue** at 26px. Continue is not part of the row's name.
