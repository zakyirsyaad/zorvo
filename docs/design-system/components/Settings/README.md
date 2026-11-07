# Settings

Settings is a page in the main window, not a dialog. It takes the place of the sidebar and the sessions. The sessions stay mounted underneath (`hidden`), so a draft, the comments in a message and the terminals are as they were after **Back to sessions**. `components/settings/SettingsPage.tsx` draws it, and `hooks/useSettingsPage.ts` holds which section shows. Popouts have no Settings.

## Anatomy

- **Navigation** (`SettingsNav`):
  - 220px on `surface-1`, with a `border` on its right, 10px side padding and 2px between items.
  - At the top is a 48px strip that drags the window, where the window's own buttons sit.
  - Items are 32px links, radius 6, 10px apart from their 14px icon, in `ui` and `fg-secondary`. **Back to sessions** is `fg-muted` with 10px under it.
  - The current item is `surface-hover`, `fg` at 500, with `aria-current="page"`. A click never changes the address.
  - **Agents** counts offered updates in an 18px `surface-hover` badge (radius 6, `caption`), read out as ", 2 updates".
  - **MCP servers** is dimmed and not a link, with a "Soon" tag ("MCP servers, coming soon" to a screen reader), until its backend lands.
  - General and Agents use lucide glyphs. Appearance, GitHub and MCP servers are drawn from the canvas, since lucide has no match.
- **Content**:
  - A column at most 720px wide, 56px from the top and 40px from the sides, which scrolls. Its top 48px drags the window too.
  - It is a region named by the section's title.
- **Header**: the title at 20/28, 600, `-0.02em`, in `fg`, which takes focus when Settings opens. Under it, one sentence in `ui` `fg-muted`, 4px below.
- **Group**: a heading in `caption` at 500 in `fg-muted` (4px 8px padding), over a `surface-2` card with a `border` edge and `radius-xl`.
- **Row**:
  - 12px 16px padding, with a `border` hairline between rows.
  - The label is `ui` in `fg`, with its description 2px under it in `ui-sm` `fg-subtle`, and the control on the right.
  - The gap is 16px in General and 12px in GitHub and Agents (`isTight`).
- **Gaps between the header and the groups**: General 28px, Appearance and GitHub 16px, Agents 24px.
- Buttons in rows are `Button size="md"`, as on the canvas's 28px buttons.

## Sections

- **General**:
  - **New sessions → Default agent**: an outline button with the agent's logo in a 16px tile, its name and a chevron. It opens a listbox of the ready agents. It reads "Choose an agent" with none, and "No agents are installed yet." with no ready agent.
  - **Recent folders**: the name, the path in mono `caption`, and a ghost **Remove** ("Remove agent-desktop from recent folders"). Remove asks in the row first: the line reads "Remove from recent folders? Its files and sessions stay.", with **Cancel** and a danger **Remove**, which is focused.
- **Group cards do not clip**, so a row's popover (the default agent list) opens past the card's edge.
  - **About → Zorvo version**: a status line. An sr-only live region beside it announces each state once ("Zorvo is up to date.", "Downloading Zorvo 0.9.0."), never the minutes or the percent:
    - "0.8.0 · Up to date · checked 2 h ago", with a still green dot (`StatusLine` `ready`);
    - "Checking for updates…";
    - "Could not check for updates";
    - "0.9.0 is ready", with **Update & restart** and what a restart stops;
    - "Downloading 0.9.0 · 42%".
    
    **Check now** asks again. An update hidden with Later still shows here.
  - **About → Setup**: **Run setup again**.
- **Appearance**:
  - "The terminal stays dark in every theme, since agents color their output for a dark ground."
  - System, Light and Dark form a radio group of tiles: 8px padding, radius 10, `surface-2`, 12px apart. The picked tile has an `fg` border and ring, and its label is `fg` at 500.
  - Arrow keys move and pick, as in a native radio group.
  - Each tile previews its theme in an 84px window, whose colours are fixed (`.theme-sample-light` and `.theme-sample-dark` in `globals.css`), so a preview shows its theme whatever theme is in use. System is half light, half dark.
