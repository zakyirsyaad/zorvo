# Message

A message in the chat: yours, or the agent's with its tool runs, and the status of the turn under the last one.

The consumer provides the message, the agent's name and id (for its logo), and the handlers for the actions that apply.

- **Your message:** a `surface-2` bubble on the right, at most 85% of the column, `radius-2xl`, `body` text in `fg`. No header. Under it, its time stays on screen; Copy and Rewind to here (which asks once more: "Rewind?") show when you point at the message or tab into it.
- **The agent's message:** no bubble. A header with the agent's logo, its name in `ui` weight 500 and the time in `caption` `fg-muted` (no time for a message replayed from the agent's history); the body in `body` 14/22 `fg-secondary`. Under it, once the turn has ended, Copy, Fork from here and Read aloud as icon buttons, shown on hover or keyboard focus.
- **Tool runs:** one bordered card per run of tools, its summary in words ("Read 2 files, ran a command") with "N still running" while any run and "N failed" in `danger`. Opened, one row per tool: its kind's icon, the verb, the target in mono, an edit's `+N −N`, and a status word claimed only once the agent said so (Done, Failed, or Did not finish for a tool left running when the turn ended); a running tool shows a spinner. A command's output reads on the terminal's dark ground.
- **Turn status:** while the agent works, a pulsing `status-running` dot, "Claude Code is working" and the time since your message. After a minute of silence a muted notice says "Claude Code hasn't sent anything for N minutes. It may be stuck." with Stop. A failed turn is a `danger-surface` card with a `danger` border, the reason, **Try again**, Details and dismiss, under the last message.
