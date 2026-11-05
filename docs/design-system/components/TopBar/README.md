# Top bar

The 48px bar across the top of the chat: what is open on the left, the chips that have something to say and the session's controls on the right. The sidebar runs the window's full height beside it, and the native macOS traffic lights float in the sidebar's own header; while the sidebar is hidden they float over this bar, which then keeps their 78px inset.

The consumer provides the session's title, branch and pull request, the plan, the background tasks, the diff totals, and a handler for each action that applies.

- Left: the session title in `ui` weight 600, `fg` (double-click to rename it: the title becomes a field, Return saves, Escape cancels), the branch as a plain `Chip` with its mono name and a `fg-muted` icon, and the pull request chip ("#134" in mono, then "Open", "Draft", "Merged" or "Closed"). With no session open it shows the draft's folder name, else "Zorvo".
- While the sidebar is hidden, **Show sidebar** (`fg-secondary`), **Back** and **Forward** lead the bar, close together; a disabled one is `fg-subtle`. Otherwise the sidebar has Hide sidebar in its header.
- Right, 12px apart: outline chips shown only when they have content — the plan (`2/4` in mono), **N background tasks** (with a turning arc) and the diff `+42 −11` in mono — then the **Inspector** toggle and the ⋯ menu, both `fg-secondary`, filled while open.
- Plan opens a 340px popover: "Plan from <agent>" with "2 of 4 done" on the right, then one 30px row per step: Done (a circle-check, the text `fg-muted`), the current step (a turning arc in `status-running` on a `surface-hover` row, the text `fg`) or Not started (an empty circle in `fg-subtle`, the text `fg-secondary`).
- Background tasks opens a popover: "Background tasks" with "N running" on the right, each task with a 28px icon tile, its name (mono 12px for shell commands), origin, the status word and the elapsed time on the right (the time in mono), 24px **Open** (sessions and subagents) and **Stop**, then "Tasks keep running when you switch sessions. Stop ends the process."
- The diff chip opens the full diff review in the chat's place.
- ⋯ is a 220px menu with **Open in new window**, **Open in Finder**, **Rename** and, after a rule, **Archive**, each with its icon and each only when it applies (a compare run's sessions share one title, so they are not renamed here).
- Empty areas of the bar drag the window; a title you can rename does not, since a double-click there would zoom the window.
