# Onboarding

The welcome screen: one page before any session, and again from Settings → Run setup again. It replaces the three-step wizard. `components/Onboarding.tsx` draws it, and its rules are pure helpers in `lib/onboarding.ts`.

## Anatomy

- **Page**: 64px from the top, 24px from the sides. A 640px column with 28px between its parts.
- **Header** (12px gaps):
  - the wordmark (`onboarding/Wordmark.tsx`): the double-prompt symbol at 28px in `currentColor`, beside `zorvo` at 28/28, 600, `-0.04em`, in the UI font (a test keeps the brand brief's face out of the app);
  - "Every coding agent. One desktop." at 28/34, 600, `-0.03em`, in `fg`;
  - "Pick the agents you'll use and a project folder. You can change all of this later in Settings." at 14/22 in `fg-muted`.
- **Sections**: an `h2` with its number in a 20px ring (`border-strong`, `caption`), 10px above a Settings card of rows (`surface-2`, `border`, `radius-xl`; rows 12px 16px with 12px gaps and hairlines between them).
- **1. Agents you'll use**:
  - each row holds a real 16px checkbox (radius 4, a 1.5px `border-strong` edge, filled `fg` with a check when ticked, named "Use Claude Code"), the 28px logo tile, the name, and a line under it;
  - the line reads "On this Mac · Ready" (with a still green dot), "Installed by Zorvo · Not checked", "Runs with npx · Sign in when you start", "… · Set up when you start", or "Zorvo installs it when you tick it";
  - the default row carries a "Default" tag (18px, `border`, 10px at 500, `fg-muted`). The other ticked rows offer **Make default** while hovered or focused;
  - an install runs in its row (the step in a live region, then a 4px bar). A failed one shows its words in `danger`, with **Retry**;
  - the agents in use or on this Mac come first, then Claude Code, Codex, Gemini CLI and Qwen Code, five rows in all. **Show all agents** shows the rest. Agents Zorvo cannot offer yet are left out.
- **2. Project folder**:
  - when chosen: a folder tile, the name, the path in mono `caption`, and **Change**, which opens the system dialog;
  - otherwise: up to four recent or found folders, each with **Use**, then "Another folder" with **Open folder**;
  - a dialog that fails says so under the card.
- **Footer**: the note (`ui-sm`, `fg-subtle`, a live region) beside **Start** (`Button primary size="lg"`), which points at the note while it says something.

## Rules

- **Ticking** puts an agent in use and installs it when it needs to, through the same `install_agent` path as Settings. **Unticking** only takes it out of use and stops its install; Zorvo never deletes an agent's files here.
- **The default** is the saved default while it is ticked, else the first ticked row.
- **Start** needs a ticked agent that can run now and a folder. It opens a new-session draft in that folder with the default, or with the first ready agent while the default still installs, and saves that agent as the default. The note says what is missing, in this order:
  - "Tick an agent to continue.";
  - "Codex is still installing." or "Install one of these agents to continue.";
  - "Choose a project folder.";
  - or, while another agent installs, "Codex is still installing. You can start with Claude Code now."
- **No sign-in or setup here**: an agent that needs one asks in the first session's draft.
- **Run setup again** starts with the most recent folder chosen.
