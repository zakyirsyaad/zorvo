# Onboarding

The welcome screen: one page before any session, and again from Settings → Run setup again. It replaces the three-step wizard. `components/Onboarding.tsx` draws it, and its rules are pure helpers in `lib/onboarding.ts`.

## Anatomy

- **Page**: paints `ground` and scrolls. Its content is one `sheet` (640px wide, radius 12, a `border` edge, 32px padding, 24px between its parts), centred while it fits and scrolled from its top when it does not.
- **Header** (10px gaps):
  - the wordmark (`onboarding/Wordmark.tsx`): the double-prompt symbol at 28px in `currentColor`, beside `zorvo` at 28/28, 600, `-0.04em`, in the UI font (a test keeps the brand brief's face out of the app);
  - "Every coding agent. One desktop." at 20/28, 600, `-0.02em`, in `fg`;
  - "Pick the agents you'll use and a project folder. You can change all of this later in Settings." at 13/20 in `fg-muted`.
- **Sections**: an `h2` with its number in a 20px ring (`border-strong`, `caption` at 500), 10px above a Settings card of rows (`surface-2`, `border`, `radius-xl`; `isCompact` rows of 10px 14px with 12px gaps and hairlines between them).
- **1. Agents you'll use**:
  - each row holds a 22px `AgentTile`, the name at 500 (`fg` when ticked, `fg-secondary` when not) with a line under it, then the row's button if it has one, and at the right end a real 16px checkbox (radius 4, a 1.5px `border-strong` edge, filled `primary` with an `on-primary` check when ticked, named "Use Claude Code");
  - the line reads "On this Mac · Ready" (with a still green dot), "Installed by Zorvo · Not checked", "Runs with npx · Sign in when you start", "… · Set up when you start", "Not installed · Zorvo can install it", or, once ticked, "Not installed yet" with an **Install** button;
  - the default row carries a "Default" tag (18px, `chip` fill, `caption` at 500, `fg-muted`). The other ticked rows offer **Make default** while hovered or focused;
  - after Install, the install runs in its row (the step in a live region, then a 4px bar). A failed one shows its words in `danger`, with **Retry**, which retries an update as an update, as Settings does (an update that failed in Settings shows here after Run setup again);
  - the agents in use or on this Mac come first, then Claude Code, Codex, Gemini CLI and Qwen Code, five rows in all. **Show all agents** shows the rest. Agents Zorvo cannot offer yet are left out.
- **2. Project folder**:
  - when chosen: a 22px tile around the folder icon, the name at 500, the path in mono `caption`, and **Change**, which opens the system dialog and is described by the folder's name and path;
  - otherwise: up to four recent or found folders, each with **Use**, then "Another folder" with **Open folder**;
  - **Use** takes its own row away, so focus moves to the chosen folder's **Change** rather than falling to the page;
  - **Open folder** and **Change** are off while the dialog is open, so a second press cannot open another;
  - a dialog that fails says so under the card.
- **Footer**: the note (`ui-sm`, `fg-subtle`, a live region) beside **Start** (`Button primary size="lg"`, at least 72px wide), which points at the note while it says something.

## Rules

- **Ticking** only puts an agent in use; it downloads nothing. A ticked agent that is not installed shows **Install**, which installs it through the same `install_agent` path as Settings, so nothing is downloaded without that press. **Unticking** only takes it out of use and stops its install; Zorvo never deletes an agent's files here.
- **The default** is the saved default while it is ticked, else the first ticked row.
- **Start** needs a ticked agent that can run now and a folder. It opens a new-session draft in that folder with the default, or with the first ready agent while the default still installs, and saves that agent as the default. The note says what is missing, in this order:
  - "Tick an agent to continue.";
  - "Codex is still installing." or "Install one of these agents to continue.";
  - "Choose a project folder.";
  - or, while another agent installs, "Codex is still installing. You can start with Claude Code now."
- **No sign-in or setup here**: an agent that needs one asks in the first session's draft.
- **Run setup again** starts with the most recent folder chosen.
