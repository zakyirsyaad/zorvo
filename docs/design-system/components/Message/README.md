# Message

A message in the chat: yours, or the agent's with its tool runs, and the status of the turn under the last one. Every part of the chat sits in one 680px column (`max-w-chat`), on a canvas padded 32px at the top, 24px at the sides and 16px at the bottom, with 24px between messages.

The consumer provides the message, the agent's name and id (for its logo), and the handlers for the actions that apply.

- **Your message:** a `surface-2` bubble with a `border` edge on the right, at most 85% of the column, radius 12, padding 10px 14px, `body` text in `fg`. No header and no time under it; the time is the bubble's tooltip. Copy and Rewind to here (which asks once more: "Rewind?") show when you point at the message or tab into it.
- **The agent's message:** no bubble. A header with the agent's 16px logo, its name in `ui-sm` weight 500 `fg-secondary` and the time in `caption` `fg-subtle` (no time for a message replayed from the agent's history), 10px above the body in `body` 14/22 `fg-secondary`. Once the turn has ended, the whole reply fills `surface-1` on hover (padding 12, radius 10; the padding is there from the start, so nothing moves), and Copy, Fork from here and Read aloud show under it as 24px icon buttons in `fg-secondary`.
- **Tool runs:** one `surface-1` card per run of tools, with a 34px summary in `ui-sm` ("Read 2 files, ran a command") and on its right "N still running" in `fg-subtle`, or the file touched last in mono ("sidebar/SessionList.tsx +1"). Opened, one 30px row per tool, with no dividers:
  - its kind's icon, the verb in a 56px `fg-muted` column, the path in mono 11px (cut at its start, so the file's name stays in sight) or the command (cut at its end);
  - an edit's `+N −N` in mono;
  - a status claimed only once the agent said so: Done in `fg-subtle`, Failed in `danger`, Did not finish in `fg-muted`, or "Running" in `status-running` beside a turning arc.
  - A command's output is indented 76px, on `terminal-bg` in `terminal-fg`, with no edge.
- **Turn status:**
  - While the agent works: a 6px `status-running` dot with a soft 4px ring, "Claude Code is working" in `ui` `fg-secondary`, and the time since your message in `caption` `fg-subtle`. Nothing pulses.
  - After a minute of silence: a `surface-1` notice with a clock in `status-attention`, "Claude Code hasn't sent anything for N minutes. It may be stuck." in `fg-secondary`, and a 24px **Stop** with a square.
  - A failed turn: one `danger-surface` row with a `danger` edge under the last message, a circle-alert in `danger`, the reason in `ui` `fg`, then a 28px **Try again**, Details and Dismiss. Details open under the row.
- **Delegation status:** under A's last message while B works, the turn status's shape: a 6px `status-running` dot with its soft 4px ring, "Codex is working on the task you delegated" in `ui` `fg-secondary`, the time since B's turn started in `caption` `fg-subtle`, then a 24px ghost **Open** (selects B). While B waits on a permission or a question it reads "Codex needs your answer", with a 6px `status-attention` dot and no ring; after a failed turn of B, "Codex's turn failed" with a circle-alert in `danger`. While A itself works, its own turn status shows instead. The line sits in an always-mounted `role="status"` region, and nothing pulses.
  B's own line mirrors it while A works on B's report: "Claude Code is working on Codex's report", the same dot and ring, the time, and **Open** (selects A).
- **Delegated from:** B's one quiet line above its first message, as an imported session says where its earlier messages are: "Delegated from Fix login bug · Claude Code" in `caption` `fg-muted`, with **Open** as a text button. When A is gone it reads "The session that delegated this is gone." with no **Open**; after End delegation, "Delegated from Fix login bug · ended".
- **Report message:** the report is the user's side of the chat, so it is a right-hand bubble (`surface-2`, `border`, radius 12, padding 10px 14px, `body` `fg`). Over it, a header like the agent's: the reporting agent's 16px logo and "From Codex" in `ui-sm` weight 500 `fg-secondary`, right-aligned. The bubble's text is the report as sent.
- **Selection and Reply:** selected text is tinted `selection`. The Reply toolbar is a 2px-padded `surface-3` panel with a 28px **Reply** in `fg`.
- **The folder card is gone:** the sidebar and the top bar say where a session runs. An imported session whose history stays in the agent says so in one quiet line above its first message.
