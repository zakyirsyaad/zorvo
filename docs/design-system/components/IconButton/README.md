# IconButton

A square icon-only button for toolbars, the composer and row actions.

In the app: `<IconButton label="…">` from `src/components/ui/IconButton.tsx`, which sets the `aria-label` and the tooltip from `label`. In previews: `<button class="z-icon-btn" aria-label="…">`. The consumer provides one Lucide icon and an `aria-label` that says what it does ("Close", "Open terminal").

- Ghost by default: `fg-muted`, filling `surface-hover` on hover. `tone="secondary"` draws it in `fg-secondary`, for the top bar's Show sidebar, Inspector and ⋯.
- An open one (`aria-expanded`, a menu showing) or a pressed one (`aria-pressed`, the Inspector while it is open) keeps the `surface-hover` fill.
- `z-icon-btn--primary` is the composer's Send button only: `primary` fill at `radius-lg`.
- Three squares: `size="xs"` 22px (a toast's Dismiss), `size="sm"` 24px (a row's Stop), `size="md"` 28px, the default, so toolbars line up.
- Show a tooltip with the same words as the `aria-label`.
