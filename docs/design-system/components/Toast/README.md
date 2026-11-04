# Toast

A notice in the bottom right corner of the main area, over the chat: a failure you should know about, or a warning that needs no answer right now.

`ToastStack` holds the toasts and sits inside the main area's `relative` container; `Toast` is one card. The consumer provides the message and the dismiss handler, and optionally one action.

- Card: 340px wide, `surface-3`, `border`, `shadow-popover`, 10px radius, 12px padding. A long message (a path, an error text) wraps inside the card.
- Tone sets the icon and how it is spoken: `warning` (the default) has a `status-attention` icon, `info` a `fg-muted` one; both are `role="status"`. `error` has a `danger` icon and a `danger` edge, and is `role="alert"`, so a screen reader reads it at once.
- One action at most, as an outline `Button` under the message ("Try again"). Dismiss is an `IconButton` named "Dismiss notice".
- The message says what happened in a short sentence ("Could not open the link."); the agent's raw error goes after it, never alone.
- Toasts stack upward with 10px between them.
