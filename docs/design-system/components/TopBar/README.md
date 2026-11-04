# Top bar

The bar across the top of the main window: what is open on the left, the chips that have something to say and the session's controls on the right. It sits under the native macOS traffic lights, which keep their 78px inset.

The consumer provides the session's title, branch and pull request, the plan, the background tasks, the diff totals, and a handler for each action that applies.

- Left: the session title in `ui` weight 500 (double-click to rename it: the title becomes a field, Return saves, Escape cancels), the branch as a plain `Chip` with its mono name, and the pull request chip. With no session open it shows the draft's folder name, else "Zorvo".
- While the sidebar is hidden, **Show sidebar**, **Back** and **Forward** lead the bar; otherwise the sidebar has them.
- Right: outline chips shown only when they have content — **Plan 2/4**, **N background tasks** and the diff `+42 −11` — then the **Inspector** toggle and the ⋯ menu.
- Plan opens a popover: "Plan from <agent>", "2 of 4 done", one row per step with Done (a check in the running color), In progress (a spinner) or Not started (an empty circle).
- Background tasks opens a popover: "Background tasks · N running", each task with its kind, name (mono for shell commands), origin, status word, elapsed time, **Open** (sessions and subagents) and **Stop**, then "Tasks keep running when you switch sessions."
- The diff chip opens the full diff review in the chat's place.
- ⋯ is a menu with **Open in new window**, **Open in Finder**, **Rename** and **Archive**, each only when it applies (a compare run's sessions share one title, so they are not renamed here).
- Empty areas of the bar drag the window; a title you can rename does not, since a double-click there would zoom the window.
