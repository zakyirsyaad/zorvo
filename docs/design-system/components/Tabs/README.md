# Tabs

A tab strip for the inspector (Changes, Activity, Files, Terminal) and any panel with a few views of the same thing.

The consumer provides the tabs, the selected id and the panels. `tabIds(prefix, id)` gives the ids a tab and its panel share, so the panel can say `role="tabpanel"` with `aria-labelledby` pointing back at its tab.

- `ui` text. The selected tab is `fg`, `font-medium`, with a 2px `fg` underline; the others are `fg-muted`, `fg` on hover, with no underline.
- A count shows after the label in `caption` `fg-muted`, only when it is above zero (Changes 3).
- Left and Right move to the next tab and wrap; Home and End jump to the first and last. Moving selects the tab and focuses it.
- Only the selected tab is in the tab order (`tabIndex` 0); every tab gets `focus-ring`.
- No border around the strip and no filled pills: the underline is the only mark of the selected tab.
