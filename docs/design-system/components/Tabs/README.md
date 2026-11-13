# Tabs

A tab strip for the inspector (Changes, Activity, Files, Terminal) and any panel with a few views of the same thing.

The consumer provides the tabs, the selected id and the panels. `tabIds(prefix, id)` gives the ids a tab and its panel share, so the panel can say `role="tabpanel"` with `aria-labelledby` pointing back at its tab.

- A segmented control: a track (`chip` fill, `radius-lg`, 2px padding and gap) of 26px items (10px side padding, `radius-md`, `ui-sm` text). The selected item is `fg` on `surface-hover`; the others are `fg-muted`, `fg` on hover. `segmented-style.ts` holds the two class sets, so a radio group or a toggle group can wear the same look.
- A count shows after the label in `fg-muted`, only when it is above zero (Changes 3).
- Left and Right move to the next tab and wrap; Home and End jump to the first and last. Moving selects the tab and focuses it.
- Only the selected tab is in the tab order (`tabIndex` 0); every tab gets `focus-ring`.
- The track keeps its own 30px height; a strip that is taller centres it.
