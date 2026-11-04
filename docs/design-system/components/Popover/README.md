# Popover

The one popover style, for every menu and picker that opens from a control: the composer's mode, model and effort chips, the folder and agent pickers, slash commands, mentions, the plan and background-task menus, the diff view's target picker.

`Popover` holds the trigger and, while `isOpen`, the panel. The consumer owns `isOpen` and gets `onClose` on Escape or a click outside. When the popover closes while focus is inside it, focus goes back to the trigger, so a keyboard user keeps their place.

- Panel: `surface-3`, `border`, `shadow-popover`, `radius-lg` (8px), 6px padding.
- Options (`PopoverOption`): 30px tall, `radius-sm` (4px), `ui` text, `surface-hover` on hover. The selected option has `surface-hover` and a check at the right edge.
- A `description` goes under the label in `caption` `fg-muted` ("Edits files without asking"). `trailing` holds a short hint at the right edge.
- `PopoverHeader`: a `caption` `fg-muted` heading over a group.
- Roles: `menu` (the default) makes each option a `menuitem`; `listbox` makes each one an `option` with `aria-selected`; `dialog` is for a panel with its own fields, such as a search box over a list.
- `side="top"` opens above the trigger (the composer, at the bottom of the window); `align="end"` lines the panel up with the trigger's right edge.
- The panel is positioned against the trigger, so place the popover inside an ancestor that does not clip (`overflow-hidden` cuts it off).

- `PopoverList` puts a `listbox` inside a `dialog` popover, beside a search field the listbox cannot hold. Its `PopoverOption`s are `option`s.
- `isRadio` makes an option in a `menu` a `menuitemradio`, checked while `selected`. This is for a set of choices rather than commands, like the composer's **More options** menu.
- `POPOVER_PANEL_STYLE` is the panel's look without its position. The `/` and `@` lists use it, since they keep focus in the prompt and so cannot be a `Popover`.
- `Highlighted` shows what a search matched in bold (`mark`, `font-semibold`, `fg`). It matches case-insensitively, as plain text.

On it so far: `DiffViewHeader`, `OptionDropdown`, `MoreControls`, `FolderPicker`, `BranchPicker`, `AgentMultiPicker`, `PlanMenu` and `BackgroundTasksMenu`. `SlashCommandMenu` and `MentionMenu` share its look through `POPOVER_PANEL_STYLE`.
