# Toast

A notice in the bottom right corner of the main area, over the chat: a failure you should know about, or a warning that needs no answer right now.

`ToastStack` holds the toasts and sits inside the main area's `relative` container; `Toast` is one card. The consumer provides the message and the dismiss handler, and optionally one action.

- Card: 340px wide, `surface-3`, `border`, `shadow-popover`, `radius-panel` (10px), 12px padding. A long message (a path, an error text) wraps inside the card.
- Tone sets the icon and how it is spoken: `warning` (the default) has a circle-alert in `status-attention`, `info` a `fg-muted` one; both are `role="status"` with the message in `fg-secondary`. `error` has a `danger` circle-alert, a `danger` edge and the message in `fg`, and is `role="alert"`, so a screen reader reads it at once.
- The main window's notices say which they are: something that failed is an error; a notice that asks you to do something first (open a folder, install an agent, a dropped file left out) is a warning.
- One action at most, as a 24px outline `Button` under the message ("Try again"), its label in `fg`. Dismiss is a 22px `IconButton` with a 12px icon, named "Dismiss notice".
- The message says what happened in a short sentence ("Could not open the link."); the agent's raw error goes after it, never alone.
- Toasts stack upward with 10px between them.

## The update card

A newer Zorvo shows as a card in the same stack, above any toast (`AppUpdateNotice`).

- 340px, `surface-3`, `border`, `radius-xl`, `shadow-popover`, 14px 16px, `role="status"`.
- "Zorvo 0.9.0 is ready" in `ui` at 600, then what a restart ends, counted, in `ui-sm` `fg-muted` ("Restarting stops 2 agents mid-turn and 1 shell."), nothing when it ends nothing.
- **Later** (ghost, `fg-secondary`) and **Update & restart** (outline, in `fg`) at the right. While it installs, Later goes and the line reads "Downloading…" with its percent shown but not announced, then "Installing…".
- It stays above the composer, where the stack sits, rather than in the window's very corner, which is the composer's Send button.