- **Agents**: "The agents Zorvo can run. Zorvo installs them in its own folder, or uses the ones already on this Mac.", 24px between its parts.
  - **Search row**: a 32px search (`border-strong`, `surface-2`, radius 8, 14px icon) and **Check again** (`Button size="field"`: 32px, 12px regular text, with a 12px refresh icon). Under it, "Registry checked 8 hours ago" in `caption` `fg-subtle`.
  - **Groups** "In use" and "Available", with no counts, each a card of rows. A group with no rows is not drawn.
  - **Row**: one line, 12px 16px padding, 12px gaps.
    - A 28px `surface-hover` logo tile (radius 7), the name, and under it:
      - for an agent in use, a mono `caption` line "0.93.0 · installed by Zorvo" / "on this Mac" (a program found outside Zorvo shows no version, and its location is the tooltip);
      - for an available agent, what Add would install ("Installs Node.js 24.11.1 (49 MB) and Pi 0.9.0 into Zorvo's folder") or its description.
    - Then, at the end of the line:
      - the sign-in chip (22px, radius 6, `border`, `caption`): Ready with a green dot, Sign in in the attention colour, Not checked muted with no dot;
      - **Update to x.y.z**;
      - **Install** (when Add would install) or **Add**;
      - **Retry** after a failure;
      - a chevron for the sign-in;
      - ⋯ with Remove.
    - First and last rows round their own corners, since the card does not clip.
  - **Sign-in in the row**: every in-use agent that can start has a chevron ("Show sign-in for X"). The row opens by itself when the agent needs a sign-in, and stays open once it is ready, so the result shows. Opened, the row is `surface-1`, and under the line, indented 56px:
    - the methods, in a bordered card (radius 8, rows 9px 12px): an outline button for a method Zorvo runs, "In your shell" for one it cannot;
    - what checking may do, beside **Check sign-in**;
    - the result in a live region.
    
    There is no Open setup here: the agent setup terminal opens from the draft and the session only (the user's choice of 2026-11-05).
  - **Installing**: the row is `surface-1`. The step is a live region (the bytes are not announced) over a 4px bar, with **Cancel** at the line's end and ⋯ still there, since removing ends the install. A failure shows its words in `danger` under the line.
  - **Remove** (from ⋯) asks under the line: "Remove X? Zorvo deletes its copy. Saved sessions stay readable." and "Its open sessions stop." when they would, with Cancel and a focused danger Remove. Cancel gives focus back to ⋯.
  - **Not available (N)**: a quiet 28px toggle in `ui-sm` `fg-muted`. Opened, it shows a card of rows with the reason, and it stays open while a search is typed.
- **GitHub**:
  - "Optional. Zorvo reads pull requests through your own `gh` and keeps no token."
  - One **Connection** row:
    - signed in: initials in a 32px circle, the name, and "Connected as @login on github.com", with **Check again**;
    - signed out: "Not connected" and **Connect** (primary);
    - not installed: "Install the GitHub CLI first", the selectable `brew install gh`, a cli.github.com link, and **Check again**;
    - unknown: the reason, with Connect only when `gh` could sign in.

## Behavior

- Opened from the sidebar footer's Settings (General), the Agents menu's Manage agents and the agent update notice's Show (Agents), and the Changes tab's GitHub notice (GitHub).
- **Back to sessions** gives focus to what opened Settings. If that is gone, such as a closed menu, focus goes to the footer's Settings button. Escape does not close the page.
- A notice raised while Settings shows appears at the page's bottom right. The update card does not: About stands in for it.
- A GitHub or agent sign-in started here draws its terminal dialog over the page. The GitHub one stays after Back, since its login is still running.
