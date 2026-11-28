# QWEN.md — Zorvo (formerly Agent Desktop)

Instructional context for Qwen Code when working in this repository. Read this
first; for deeper architecture detail, `CLAUDE.md` is the authoritative
reference, and `docs/development.md` covers the build, checks and release
process.

## What this is

Zorvo is a native macOS desktop app that hosts other coding agents — Claude Code,
Codex, Qwen Code, Pi, Google Antigravity and the rest of the
[ACP registry](https://agentclientprotocol.com) — each in a real chat UI. Agents
are driven over the Agent Client Protocol (ACP, JSON-RPC over stdio), so Zorvo
shows each agent's own models, effort levels, modes, slash commands,
elicitations and permission prompts instead of reimplementing them.

- **Frontend:** React 19, TypeScript (strict), Tailwind 4, Vite 8, in `src/`.
- **Backend:** Rust, Tauri 2, in `src-tauri/` (crate `zorvo`, lib `zorvo_lib`).
- **Credits server:** Cloudflare Workers ledger (`zorvo-credits-server`) in
  `server/`, backing opt-in Private mode.
- **Package manager:** pnpm 12; Node version comes from `.nvmrc` (26), which CI
  and the release workflow also read. Node 22+ is the documented runtime floor.
- **Platform:** macOS only (Apple Silicon and Intel); Windows/Linux are roadmap.
- **License:** Apache 2.0. The license does not cover the Zorvo name or logo.

For regular ACP agents Zorvo never asks for or stores API keys — agents sign in
with their own tools, GitHub data comes from the user's own `gh`, and there is
no telemetry. The one documented exception is opt-in **Private mode**, which
stores NEAR AI / device credentials in macOS Keychain only (never exposed to the
webview or the agent process).

## Repository layout

```
src/                    React frontend
  App.tsx               app shell and session orchestration (keep it thin)
  components/           UI by feature: activity, agents, artifacts, browser,
                        changes, chat, compare, composer, computer-use, context,
                        delegation, files, inspector, onboarding, overview,
                        private, settings, sidebar, tasks, terminal, topbar,
                        ui (primitives), workspace
  hooks/                focused hooks, one concern each
    session-engine/     useAcpEngine.ts — the ACP session engine
  lib/                  pure helpers (ACP events, persistence, agent tools,
                        artifacts, browser, delegation, review comments,
                        diff rows, next-step, reply quotes, …)
  styles/globals.css    design tokens — single source of truth
  test/                 Vitest + Testing Library tests
src-tauri/              Rust backend
  src/acp/              ACP client: jsonrpc, connection, manager, probe,
                        elicitation, session_list, terminal_auth, agent_tasks,
                        context_usage, qwen_log, private_sessions
  src/agent_tools/      Zorvo's local MCP server, Unix socket + peer PID check,
                        `zorvo mcp-bridge` and `zorvo tools` CLI
  src/artifacts/        pages, canvases, design systems, inline visuals,
                        motion/video renderer, shared child wry webview
  src/browser/          native WebKit Browser panel (outside Tauri IPC)
  src/browser_commands.rs, browser_debug.rs, browser_upload.rs
  src/computer_use/     looking-only macOS app inspection via pinned cua-driver
  src/installer/        agent/runtime installs, npm bin resolution, pinned hashes
  src/private_mode/     opt-in Private mode: Keychain, loopback NEAR AI proxy,
                        Worker client, attestation verification, spend caps
  src/registry/         ACP registry, version history, catalog view, cli_launch,
                        icons
  src/spawn/            `disclaim-exec` trampoline for spawning child processes
  src/store.rs          state.json and transcripts
  src/changes.rs, diff_stats.rs, checkpoints.rs, branch_state.rs,
  src/worktrees.rs, branches.rs, git_info.rs, pull_requests.rs, github.rs
  src/workspace_terminal.rs, pty_session.rs, background_processes.rs
  src/files.rs, file_preview.rs, media.rs, pasted_images.rs, instruction_files.rs
  resources/            bundled registry history/icons, runtimes.json,
                        cua-driver.json, browser-cdp/, zorvo-private-mcp.mjs
  tests/it/             integration tests (one binary)
  tests/                standalone test binaries (installer_state_test,
                        spawn_test, private_proxy_test, canvas_render,
                        motion_render) & fixtures/ (fake_acp_agent.mjs,
                        fake_cua_driver.mjs)
server/                 Cloudflare Workers credits ledger (zorvo-credits-server)
site/                   Next.js marketing site, static export to site/out
scripts/                registry/runtimes/cua-driver updates, release signing, checks
docs/                   development guide, browser dev guide, design system,
                        brand assets, feature specs (docs/superpowers/specs/)
```

## Commands

Run from the repo root unless noted.

```bash
pnpm install
pnpm tauri dev                                  # Vite on :1420 + Rust backend
pnpm lint                                       # tsc --noEmit + eslint --max-warnings=0
pnpm test                                       # all root Vitest tests
pnpm vitest run src/test/persistence.test.ts    # one file
pnpm vitest run src/test/persistence.test.ts -t "name"   # one test
pnpm build                                      # tsc && vite build (frontend only)
pnpm design-system                              # design-system reference on :5180
pnpm registry:update                            # refresh bundled ACP registry history
pnpm registry:update --icons-only               # refresh bundled registry icons only
pnpm runtimes:update                            # refresh pinned runtime hashes
pnpm cua-driver:fetch                           # fetch pinned cua-driver into src-tauri/binaries/
pnpm cua-driver:update                          # pin newest cua-driver (>= 7 days old)
pnpm clean:rust                                 # cargo clean for src-tauri (empties shared target)
pnpm tauri build                                # production bundle (only build with CSP)
pnpm lefthook install                           # opt in to local pre-commit checks
```

Rust checks (from `src-tauri/`; `pnpm build` must have produced `dist/` first,
because Tauri embeds it at compile time):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --test it acp_manager_test::               # one integration test file
cargo test --test it acp_manager_test::some_name      # one test
ZORVO_RENDER_TEST=1 cargo test --test canvas_render   # live WebKit render test
ZORVO_RENDER_TEST=1 cargo test --test motion_render   # live motion render test
```

Credits server & standalone Node tests (from the root):

```bash
pnpm --filter zorvo-credits-server typecheck
pnpm --filter zorvo-credits-server test
node --test src-tauri/resources/zorvo-private-mcp.test.mjs
node --test src-tauri/resources/browser-cdp/runtime.test.mjs
```

Site (from the root):

```bash
pnpm --filter zorvo-site dev                    # http://localhost:3100
SITE_URL=https://zorvolabs.xyz pnpm --filter zorvo-site build   # writes site/out/
```

`pnpm tauri build` signs the update package, so it needs
`TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`). To build without signing, append
`--config '{"bundle":{"createUpdaterArtifacts":false}}'`.

## Architecture facts that matter

**Frontend ↔ backend.** The UI calls Tauri commands, all registered in
`src-tauri/src/lib.rs`'s `generate_handler!`, and listens to events:
`acp-event` (one channel for every ACP session), `agent-tool-call` /
`agent-tool-call-ended`, `artifacts-changed` / `artifact-page-pick` /
`canvas-view` / `canvas-pick` / `ds-view` / `ds-pick` / `motion-render`,
`computer-use-*`, `sign-in-terminal` / `github-sign-in-terminal` /
`workspace-terminal`, `agent-install-progress`, `app-update-progress`,
`agent-profiles-changed`, among others. Keep `App.tsx` thin: put new logic in a
hook in `src/hooks/` or a helper in `src/lib/`.

**Session engine.** Every session is an ACP chat run by
`src/hooks/session-engine/useAcpEngine.ts`. Incoming ACP updates are folded
into chat messages by `src/lib/acp-events.ts`. Modes, models and config options
are reported by the agent at session start (`useAcpSessions.ts`,
`lib/acp-draft.ts`) and surfaced through `lib/composer-controls.ts`. Supports
queued messages while a turn is running (`useQueuedMessages`), ACP elicitation
forms/URLs (`acp/elicitation/`), stalled-agent detection with forced `End agent`
(`AgentStallNotice`, `acp_end_agent`), background task tabs for subagents and
shells (`useTaskTabs`), a live Context breakdown tab (`ContextPanel`), a
session Overview panel (`OverviewCard`), and a post-turn Next step box
(`wrap_up`, `useNextStep`).

**Agent profiles and CLI launch (trust boundary).** Registry data is fetched by
the Rust backend, never the webview. The UI sends only an agent id (and a
folder); `acp/commands.rs::launch_for` turns that id into a command line. Never
let the UI pass a raw command, argument or environment. A candidate distribution
must pass `is_valid_entry`; `registry/schema.rs::choose_distribution` picks one
at parse time, preferring a pinned `npx` package, then a pinned `uvx` package,
then a binary with a valid checksum for this Mac. A version is offered as soon
as the registry lists it, and the bundled history is refreshed with
`pnpm registry:update`. `registry/cli_launch.rs` maps specific registry agents
to a user-installed CLI (currently `antigravity-acp` via `agy acp
--app-data-dir antigravity-acp` for `agy` ≥ 1.5.17); the binary, arguments and
minimum version are hardcoded in Rust.

**Installer.** `src-tauri/src/installer/` installs only the agent the user
picked, plus Node.js or uv when needed, under the app data dir's `tools/`.
Runtimes are pinned with their SHA-256 in
`src-tauri/resources/runtimes.json`, and every download is checked against a
pinned hash; archives unpack with path and size checks; installs are staged in
`tools/staging/` and renamed into place. The plan is rebuilt in the backend from
the agent id, never taken from the UI. **npm-package agents (`Distribution::Npx`)
never run through `npx`:** Zorvo installs them with `npm install -g --prefix`
into `tools/agents/<id>/<version>/` and resolves their recorded `bin`
(`installer/npm_bin.rs`, `registry/resolve.rs::npm_agent_program`), so starting
an agent contacts no registry. `useAutoInstall` installs used single-step npm
agents once per run after onboarding; `uvx` agents still run through `uvx`.

**Agent tools and delegation.** `src-tauri/src/agent_tools/` runs Zorvo's own
MCP server over a private Unix socket (`0700` dir, `0600` socket) with a
per-session in-memory 32-byte token and `LOCAL_PEERPID` process-ancestry
verification (`peer.rs`). The binary exposes extra CLI entrypoints checked in
`main.rs` before Tauri starts: `zorvo mcp-bridge` (stdio MCP bridge for
standard ACP agents) and `zorvo tools [<tool> [<json>]]` (shell command path
for agents like `pi-acp` that ignore `mcpServers`). When agent env vars
(`ZORVO_MCP_SOCKET`, `ZORVO_MCP_TOKEN`, `ZORVO_TOOLS`) are present, `main`
refuses to launch the GUI app (unset them before running `pnpm tauri dev` from a
command-path agent session). Coordinators get 14 tools (`list_agents`,
`start_worker`, `send`, `start_session`, `read_session`, `stop_session`,
`show_artifact`, `artifact_guide`, `show_visual`, `browser`, `browser_guide`,
`wrap_up`, `render_motion`, `render_status`) plus 6 computer-use tools when
enabled; delegated workers get `done` only. Delegation (`useDelegation`,
`useOpenedSessions`) is strictly one-level: `start_worker`/`send` require a
session grant card, `start_session` into another folder always requires a
per-call **Allow once** card, and handles (`worker-N`, `session-N`) hide real
session ids.

**Artifacts, canvases, design systems, visuals and motion.**
`src-tauri/src/artifacts/` hosts pages (`show_artifact`), multi-artboard
canvases, design systems (`design-system.json` + `tokens.json`), inline visuals
(`show_visual`), and motion/video compositions (`motion.json`, `render_motion`,
`render_status`). Pages, canvases, design systems and motion previews share one
child `wry::WebView` (`view.rs`) created directly with `wry` — never Tauri, so
it has zero Tauri IPC — served over `zorvo-artifact://localhost/...` with strict
per-kind CSPs (`PAGE_CSP`, `SHELL_CSP`, `BOARD_CSP`, `DS_SHELL_CSP`,
`MOTION_SHELL_CSP`). Inline visuals are sanitized with `ammonia` (no scripts or
links) and rendered inside `<iframe srcdoc sandbox="allow-same-origin">`. Motion
compositions run on a single deterministic clock (`motion_runtime.js`) and
render via hidden WebKit snapshots plus macOS AVFoundation (H.264/AAC); rendered
and workspace videos play in the main webview via `zorvo-media://localhost/<token>`.
Design systems are auto-discovered inside the session folder (max 4 levels, no
symlinks) and reported in `artifact_guide`; canvases can bind a `designSystem`
and switch themes via `_ds/`. Artifact, canvas and design-system comments share
the composer review slot with diff comments.

**In-app Browser.** `src-tauri/src/browser/`, `browser_commands.rs` and
`browser_debug.rs` provide an expandable native WebKit Browser tab outside Tauri
IPC (one non-persistent data store per session, separate config per tab). Plain
clicks on `http(s)` links in chat open in Zorvo's Browser panel. Agent calls to
`browser` require a memory-only session grant (and a separate one-time approval
for file uploads), validated against the backend's pending-call table. Optional
Chromium/Brave CDP debugging runs in a separate worker process
(`resources/browser-cdp/`) with its own temp profile, never sharing pages or
cookies with WebKit, with optional user-triggered Lighthouse installation.

**Computer use (looking only).** `src-tauri/src/computer_use/` lets agents read
macOS app windows via a pinned, SHA-256 and Apple-codesign verified
`trycua/cua-driver` binary (`src-tauri/resources/cua-driver.json`, fetched by
`pnpm cua-driver:fetch`). Six tools (`list_apps`, `request_access`,
`list_windows`, `get_window_state`, `zoom`, `verify_state`) sit behind
per-session, per-app grants and app tiers (`Never`/`ViewOnly`/`ClickOnly`/`Full`).
Acting (click/type) is not built. A floating `computer-use-pill` window
(`index.html?pill=1`) stays visible during active reads.

**Private mode.** `src-tauri/src/private_mode/` and `server/` implement opt-in
private sessions on Qwen Code backed by NEAR AI. Credentials stay in macOS
Keychain (`xyz.zorvo.desktop.private`, suffixed with data-dir hash in debug
builds) and are injected by a loopback proxy (`127.0.0.1:0`) forwarding only
`/v1/chat/completions` and `/v1/models` to `cloud-api.near.ai`, so the key never
enters the agent process. Supports ECDSA signature/attestation verification
(`verify.rs`), 100/200/500-credit session caps, local secret scanning
(`useSecretGuard`), bundled read-only private MCP (`resources/zorvo-private-mcp.mjs`),
and blocks plain reopen/import of private ACP sessions (`acp/private_sessions.rs`).

**Spawning processes.** Every process Zorvo starts must go through
`src-tauri/src/spawn/` (`spawn::command` or `spawn::pty_command`), which runs
children through the `disclaim-exec` trampoline (`responsibility_spawnattrs_setdisclaim`)
so they never inherit Zorvo's macOS TCC grants (Screen Recording, Accessibility).
`spawn::driver_command` is the sole exception for `cua-driver`.
`src-tauri/clippy.toml` disallows `std::process::Command::new` and
`portable_pty::CommandBuilder::new` in crate code.

**Persistence.** `store.rs` writes `state.json` (`STATE_VERSION = 2`) and
`transcripts/<id>.json` atomically under
`~/Library/Application Support/xyz.zorvo.desktop/`. Transcript saves are
size-throttled (`useTranscripts`) and tool diffs are stored as rendered rows
(`lib/diff-rows.ts`), never full before/after file texts. Frontend
validation/normalization of loaded state is in `src/lib/persistence.ts`. On load
the UI calls `end_orphaned_sessions`, which stops orphaned backend agents and
closes native overlays (`artifacts::view::close`, `browser::close_all`,
`browser_debug::close`) so reloads never leave stale native views on screen.

**Path checks.** Every backend command that reads or runs in a folder supplied
by the UI must first call `files::ensure_known_workspace` (canonicalized,
checked against the store's known workspaces). Follow this in any new command.

**Popout windows.** A session can open in its own window
(`index.html?session=<id>&popout=1`). The main window is the single writer: it
parses agent output and persists state; popouts render snapshots and forward
actions through `lib/popout-bridge.ts`, so two windows never write the same
files. Popouts have no inspector (artifacts, browser, queue and reply stay in
the main window).

**Fork, rewind, worktrees and compare.** Fork prefers the agent's native ACP
fork, otherwise a handoff file (`fork_handoff.rs`). Before each turn
`checkpoints.rs` takes a lightweight snapshot with a temporary `GIT_INDEX_FILE`
(leaving the real index, HEAD and stash untouched), letting Rewind offer
**Rewind + files?** for files the agent reported changing. Worktree sessions
get an `agent/<title>` branch under the app data dir's `worktrees/`; Compare
agents (`compareRunId`) opens sequential worktrees for side-by-side runs.
`switch_branch` refuses while any open ACP session works in the same checkout,
and every branch name from the UI is checked against `refs/heads/` before it
reaches git.

**Terminals.** A PTY (`pty_session.rs`) runs an agent's own terminal sign-in and
the workspace shells (`workspace_terminal.rs`, whose close kills the whole
process tree via `background_processes::end_tree`). The UI sends only a folder
or a session/terminal id — never a command, argument or environment.
`send_input` stays synchronous so keystrokes reach the PTY in order.

**Threading rule for Tauri commands.** Commands that touch the filesystem, the
login shell or a child process are `#[tauri::command(async)]` so they cannot
freeze the window. `send_input` and `end_orphaned_sessions` stay sync
deliberately, for ordering reasons.

**Environment.** A Finder-launched app has no shell PATH, so `env_resolver.rs`
reads the user's login-shell environment once (warmed at startup) and every
spawn uses it. `refresh_login_env` re-reads only the login environment for
sign-in checks without refetching the registry.

**Qwen Code specifics.**
- `ask_user_question` arrives as a normal `session/request_permission` whose
  `toolCall._meta` carries `qwenInteractionKind: "user_question"` and
  `qwenQuestions`, and expects an `answers` object in the response.
  Parsing/validation lives in `src/lib/user-questions.ts` and
  `src-tauri/src/acp/permission_response.rs`; typed values are never stored or
  logged.
- Setup method (`openai`) uses the older terminal form (no `type`,
  `_meta.type: "terminal"`), handled via `acp_start_agent_setup` in the sign-in
  PTY (`Set up Qwen Code`).
- Failed API request details are read from the tail of Qwen's own
  `projects/*/chats/<id>.jsonl` (`acp/qwen_log.rs`, never logged).
- Subagents report `_meta.parentToolCallId` (`lib/acp-subagents.ts`), and
  in-process background agents are polled via `qwen/status/session/tasks`
  (`acp/agent_tasks.rs`, `useAgentTasks`).
- Exact context token breakdowns come from `qwen/status/session/context_usage`
  (`acp/context_usage.rs`, `useContextBreakdown`).
- Opt-in Private mode runs on Qwen Code with `--telemetry-log-prompts=false
  --auth-type openai --openai-base-url <loopback> --model <id>` and strips
  `OPENAI_*` from the launch env.
- Because Qwen Code loads MCP tool schemas on demand, `MCP_PATH_CONTEXT`
  reminds it to look up `zorvo` tools (such as `show_artifact`) with
  `tool_search`.

## Development conventions

- **TypeScript is strict**, with `noUnusedLocals`, `noUnusedParameters` and
  `noFallthroughCasesInSwitch`. A leading underscore marks a value left out on
  purpose (ESLint is configured for this).
- **Immutability:** return new objects; do not mutate existing ones.
- **Small files:** 200–400 lines typical, 800 as a soft ceiling. Prefer a focused
  hook or component over growing `App.tsx`.
- **Tests are required.** Write the failing test first, then make it pass. New
  functionality needs unit/integration coverage; UI changes should have a
  Testing Library test in `src/test/`.
- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`, `ci:`. Branches: `feat/…`, `fix/…`, `chore/…`.
- **Stage by explicit path.** Other sessions may share this checkout; never run
  `git add -A` or `git add .`.
- **Changelog:** add a line under `Unreleased` in `CHANGELOG.md` when users would
  notice the change.
- **Privacy & secrets.** Never add code that asks for, stores, logs or transmits
  regular agent API keys or tokens, and keep Private mode credentials strictly
  in macOS Keychain + loopback proxy (never in webview state or logs). The main
  webview CSP allows only the local IPC bridge and local `zorvo-media://` video
  tokens — no external network requests.
- **Design system v2 rules (enforced by tests):**
  - `src/styles/globals.css` (`@theme` dark + `prefers-color-scheme: light`) is
    the source of truth. Change `globals.css` and
    `docs/design-system/tokens.json` together (`design-system-docs.test.ts`).
  - No raw colors in components (`bg-neutral-800`, `text-white`, `bg-[#121212]`)
    — `design-tokens.test.ts` fails on them.
  - Use the v2 surface tokens (`bg-ground`, `bg-sheet`, `bg-chip`,
    `bg-surface-2`, `text-fg-muted`, `border-border-strong`, …).
    `sheet-fills.test.ts` fails on `bg-bg` or `bg-surface-1` in components.
  - Motion uses four duration tokens (`--transition-duration-quick|menu|panel|appear`)
    and `--ease-soft`; `transition-*` defaults to `quick` (never write
    `duration-*`). `motion.test.ts` fails on disallowed `animate-` classes.
  - Use `src/components/ui/` (`Button`, `IconButton`) before styling a
    `<button>` by hand. Every focusable control gets `focus-ring`. Shadows are
    `shadow-popover` / `shadow-dialog`.
- **UI copy:** sentence case, short declarative sentences, address the user as
  "you", name the agents rather than saying "AI", no exclamation marks or emoji.
  See `docs/design-system/README.md`.
- **Do not run heavy checks locally that CI covers.** `pnpm lint` and
  `pnpm test` for changes under `src/`; add the cargo checks only when
  `src-tauri/**`, `package.json`, `pnpm-lock.yaml`, `.nvmrc` or
  `docs/design-system/**` changed. Docs, site and copy changes need no cargo.
- **Review before pushing.** Review the diff and fix what it finds first, so CI
  runs once on a reviewed change.

## Testing conventions

- **Frontend:** Vitest + Testing Library in jsdom, tests in `src/test/`.
  `src/test/setup.ts` fakes Tauri `invoke`, including an in-memory store seeded
  via `window.__FAKE_TAURI_STORE__` and canned ACP responses. Agent profile
  fixtures are in `src/test/fixtures/agents.ts`. Vitest is configured with a
  60 s timeout and excludes `.claude/**`, `.qwen/**`, `server/**`,
  `src-tauri/**` and `experiments/**` (ESLint ignores `.claude`, `.qwen`,
  `server`, `dist`, `src-tauri`, `site/.next`, `site/out`).
- **Rust:** `#[cfg(test)]` modules plus `src-tauri/tests/it/`, one binary. A new
  integration test file needs a `mod` line in `tests/it/main.rs`; a test checks
  that. Tests needing process-wide state or live rendering get their own file
  under `src-tauri/tests/`: `installer_state_test.rs`, `spawn_test.rs`,
  `private_proxy_test.rs`, plus `harness = false` render tests
  `canvas_render.rs` and `motion_render.rs` (gated on `ZORVO_RENDER_TEST=1`).
- **Fake fixtures:** Rust ACP tests spawn
  `src-tauri/tests/fixtures/fake_acp_agent.mjs` with Node, so Node must be on
  PATH. Key flags include `FAKE_ACP_RESUME`, `FAKE_ACP_LIST`,
  `FAKE_ACP_LIST_PAGES`, `FAKE_ACP_LIST_FAIL_AT`, `FAKE_ACP_CALL_LOG`,
  `FAKE_ACP_SUBAGENT`, `FAKE_ACP_SLOW_REPLAY`, `FAKE_ACP_WRITE_FILES`,
  `FAKE_ACP_SETUP_METHOD`, `FAKE_ACP_MODELS`, `FAKE_ACP_USAGE`,
  `FAKE_ACP_CONTEXT_USAGE`, `FAKE_ACP_TASKS`, `FAKE_ACP_QUESTION_LOG`,
  `FAKE_ACP_ELICIT_LOG`, `FAKE_ACP_MCP_CALL` / `FAKE_ACP_MCP_LOG`,
  `FAKE_ACP_TOOLS_COMMAND`, `FAKE_ACP_ENV_LOG`, `FAKE_ACP_PARAMS_LOG`,
  `FAKE_ACP_PRIVATE_ERROR`, `FAKE_ACP_PROMPT_ERROR_DETAILS`, and
  `FAKE_ACP_CHILD_PID_FILE`. Computer-use tests use `fake_cua_driver.mjs`.
- **Standalone Node & Workers suites:** `server/` runs its own Vitest Workers
  suite (`pnpm --filter zorvo-credits-server test`); bundled Node scripts run
  with `node --test` (`src-tauri/resources/zorvo-private-mcp.test.mjs`,
  `src-tauri/resources/browser-cdp/runtime.test.mjs`,
  `experiments/browser-wk/*.test.mjs`).
- **Contract test:** `src/test/tauri-contract.test.ts` reads both sides' source
  and checks every `invoke('name', { keys })` against `generate_handler!` and
  every event against its emit/listen sites. When it fails after you add a
  command, argument or event, fix the name/key or the table — not the check. It
  does not check argument types or values.
- **Design-system & guard tests:** `design-tokens.test.ts`,
  `design-system-docs.test.ts`, `sheet-fills.test.ts`, `motion.test.ts`,
  `theme-contrast.test.ts`, `code-tokens.test.ts`, `button-sizes.test.ts`,
  `design-craft.test.ts`, `canvas-shell.test.ts`, `ds-shell.test.ts`,
  `ds-tokens-css.test.ts`, `site.test.tsx` and `xterm-release-build.test.ts`
  enforce rules that are easy to break. Keep them green.

## CI and releases

- **CI** (`.github/workflows/ci.yml`):
  - `frontend`: `pnpm lint`, `node --test` on `experiments/browser-wk/*.test.mjs`
    and `src-tauri/resources/browser-cdp/runtime.test.mjs`, `pnpm test`,
    `pnpm build`.
  - `server`: `pnpm --filter zorvo-credits-server typecheck`,
    `pnpm --filter zorvo-credits-server test`,
    `node --test src-tauri/resources/zorvo-private-mcp.test.mjs`.
  - `site`: `pnpm --filter zorvo-site build` with a localhost `SITE_URL`.
- **Rust CI** (`rust.yml`) runs `cargo fmt --check`, `clippy --all-targets -- -D warnings`
  and `cargo test` on a macOS runner, on every push to `main` and on pull
  requests that touch `src-tauri/**`, `package.json`, `pnpm-lock.yaml`,
  `.nvmrc`, `docs/design-system/**` or `rust.yml`.
- **Other workflows:** `security.yml` runs `pnpm audit` and `cargo audit`;
  `release.yml` builds universal macOS artifacts; `discord-release.yml` posts
  published releases; Dependabot proposes weekly updates.
- **Releases:** bump the version in `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json`; roll `CHANGELOG.md`; push a `vX.Y.Z` tag. The
  Release workflow builds a universal macOS app and publishes nothing. Then, on
  the maintainer's Mac, in a clean checkout of the tag, run
  `node scripts/sign-release.mjs vX.Y.Z` with `node` (not via `pnpm run`, which
  puts `node_modules/.bin` first on PATH). The signing key lives at
  `~/.tauri/zorvo-updater.key`; never create, read or print it. See
  `docs/development.md` for the full release and `--dry-run` behavior.
- **Supply chain:** `pnpm-workspace.yaml` (covering `.`, `site`, `server`)
  enforces `minimumReleaseAge` (one week), `blockExoticSubdeps` and
  `trustPolicy: no-downgrade`. Do not weaken these settings without an explicit
  decision.

## Working in worktrees and keeping disk use down

Parallel sessions may each work in their own git worktree (`.claude/worktrees/`
or `.qwen/worktrees/`). On the maintainer's Mac an untracked `.cargo/config.toml`
at the repo root sets
`[build] target-dir = "/Users/mac/Library/Caches/zorvo-target"`, shared by every
worktree. Leave it alone: `git clean -x` removes it, and every worktree would
silently go back to its own `target`. `pnpm clean:rust` empties the shared
folder, so do not run it while another session builds. After a merge, clean up
finished worktrees with `git worktree remove`.

`node_modules` costs little in a worktree (pnpm clones from its store on APFS);
the Rust `target` folder is the real disk cost. Without the shared config, each
checkout builds its own `target`.

## Documentation map

| Document | Use it for |
|---|---|
| `README.md` | What Zorvo does, install, agents, privacy, troubleshooting |
| `CLAUDE.md` | Deep architecture reference (the most detailed source) |
| `docs/development.md` | How it works, checks, release process, roadmap |
| `docs/development-browser.md` | Native WebKit Browser & Chromium CDP debug details |
| `CONTRIBUTING.md` | Setup, change workflow, ground rules |
| `docs/design-system/README.md` | Tokens, type, color, space, motion, copy rules |
| `docs/superpowers/specs/` | Feature design specs (artifacts, browser, motion, design systems, agent tools, etc.) |
| `CHANGELOG.md` | User-visible changes per release; add under `Unreleased` |
| `SECURITY.md` | How to report a vulnerability privately |

## Ground rules for changes

1. Read the relevant code, tests and docs before editing; do not guess at
   conventions.
2. Prefer editing existing files; keep new abstractions rare and justified.
3. Validate at system boundaries, handle errors explicitly, and never silently
   swallow them.
4. Never bypass `spawn::command` (`disclaim-exec`), `ensure_known_workspace`
   path checks, download-hash checks or the UI/backend trust boundary to make a
   test pass.
5. Run the checks the change needs, and report failures honestly rather than
   claiming success.
