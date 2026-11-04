# Chip

A small labelled pill for an attached file or a code reference.

The consumer provides the label and, for attachments, a remove handler with an `aria-label` that names the file.

- Attachments: `caption` text in `fg-secondary` on `surface-2`, `border` edge, `radius-md`.
- Code references (`z-chip--code`): `code-sm` in `fg-muted`, `radius-sm`, for paths, branches and PR numbers.
- Keep labels to the file name; show the full path in a tooltip.

## Top bar chips (`Chip` in `src/components/ui/`)

24px tall, `caption` text, `radius-md`, an optional icon hidden from assistive tech.

- Plain (`variant="plain"`): session info that sits on the bar, such as the branch and the pull request. No border.
- Outline (`variant="outline"`, the default): contextual chips you can click, such as Plan 3/7, background tasks and the diff `+42 −11`. `border` edge.
- A chip with `onClick` is a button with `focus-ring` and a `surface-hover` fill on hover; a chip without one is plain text and never takes focus.
- Give `label` when the visible text alone does not say what the chip is ("42 lines added, 11 removed. Open changes").
