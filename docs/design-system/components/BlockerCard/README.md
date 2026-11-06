# BlockerCard

One thing that keeps an agent from starting, as a card by the message box: the agent is not installed, it needs a sign-in or its own setup, or it is no longer in use. The message box stays below it, so a prompt can be written while the install runs, and a refused message comes back into the box.

`BlockerCard` (`components/ui/BlockerCard.tsx`) gives the cards one shape; the consumer provides the label, the title, the body and the way past it.

- Card: `surface-2`, `border`, `radius-xl`, 18px padding, `shadow-popover`, 14px between its parts, in the composer's 680px column (`max-w-chat`).
- Leads with the agent's logo in a 32px `surface-hover` tile (radius 8), decorative (the title names the agent). Without a `profileId` there is no tile.
- Title in `ui` at 600 and `fg`, as one sentence of what stands in the way: "Codex isn't installed yet", "Sign in to Gemini CLI", "Gemini CLI is no longer in use". The body under it is `ui` in `fg-muted`.
- The main button sits on its own row under the body, at the right: a primary **Install Codex** or **Add Gemini CLI**, or **Retry** after a failure.
- A footer under a `border` rule holds what follows: the sign-in's status line with **Dismiss** and **Check again**.
- The region is named by `label` ("Install Codex", "Sign in to Gemini CLI").

## The cards

- **Install.** "Codex isn't installed yet", what Install puts on the Mac ("Zorvo downloads Node.js 24.11.1 (49 MB) and Codex 0.4.2 into its own folder. Once it is installed, Zorvo checks whether you are signed in."), and **Install Codex** with no icon. While it runs the title is "Installing Codex"; the body is a `role="status"` that changes once per step ("Downloading Node.js · 18.2 MB of 42 MB", the size hidden from the announcement), then a 4px bar on a `surface-hover` track with an `fg-secondary` fill, and **Cancel** (ghost) on its own row.
- **Sign in.** "Sign in to Gemini CLI", "Pick how Gemini CLI signs in. It uses its own tool; Zorvo never sees your password or key.", then every method as a bordered list (radius 8, rows divided, 10px 12px): the name in `ui`, its line in `ui-sm` `fg-subtle`. A method Zorvo runs (a browser or terminal sign-in) has an outline button with no icon. A method it cannot run (a key, Vertex AI, a gateway) reads "In your shell" at the row's end, and never shows a field: Zorvo never asks for or stores a key. The footer's status line is always mounted, so each change is announced; while a refused message waits it has an attention dot and reads "Your message will be sent again after you sign in."
- **Set up.** For an agent whose only way in is its own setup (Qwen Code picks its provider there): "Set up Qwen Code", "Qwen Code connects to a provider you pick in its own setup, and keeps the choice and the key in its settings.", then an outline **Open setup in terminal** (with a terminal icon) beside "Already set up in Qwen Code? Check again.". Zorvo never copies the agent's provider list. Among other methods, the setup is a row of the sign-in card with the same button.
- **Removed agent.** "Gemini CLI is no longer in use", "Add it again to continue this session. Its messages stay here either way.", and **Add Gemini CLI**. This one takes the composer's place, since the session cannot continue without its agent.

## Other states in the chat's place

- **Compare run.** The panel in the chat's place while a run is open: a 680px column 40px from the top, the run's name at 20/28 600 (`-0.02em`) over "3 agents, each in its own worktree · started 12 minutes ago" in `fg-muted`, then one card per agent, 8px apart.
  - Each card is one row on `surface-2` with a `border` edge, `radius-xl`, 14px 16px: a 28px `surface-hover` logo tile (radius 7); the name at 500 over its status in `ui-sm` `fg-secondary` with a dot; the changes as a 26px mono `caption` button ("3 files +54 −9"), or "No changes yet" in `fg-subtle`; **Open** (ghost) and **Pick** (outline).
  - A working agent's status carries the turn's time, "Working · 12 min", from the prompt that started it; the time moves on with a minute clock. A finished one reads "Finished", with a `status-unread` dot while unread: no turn-end time is stored, so it shows no duration.
  - Pick opens a confirm bar floating 24px over the panel's bottom, 680px, `surface-3`, `border`, `shadow-popover`, 14px 16px, as one `fg` sentence: "Keep Codex's work and archive the others? Claude Code is still working and will be stopped." with Cancel (ghost) and **Pick Codex** (primary). Meanwhile the chosen card's edge is `border-strong` and its Pick looks pressed.
- **Empty window.** With no folder open: a closed folder at 22px in `fg-secondary` on a 48px `surface-2` tile, "Open a folder to start" at 20/28 600 (`-0.02em`), the line under it in `fg-muted`, and a 32px primary **Open folder** with a plus.
