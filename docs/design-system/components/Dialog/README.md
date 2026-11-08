# Dialog

A modal for settings and confirmations, over the `overlay` scrim.

The consumer provides the title, the fields and the actions.

- `surface-1` with a `border` edge, `radius-xl`, `space-5` padding and `shadow-dialog`.
- Title in `heading`; a Close `IconButton` top right; Escape closes it.
- Fields: a `label` in `ui` weight 500, an input with a `border-strong` edge, a hint in `caption` and `fg-subtle`.
- Actions sit bottom right above a `border` rule: Cancel as ghost, the confirming action as primary.

## Delegate to another agent

The dialog the session's ⋯ menu and the composer's **Change** open: pick an agent, write the task, and see what that agent starts on.

- Title "Delegate to another agent" in `heading`, a Close `IconButton` top right; Escape closes, and an open chip's menu closes on the first Escape.
- **Agent** label in `ui` weight 500, then one 36px row per agent in use: its 16px logo, its name, and its status on the right — "Ready" (`fg-muted`), "Not checked" (`fg-subtle`), "Needs sign-in" (`status-attention`, after a dot) or "Not installed" (`fg-subtle`). One choice only, so each row is a radio. A row that cannot be picked (not installed) is at 55% opacity, and its status describes its control.
- **Task** label, then a 3-row textarea with a `border-strong` edge. An empty task's error, "Write the task first.", is `caption` `danger` under the textarea.
- Under the task, "<Agent> starts on" in `ui` weight 500 and the picked agent's model, effort and mode as 28px borderless chips with `radius-md`, `ui-sm` `fg-secondary` and a 12px chevron in `fg-muted`; a risky mode keeps its `ShieldAlert`. An agent whose options are unknown shows one **Default** chip, and is asked only when that chip opens. Opening the dialog starts no agent.
- The line about what happens follows in `caption` `fg-subtle`: "<Agent> reads this conversation first and works in the same folder. Each answer it gives is sent to <source agent>.", adding "<source agent> isn't running, so its reports wait in its composer." when it is not.
- Actions bottom right above a `border` rule: **Cancel** (ghost) and **Delegate** (primary); with no task, Delegate shows the error instead of starting.

## Terminal sign-in and setup

An agent's own login, or its own setup (Qwen Code: pick a provider), run in a terminal inside the dialog (`TerminalSignInDialog`).

- 760px wide (`max-w-[760px]`), the parts carrying their own padding. The header (16px 20px) has the agent's logo in a 24px `surface-hover` tile (radius 6) and the title at 16/24 600 ("Sign in to Qwen Code", or "Set up Qwen Code"), with no method line under it. The GitHub sign-in uses the same dialog without a logo.
- A `role="status"` line in the footer, left of Close, in `ui-sm` `fg-muted`. While the program runs it reads "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this.", unless the login has its own note; then "Checking your sign-in…", or the failure in `danger`.
- Zorvo checks the sign-in when the program ends, and when **Close** ends it while it runs. Close during the check only hides the dialog, and the check finishes and sends a held message; Close while it starts or after it failed only cancels. A setup's exit always counts as done, whatever its code, since the user quits the agent's app.
- The terminal is 380px tall on `terminal-bg`, 20px in from the dialog's sides, with xterm inset 14px 12px inside it, and has focus while the login runs.
- The footer (16px 20px) has the status line, **Close** (outline, in `fg`), and **Try again** (primary) after a failure, which then takes focus; otherwise Close does. Escape closes, and the header's X is "Cancel sign-in".
