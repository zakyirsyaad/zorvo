# SessionRow

One session in the sidebar, about 50px and two lines, top-aligned: its title, then its agent and what it is doing.

The consumer provides the title (from the first message, cut with an ellipsis), the agent's name and logo, the status and when the session started.

- Line 1: the title in `ui`. Idle, `fg-secondary`; unread, `fg-secondary` at weight 500; the open session, `fg` at weight 500.
- Line 2, in `caption`: a session in its own worktree starts with an 11px branch icon named "Runs in its own worktree"; then the agent's logo (14px, decorative, since its name follows), the agent's name, and the status: "Claude Code · Working". The words are "Waiting for you", "Working" and "Finished, unread"; an idle row shows how long ago the session started ("2 hours ago"); a fork ends with "· fork", and a session another agent took a task into ends with "· delegated". A long agent name is cut, the status words never are. The line is `fg-subtle` at rest and `fg-muted` on the `surface-hover` of a hovered or open row (`fg-subtle` fails there).
- The status dot sits on the left, 6px below the row's top, and never hides: `status-attention`, `status-running` or `status-unread`. None of them pulses. An idle row keeps the slot empty so titles line up. The words carry the meaning; the dot is hidden from assistive tech.
- Padding 8px, 10px between the dot and the text. The open session and hovered rows fill `surface-hover`. Rows sit on `ground` with `radius-md`.
- On hover or keyboard focus, the actions join the row on the right, in its flow, and the title gives way to them: Stop while the agent works, and ⋯ (the shared `Popover`) with Rename, Pin, Archive and Delete, both 24px in `fg-secondary` with 12px icons. Archive and Delete are not offered while the agent works.
- Delete closes the menu and asks **Delete?** in the row, where the actions sit: a focused 24px pill in `danger` on `danger-surface`, 12px at weight 500, radius 4. Return deletes; Escape gives up and puts focus back on ⋯; it also gives up when focus moves on, and turns back by itself after 4 seconds.
- Rename keeps the row's fill and dot: a 26px field (radius 6, a 1px `fg` edge, `ground` fill, 8px sides) with "Return saves, Esc cancels" under it in `caption` `fg-subtle`.
- Forks and delegated sessions sit under their source, 11px in, behind a `border` guide line with 10px after it; a delegated session whose source is archived or gone is listed as an ordinary row. Rows never reorder when a status changes.

## Folder header

Open, a small label: a 12px folder icon and the name in `caption` at weight 500, `fg-muted`. On hover or focus, a 22px + (new session in this folder, with the agent menu, radius 4) and a 22px fold chevron appear on the right. Folded, a 32px row led by a chevron, the name in `ui` `fg-secondary`, and on the right what its sessions are doing, counting forks and compare runs: a 6px dot and "1 waiting" in `status-attention`, else a running dot and "2 working" in `fg-muted`, else "3 sessions" in `fg-subtle` with no dot.

## Compare run

One group row, two lines like a session row: "Compare · 3 agents", then "2 working, 1 finished", with the agents' logos (16px rounded squares, overlapping by 4px, each with a 2px `surface-1` ring, decorative) on the right. The run's task names the row for assistive tech and in its tooltip. A click opens the run's panel; its sessions stay listed under it, each named by its agent.

## Above and below the list

The top block is **New session** (a 32px outline button, its icon and label at the left) and the search field (30px, radius 8, a `surface-2` fill with no border). The list has 8px sides. **Pinned** is a sentence-case heading with a 12px pin icon (`caption`, weight 500, `fg-muted`). **Archived** sits at the bottom of the list, with its count in `fg-subtle` at weight 400.
