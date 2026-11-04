# SessionRow

One session in the sidebar, 44px and two lines: its title, then its agent and what it is doing.

The consumer provides the title (from the first message, cut with an ellipsis), the agent's name, the status and when the session started.

- Line 1: the title in `ui`, `fg-muted`, `font-medium` and `fg` while unread. Line 2: "Claude Code · Working" in `caption` `fg-muted` (not `fg-subtle`, which fails on the `surface-hover` of the open and hovered rows). The words are "Waiting for you", "Working" and "Finished, unread"; a long agent name is cut, the status words never are. An idle row shows how long ago the session started ("2 hours ago").
- The status dot sits on the left and never hides: `status-attention`, `status-running` (the only one that pulses, under `motion-safe`) or `status-unread`. An idle row keeps the slot empty so titles line up. The words carry the meaning; the dot is hidden from assistive tech.
- A session in its own worktree shows a branch icon named "Runs in its own worktree".
- The open session and hovered rows fill `surface-hover`. Rows sit on `surface-1` with `radius-md`.
- On hover or keyboard focus, the actions appear on the right: Stop while the agent works, and a ⋯ menu (the shared `Popover`) with Rename, Pin, Archive and Delete. Archive and Delete are not offered while the agent works. Delete turns into "Delete?" on `danger-surface` in `danger` and turns back by itself after 4 seconds.
- Forks sit under their source, indented with a `border` guide line. Rows never reorder when a status changes.

## Folder header

The folder icon and name in `ui-sm`. On hover or focus, a + (new session in this folder, with the agent menu) appears, and the chevron of an open folder. A folded folder says what its sessions are doing, counting forks and compare runs: "1 waiting" in `status-attention`, else "2 working", else "3 sessions", in `caption`.

## Compare run

One group row, two lines like a session row: the agents' logos stacked (decorative) and the run's task, then "Compare · 3 agents · 2 working, 1 finished". A click opens the run's panel; its sessions stay listed under it, each named by its agent.
