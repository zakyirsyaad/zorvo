# Dialog

A modal for settings and confirmations, over the `overlay` scrim.

The consumer provides the title, the fields and the actions.

- `surface-1` with a `border` edge, `radius-xl`, `space-5` padding and `shadow-dialog`.
- Title in `heading`; a Close `IconButton` top right; Escape closes it.
- Fields: a `label` in `ui` weight 500, an input with a `border-strong` edge, a hint in `caption` and `fg-subtle`.
- Actions sit bottom right above a `border` rule: Cancel as ghost, the confirming action as primary.

## Terminal sign-in

An agent's own login, run in a terminal inside the dialog (`TerminalSignInDialog`).

- 760px wide (`max-w-[760px]`), with the agent's logo at 24px beside the title ("Sign in to Qwen Code") and the method's name under it in `caption`. The GitHub sign-in uses the same dialog without a logo.
- A `role="status"` line under the header. While the login runs it reads "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when the login finishes.", unless the login has its own note; then "Checking your sign-in…", or the failure in `danger`.
- The terminal is 380px tall on `terminal-bg`, and has focus while the login runs.
- The footer has **Close**, and **Try again** (primary) after a failure, which then takes focus; otherwise Close does. Escape closes, and the header's X is "Cancel sign-in".
