# Popover

The one popover style, for every menu and picker that opens from a control: the composer's mode, model and effort chips, the folder and agent pickers, slash commands, mentions, the plan and background-task menus, the diff view's target picker.

`Popover` holds the trigger and, while `isOpen`, the panel. The consumer owns `isOpen` and gets `onClose` on Escape or a click outside. When the popover closes while focus is inside it, focus goes back to the trigger, so a keyboard user keeps their place.

- Panel: `surface-3`, `border`, `shadow-popover`, `radius-lg` (8px), 6px padding.
- Options (`PopoverOption`): 30px tall, `radius-sm` (4px), `ui` text, `surface-hover` on hover.
  - A row you can check (an `option`, a radio item, or any row given `selected`) keeps a 14px slot on the left, holding the check while selected. A command such as Rename has no slot.
  - The selected option also has `surface-hover`.
- A `description` goes under the label in `caption` at 11/15 in `fg-subtle` ("Edits files without asking"), and the row tops its check. `trailing` holds a short hint at the right edge ("checked out").
- `PopoverHeader`: a `caption` `fg-muted` heading over a group, padded 6/8/4. Its `aside` sits on the right in `fg-subtle` at weight 400 ("Pick more than one to compare").
- `PopoverSearch`: the 30px search field at the top of a long menu, with its 12px icon, on `surface-2` with a `border` edge and `radius-sm`. Its placeholder is its name ("Search branches"). The field's edge takes the focus ring (`focus-ring-within`).
- Roles: `menu` (the default) makes each option a `menuitem`; `listbox` makes each one an `option` with `aria-selected`; `dialog` is for a panel with its own fields, such as a search box over a list.
- `side="top"` opens above the trigger (the composer, at the bottom of the window); `align="end"` lines the panel up with the trigger's right edge.
- The panel is positioned against the trigger. When it opens, it measures the room it has: the viewport, narrowed by every ancestor that clips (`overflow-hidden`). It opens on its `side` when it fits there, else on the side with more room. When it fits on neither side, it is capped to the room on the larger side (never under 96px) and scrolls. `fitPanel` in `lib/popover-fit.ts` makes that call. A panel with its own `panelClassName` is left where it is put.

- `PopoverList` puts a `listbox` inside a `dialog` popover, beside a search field the listbox cannot hold. Its `PopoverOption`s are `option`s.
- `isRadio` makes an option in a `menu` a `menuitemradio`, checked while `selected`. This is for a set of choices rather than commands, like the composer's **More options** menu.
- `POPOVER_PANEL_STYLE` is the panel's look without its position. The `/` and `@` lists use it, since they keep focus in the prompt and so cannot be a `Popover`.
- `Highlighted` shows what a search matched in bold (`mark`, `font-semibold`, `fg`). It matches case-insensitively, as plain text.

On it so far: `DiffViewHeader`, `OptionDropdown`, `MoreControls`, `FolderPicker`, `BranchPicker`, `AgentMultiPicker`, `PlanMenu` and `BackgroundTasksMenu`. `SlashCommandMenu` and `MentionMenu` share its look through `POPOVER_PANEL_STYLE`.
