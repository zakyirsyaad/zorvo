# Inspector

The panel on the right that looks into the session: its changes, what the agent did, its files and its terminal, one tab at a time. It is closed until you open it from the top bar's **Inspector** button.

The consumer provides the tabs that apply (Changes in a git repository, Activity with a session, Files and Terminal with a folder), the panel of the current tab, and the remembered width.

- `surface-1` with a `border` on its left edge. A header holds the `Tabs` strip (Changes, Activity, Files, Terminal, always in that order, with the count of changed files on Changes) and **Close inspector**.
- It opens 380px wide. Its left edge is a separator named "Resize inspector": drag it, or use Left and Right, between 320 and 720px, 16px a step. The width is remembered on this Mac.
- The Terminal tab widens it to at least 560px while it shows, and leaving the tab brings the remembered width back. Closing the tab or the inspector never ends a shell.
- When the window is too narrow for the sidebar (256px), the inspector and a 560px chat, opening the inspector hides the sidebar.
- The panels inside have no width, edge or close button of their own.
- A tab that stops applying (another folder, a new-session draft) closes the inspector rather than showing an empty panel.
