# AgentTile

A rounded square around an agent's logo, or an icon, that marks which agent a row, message or chip belongs to. It carries an optional status badge.

The consumer provides the agent (`profileId`, drawn with its real logo) or an icon as children, and a `name` when nothing beside the tile says it (pass `""` when the name is written next to it).

- Fill `chip` with an inset 1px `border` ring.
- Three sizes: 16 (4px radius, 10px logo), 22 (`radius-md`, 6px, 14px logo) and 28 (`radius-lg`, 8px, 16px logo). 22 is the default, used in session rows and message headers.
- The badge is an 8px dot at the lower right, with a 2px ring in the color behind the tile (`badgeOn`: `ground` in the sidebar, `sheet` on a sheet, `hover` on a hovered or selected row), so it reads as cut out of the tile.
  - `status-attention`: the agent waits on you. `status-running`: it works. `status-unread`: it finished while another session was open. No badge: idle.
  - The dot does not pulse. It is `aria-hidden`: the row always says the state in words too (a status word next to the title), never the dot alone.
