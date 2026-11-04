# Inspector

The panel on the right that looks into the session: its changes, what the agent did, its files and its terminal, one tab at a time. It is closed until you open it from the top bar's **Inspector** button.

The consumer provides the tabs that apply (Changes in a git repository, Activity with a session, Files and Terminal with a folder), the panel of the current tab, and the remembered width.

- `surface-1` with a `border` on its left edge. A header holds the `Tabs` strip (Changes, Activity, Files, Terminal, always in that order, with the count of changed files on Changes) and **Close inspector**.
- It opens 380px wide. Its left edge is a separator named "Resize inspector": drag it, or use Left and Right, between 320 and 720px (560 on the Terminal tab), 16px a step. The width is remembered on this Mac.
- The Terminal tab widens it to at least 560px while it shows, and leaving the tab brings the remembered width back. Closing the tab or the inspector never ends a shell.
- When the window is too narrow for the sidebar (256px), the inspector and a 560px chat, the inspector showing wider (opening it, or switching to Terminal) hides the sidebar.
- The panels inside have no width, edge or close button of their own.
- The full diff review (from the top bar's diff chip, or **Open the diff** in Changes) opens in the chat's place, with the changed files listed on its left. **Shrink**, or adding comments to the message, puts it beside the chat in the inspector's place: opening one closes the other, so the chat is never squeezed between them. The review takes the chat's place only for the session (or draft) it opened in: another session shows its own chat, with the review beside it.
- A tab that stops applying (another folder, a new-session draft) hides the inspector rather than showing an empty panel; it shows again when the tab applies again.
