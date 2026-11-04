# Onboarding and Settings redesign

Date: 2026-11-04. Status: design approved in conversation, awaiting written-spec review.

Sub-project 2 of the Zorvo redesign. It reuses the visual language of `2026-11-04-main-window-redesign-design.md` (SF Pro, Geist Mono, monochrome zinc, color only for state, `Tabs`, `Chip`, `StatusLine`, the shared popover and `Toast`). Mockups: the "Sub-proyek 2 · Onboarding & Settings" row of the Design canvas "Zorvo redesign layouts" (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz). Where this text and an artboard differ, this text wins.

## Decisions

| Topic | Decision |
| --- | --- |
| Settings container | A full page in the main window, replacing the sidebar and the main area, with its own left navigation and "Back to sessions". Not a dialog, not a separate window (the main window stays the single writer). |
| Onboarding | One welcome screen: pick agents and a folder, then Start. Replaces the three-step wizard. |
| MCP servers | Designed now as a Settings section, following the Customize "model A" decision of 2026-11-03. Its backend is its own spec and plan (see "MCP servers"). |

## Settings page

Artboard: "Settings · halaman penuh, General".

- Opens from the sidebar footer's Settings button; the Agents menu's "Manage agents" opens it on Agents; links elsewhere (the Changes tab's `gh` notice) open their section, as today's `initialTab`.
- Left navigation, 220px on `surface-1`, where the sidebar sits: traffic-light space, **← Back to sessions**, then **General**, **Appearance**, **Agents** (count of offered updates, from `useAgentUpdates`), **MCP servers**, **GitHub**. Current item on `surface-hover` with `aria-current="page"`.
- Content: a column at most 720px wide, 56px from the top: section title (20px), one sentence, then groups. A group is a `surface-2` card with `border` and radius 12, made of rows (label and description on the left, the control on the right, 12px × 16px padding, hairlines between rows). A small `fg-muted` heading names each group.
- While Settings shows, sessions keep running; Back returns to the session that was on screen. A terminal sign-in started from Settings shows its dialog over Settings, as today (`AppSettingsDialog` draws `TerminalSignInDialog`; `SignInLayer` gets `showTerminal={false}`).
- Popouts have no Settings.

### General

- **New sessions → Default agent:** a chip with logo and name opening the shared popover of ready agents (today's `<select>`, same `settings` field). "No agents are installed yet." when none is ready.
- **Recent folders:** name and mono path per row, **Remove**.
- **About → Zorvo version:** version, update state as a `StatusLine` ("Up to date · checked 2 h ago", or "0.9.0 is ready" with **Update & restart**), and **Check now** through `app_update_check` (the restart warning and flow stay those of `useAppUpdate`).

### Appearance

Artboard: "Settings · Appearance & GitHub".

- A radio group of three preview tiles: **System** (follows your Mac, half light, half dark), **Light**, **Dark**; the selected tile has an `fg` ring. Same setting as today's Appearance select.
- One sentence: the terminal stays dark in every theme.

### Agents

Artboard: "Settings · Agents".

Same read model and actions as today (`get_agent_catalog`, `useAgentCatalogActions`, `update_agent`, `AgentSignIn`, `useSettingsSignIn`, the sweep); only the layout changes.
- Top: "Search agents" and **Check again**.
- **In use** group: per agent a 28px logo, name, mono version and source ("installed by Zorvo", "on this Mac"), the sign-in chip (Ready, Sign in, Not checked; the same `SIGN_IN_CHIP_STYLES` store as the sidebar), **Update to x.y.z** when offered, and ⋯ (Remove). A row opens in place for sign-in: the method list of the main-window spec (buttons for `agent`/`terminal` methods, "In your shell" lines for `explain` ones), the `sessionWarning` line, **Check sign-in**. Agents with an interactive setup (Qwen Code) show **Open setup** (the agent setup terminal of the main-window spec).
- **Available** group: description and **Add** or **Install** (with what gets installed); a running install shows its step, size and a progress bar, with Cancel.
- **Not available (N)**, folded, as today's `UnavailableAgents`, opened while a search is typed.

### MCP servers

Artboard: "Settings · MCP servers".

UI:
- Title, the sentence "Tools your agents can use. Zorvo gives this list to every session it starts. Your agents' own settings stay as they are.", **Add server**.
- Tabs **Yours** (count) and **Discover**.
- Yours: one row per server: name, a tag (stdio or HTTP), the command (mono) or URL, a status line (Confirmed with recent use; "Waiting for you to confirm the command" in attention color; for HTTP, the env names it reads and "Only agents that support HTTP servers get it"), an on/off switch, ⋯ (Edit, Remove).
- Add a server: Name; a Command/URL segmented control; Command (mono) or URL; Environment variables as name chips with "+ Add name" and "Only the names are saved. Zorvo reads the values from your shell when a session starts."; footer "Zorvo asks you to confirm this command in a system dialog before it runs it.", Cancel, **Add server**.
- Discover: search over the official MCP Registry, one row per server with its description and **Add**, which fills the same form.

Rules (from the model A decision; the backend spec must keep them):
- One list for all agents, passed in ACP `session/new` (and `session/load` / `session/resume`) as `mcpServers`; Zorvo never writes the agents' own config files.
- A stdio server is a command Zorvo runs: it is confirmed in a native dialog drawn by the Rust backend, never trusted from the webview; the webview sends a server id, never a raw command line to run.
- Only environment variable names are stored; values come from the login-shell environment (`env_resolver`). No OAuth connectors, no token storage.
- HTTP servers go only to agents that declare `mcpCapabilities.http` in `initialize`.
- Discover reads registry.modelcontextprotocol.io from the backend, with pinned versions and the same 7-day hold as the ACP registry; packages install through the existing Node/uv installer. This is a new kind of network request, so the README privacy section changes.

The MCP backend (storage, the confirm dialog, the registry fetch, passing `mcpServers`, reading `mcpCapabilities`) gets its own spec and plan; this spec only fixes its Settings UI.

### GitHub

Artboard: "Settings · Appearance & GitHub".

Same behavior as today's `GithubSection` and `useGithubConnection`; one row card per state:
- Signed in: initials, GitHub name, "Connected as @login on github.com", **Check again**.
- Signed out: "Not connected", what it adds (pull requests in the Changes tab and the top bar), **Connect** (primary).
- `gh` not installed: `brew install gh` or cli.github.com, **Check again**.
- Unknown: the message from `github_status`, and Connect only when `canConnect`.
- The section says GitHub is optional and Zorvo keeps no token.

## Onboarding

Artboard: "Onboarding · satu layar sambutan".

One screen in the main window, before any session, centered column at most 640px:
- The `zorvo` wordmark (the brand asset), "Every coding agent. One desktop.", and "Pick the agents you'll use and a project folder. You can change all of this later in Settings."
- **1. Agents you'll use:** agents in use or detected on this Mac first, then a few popular registry agents, "Show all agents" for the rest. Each row: checkbox, logo, name, and state on the right: "On this Mac · Ready", "Not checked", "Needs setup" with **Open setup**, a sign-in button, or "Zorvo installs it when you tick it". Ticking an agent that is not installed starts its install in the row (step and progress bar), through the same `install_agent` path as Settings. The first ticked agent carries a "Default" tag; another row offers "Make default" on hover or focus. Ticking writes `settings.enabledAgents`; the default writes the same field as Settings → General.
- **2. Project folder:** **Open folder** (the native dialog), or the chosen folder with its path and **Change**.
- Footer: a note and **Start** (primary). Start is enabled once at least one ticked agent is usable and a folder is chosen; until then the note says what is missing ("Tick an agent to continue.", "Choose a project folder."). An install still running does not block Start when another ticked agent is ready ("Codex is still installing. You can start with Claude Code now.").
- Start opens the main window on a new-session draft in that folder with the default agent.
- Sign-in is not required to finish onboarding: an agent that needs it asks in the draft, as in the main window.

## Accessibility

- Settings navigation is a `nav` with links and `aria-current`; groups are labelled; every row control has a visible label or `aria-label` naming the agent or server.
- Theme tiles are a radio group; switches use `role="switch"` with `aria-checked`; the onboarding checkboxes are real checkboxes.
- Progress lines are `role="status"` and progress bars have value attributes.
- Start's reason is linked with `aria-describedby`.
- Contrast and focus rules of the design system apply unchanged.

## Code impact

- Settings: `AppSettingsDialog` becomes a page container rendered by `App.tsx` in place of the sidebar and main area (state in a focused hook, not in `App.tsx`); `SettingsPanel`'s tab strip becomes the left navigation; `GeneralTab` splits into General and Appearance; `GithubSection` and the agent catalog components are restyled into groups and rows; the `SettingsTab` type gains `appearance`, `mcp` and `github`.
- Onboarding: `Onboarding.tsx` and `components/onboarding/*` are replaced by one welcome screen reusing the catalog row, install progress and folder picker pieces.
- MCP servers: UI components only in this sub-project, wired to the backend once its own spec lands; until then the section is not shown (no placeholder page).
- Tests: Settings navigation (open on a given section, Back returns to the same session), the theme radio group, the onboarding gate rules (Start enabled cases and their notes), install from onboarding, default selection.
- `CHANGELOG.md` line under Unreleased.

## Suggested phases

1. Settings page container and navigation, with General, Appearance and GitHub.
2. Agents section in the new layout.
3. Onboarding welcome screen.
4. MCP servers UI, after its backend spec and implementation.
