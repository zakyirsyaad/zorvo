# Button

A text button for actions in cards, dialogs and toolbars, in four variants: primary, outline, ghost and danger.

In the app: `<Button variant="primary">` from `src/components/ui/Button.tsx`. In previews: `<button class="z-btn z-btn--primary">`. The consumer provides the label (a verb, one to three words, sentence case) and an optional leading Lucide icon at `size-icon`.

- **Primary** (`primary` / `on-primary`): the one action a view exists for, such as Allow or Send. Never two in a view.
- **Outline** (`border-strong`): the alternatives next to it, such as Always allow or Open in Finder.
- **Ghost**: low-stakes actions such as Cancel or Show more.
- **Danger** (`danger` on `danger-surface`): destructive actions such as Deny or Delete session.
- A disabled primary turns flat (`surface-hover`, `fg-muted` label); the other variants drop to 40% opacity. All keep their label. Say why nearby rather than leaving a dead button.

Three heights, from the canvas, at weight 500 and `radius-lg`:

- `size="sm"`: 24px, `ui-sm` text, 8px sides. A small action in a row or a card: Open and Stop in Background tasks, Sign in in the Agents menu, a toast's action.
- `size="md"` (the default): 28px, `ui` text, 12px sides.
- `size="lg"`: 32px, `ui` text, 12px sides. A lead action, such as the sidebar's **New session**.

`align="start"` puts the icon and label at the left edge (New session); the default centres them.
