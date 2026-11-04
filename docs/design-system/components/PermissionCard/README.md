# PermissionCard

An agent's request for permission, inline in the chat, with the agent's own choices as buttons.

The consumer provides the agent's name, what it wants to do in one sentence, the exact command or file, and the options the agent offers.

- `attention-surface` with a full `attention-border` and `radius-xl`; the alert icon is `status-attention`. No colored left edge.
- The title in `fg` is one sentence that says who wants what: "Claude Code wants to edit src/app.ts", made from the agent's own title when it starts with a verb. Otherwise it reads "Claude Code wants your permission", and the agent's title follows under it. There is no tool badge.
- The command sits in a `code` block on `bg`.
- The buttons run Deny (ghost), Always allow (outline), Allow once (primary), so the safe choice comes first; the agent's own labels and its order within a kind stay.
- A card that asks the agent's questions (Qwen Code) is titled "<Agent> has a question for you" and keeps its form.

## Elicitation card

An agent's request for input or to open a page is not a permission: `surface-2` with `border-strong`, a message icon in `fg-muted`, Decline (ghost), Dismiss (ghost) and **Submit** (primary).
