# PermissionCard

An agent's request for permission, inline in the chat, with the agent's own choices as buttons.

The consumer provides the agent's name, what it wants to do in one sentence, the exact command or the files it edits, and the options the agent offers.

- `attention-surface` with a full `attention-border`, radius 12 and 16px padding, its parts 12px apart; the alert icon is `status-attention`. No colored left edge.
- The title in `ui` weight 600 `fg` is one sentence that says who wants what: "Claude Code wants to edit src/app.ts", made from the agent's own title when it starts with a verb. Otherwise it reads "Claude Code wants your permission", and the agent's title follows under it. There is no tool badge.
- An edit lists its files on `ground` in a bordered box, one row each: the path in mono 12px `fg-secondary`, then `+N` in `status-running` and `−N` in `danger`, in mono 11px, each shown only when it is not zero. A diff too large to keep is not listed.
- A command sits in a mono 12px box on `ground`.
- The buttons are right-aligned, 28px, with no icons and no rule above them: Deny (ghost), Always allow (outline), Allow once (primary), so the safe choice comes first; the agent's own labels and its order within a kind stay.
- A card that asks the agent's questions (Qwen Code) is titled "<Agent> has a question for you" and keeps its form.

## Elicitation card

An agent's request for details or to open a page is not a permission: `surface-2` with `border-strong`, radius 12, 16px padding, its parts 14px apart.

- The agent's 16px logo, then "Codex needs a few details" (or "Codex wants to open a page") in `ui` weight 600 `fg`, with a 24px Dismiss at the top right; the agent's message under it in `ui` `fg-muted`.
- Labels in `ui` weight 500 `fg-secondary`; inputs 32px, radius 8, `border-strong` on `ground`.
- Decline (ghost) then **Submit** or **Open in browser** (primary), right-aligned, with no rule above them.
