# SessionRow

One session in the sidebar, two lines, top-aligned: the agent's tile with a status badge, the title, then the agent and what it is doing.

The consumer provides the title (from the first message, cut with an ellipsis), the agent's name and logo, the status and when the session started.

- Left: a 22px `AgentTile` (the agent's real logo on a `chip` square, radius 6, a `border` edge) with a status badge on its bottom-right corner: `status-attention` waiting, `status-running` working, `status-unread` finished unread, none when idle. The badge is an 8px dot ringed in the colour behind the tile (`ground`, then `surface-hover` on the open or hovered row). It never pulses and is hidden from assistive tech: the words carry the meaning.
- Line 1: the title in `ui`. Idle, `fg-secondary`; unread, `fg-secondary` at weight 500; the open session, `fg` at weight 500. An idle row's time sits at the right of this line in `caption` `fg-subtle`, in a short form: "now", "5 min ago", "2 h ago", "Yesterday", "Oct 28", "Oct 28, 2025". On hover or keyboard focus the actions take the time's place.
- Line 2, in `caption`: a session in its own worktree starts with an 11px branch icon named "Runs in its own worktree"; then the agent's name and, when there is a status, "· Working", "· Waiting for you" or "· Finished, unread". An idle row shows only the agent there; a fork ends with "· fork", and a session another agent took a task into ends with "· delegated". A long agent name is cut, the status words never are. The line is `fg-subtle` at rest and `fg-muted` on the `surface-hover` of a hovered or open row (`fg-subtle` fails there). The tooltip keeps the long form, with how long ago the session started.
- Padding 7px 8px, 10px between the tile and the text, radius 8. The open session and hovered rows fill `surface-hover`. Rows sit on `ground`.
- On hover or keyboard focus, the actions join the row on the right, in its flow, taking the time's place, and the title gives way to them: Stop while the agent works, and ⋯ (the shared `Popover`) with Rename, Pin, Archive and Delete, both 24px in `fg-secondary` with 12px icons. Archive and Delete are not offered while the agent works.
- Delete closes the menu and asks **Delete?** in the row, where the actions sit: a focused 24px pill in `danger` on `danger-surface`, 12px at weight 500, radius 4. Return deletes; Escape gives up and puts focus back on ⋯; it also gives up when focus moves on, and turns back by itself after 4 seconds.
- Rename keeps the row's fill and tile: a 26px field (radius 6, a 1px `fg` edge, `ground` fill, 8px sides) with "Return saves, Esc cancels" under it in `caption` `fg-subtle`.
- Forks and delegated sessions sit on a rail under their source: 18px in, a `border` line, 8px after it; a delegated session whose source is archived or gone is listed as an ordinary row. Rows never reorder when a status changes.

## Folder header

Open, a small label: a 12px folder icon and the name in `caption` at weight 500, `fg-muted`, then the folder's session count in `caption` `fg-subtle` (forks and compare runs counted). On hover or focus, a 22px + (new session in this folder, with the agent menu, radius 4) and a 22px fold chevron appear on the right. Folded, a 32px row led by a chevron, the name in `ui` `fg-secondary`, and on the right what its sessions are doing, counting forks and compare runs: a 6px dot and "1 waiting" in `status-attention`, else a running dot and "2 working" in `fg-muted`, else "3 sessions" in `fg-subtle` with no dot.

## Compare run

One group row, two lines like a session row: a 22px tile holding the columns icon, with the badge of the run's most urgent state; the run's task as the title; then "Compare · 2 working, 1 finished". The agent count ("Compare · 3 agents") is in the row's accessible name and its tooltip. A click opens the run's panel; its sessions stay listed under it, each named by its agent.

## Above and below the list

The top block is a 32px row: **New session** (fills the row, `surface-2` with a `border` edge, radius 8, weight 500, a 14px plus at the left) and a 32px **Search sessions** icon button of the same fill and edge. Pressing Search swaps the row for the search field (same height, focused, a 13px search icon, a **Close search** button at the right); Escape or Close search closes it, clears the query and puts focus back on Search sessions.

Under it, the filter: three toggle buttons, **All**, **Needs you** and **Working**, each pressed or not (`aria-pressed`, the segmented control's selected fill without its track). Needs you counts sessions waiting for you plus those finished unread, in `status-attention` at weight 600; Working counts busy sessions (a compare run's members one each), in `fg-subtle`. A count shows only above zero. A filter hides folders with no match and applies to Pinned; Archived shows only under All. It never changes which session is open: a session that does not match leaves the list while its chat stays. An empty result reads "No sessions need you." or "No sessions are working.".

The list has 8px sides. **Pinned** is a sentence-case heading with a 12px pin icon (`caption`, weight 500, `fg-muted`). **Archived** sits at the bottom of the list, with its count in `fg-subtle` at weight 400.
