# Button

A text button for actions in cards, dialogs and toolbars, in four variants: primary, outline, ghost and danger.

In the app: `<Button variant="primary">` from `src/components/ui/Button.tsx`. In previews: `<button class="z-btn z-btn--primary">`. The consumer provides the label (a verb, one to three words, sentence case) and an optional leading Lucide icon at `size-icon`.

- **Primary** (`primary` / `on-primary`): the one action a view exists for, such as Allow or Send. Never two in a view.
- **Outline** (`border-strong`): the alternatives next to it, such as Always allow or Open in Finder.
- **Ghost**: low-stakes actions such as Cancel or Show more.
- **Danger** (`danger` on `danger-surface`): destructive actions such as Deny or Delete session.
- A disabled primary turns flat (`surface-hover`, `fg-muted` label); the other variants drop to 40% opacity. All keep their label. Say why nearby rather than leaving a dead button.

Four heights, from the canvas, at `radius-lg`:

- `size="sm"`: 24px, `ui-sm` (12px) text, 8px sides. A small action in a row or a card: Open and Stop in Background tasks, Sign in in the Agents menu, a toast's action.
- `size="row"`: 26px, `ui-sm` text, 8px sides. The inspector's path bars.
- `size="md"` (the default): 28px, `ui-sm` (12px) text, 12px sides.
- `size="lg"`: 32px, `ui` (13px) text, 12px sides. A lead action, such as the sidebar's **New session**.

Weight follows the variant: outline and ghost labels are weight 400, primary and danger are 500, at every size. The one exception is `lg`, which is always 500 (the canvas draws New session as an outline button at 500). A label that the canvas sets a step larger than its button, such as the **Reply** toolbar's 13px, carries `text-ui` on its own span; never put a text size on the Button's `className`.

`align="start"` puts the icon and label at the left edge (New session); the default centres them.
