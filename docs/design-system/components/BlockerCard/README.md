# BlockerCard

One thing that keeps an agent from starting, as a card by the message box: the agent is not installed, it needs a sign-in, or it is no longer in use. The message box stays below it, so a prompt can be written while the install runs, and a refused message comes back into the box.

`BlockerCard` (`components/ui/BlockerCard.tsx`) gives the three one shape; the consumer provides the label, the title, the body and the way past it.

- Card: `surface-2`, `border`, `radius-xl`, 16px padding, in the composer's 768px column (`max-w-3xl`).
- Leads with the agent's logo at 24px, decorative (the title names the agent). Without a `profileId` there is no logo.
- Title in `ui` weight 500 and `fg`, as one sentence of what stands in the way: "Codex isn't installed yet", "Sign in to Qwen Code", "Gemini CLI is no longer in use". The body under it is `ui-sm` in `fg-muted`.
- Actions sit on the title's row at the right: a primary **Install Codex** or **Add Gemini CLI**, or **Retry** after a failure.
- A footer under a `border` rule holds what follows the action: the install's step line and progress bar with **Cancel**, or the sign-in's status line with **Dismiss** and **Check again**.
- The region is named by `label` ("Install Codex", "Sign in to Qwen Code").

## The cards

- **Install.** "Codex isn't installed yet", what Install puts on the Mac ("Codex needs Node.js 24.11.1 (49 MB) and Codex 0.4.2 before it can start."), and **Install Codex**. While it runs, the footer's step line is a `role="status"` that changes once per step ("Downloading Node.js… (49 MB)"); the bytes are only in the bar, never announced.
- **Sign in.** "Sign in to Qwen Code" and the agent's lead, then every method it offers as a list. A method Zorvo runs (a browser or terminal sign-in) has its button. A method it cannot run (a key, Vertex AI, a gateway) shows its name, "In your shell" and one line, and never a field: Zorvo never asks for or stores a key. The footer's status line is always mounted, so each change is announced; while a refused message waits it reads "Your message will be sent again after you sign in".
- **Set up.** For an agent whose only way in is its own setup (Qwen Code picks its provider there): "Set up Qwen Code", "Qwen Code picks its provider in its own setup, which Zorvo opens in a terminal.", and **Open setup in terminal**, which runs the agent's own program in the terminal dialog. The footer has the status line, Dismiss, "Already set up?" and **Check again**. Zorvo never copies the agent's provider list, and never shows a field for a key. Among other methods, the setup is a row of the sign-in card with the same button.
- **Removed agent.** "Gemini CLI is no longer in use", "Add it again to continue this session. Its messages stay here either way.", and **Add Gemini CLI**. This one takes the composer's place, since the session cannot continue without its agent.
