# Redesign phase 7: the agent setup terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent whose only way in is its own interactive setup (Qwen Code: pick a provider) be set up from Zorvo. The draft or session shows a setup card. **Open setup in terminal** runs the agent's own program in the terminal dialog, and Zorvo checks the sign-in again when the setup ends or the dialog closes.

**Architecture:**
- A new Tauri command, `acp_start_agent_setup(profileId, cwd, terminalId)`, sits next to `acp_start_terminal_sign_in`. It resolves the agent's program from the registry exactly as `launch_for` does, but without the registry entry's own ACP arguments.
- The command runs only when the agent's fresh `initialize` reports a legacy terminal method (`_meta.type: "terminal"`). It runs in the sign-in PTY under the existing `signin-` route.
- The UI gains an auth method kind `setup`. A sign-in request whose methods are setup-only renders `AuthPanel` as the setup card. The existing terminal login path runs the setup by invoking the new command.
- Closing a terminal dialog while its program still runs now re-checks the sign-in, for setup and sign-in alike. The spec's line "Zorvo checks again when you close this." comes back.

**Tech Stack:** Rust (Tauri 2, `serde_json`, the existing PTY and ACP manager), React 19, Tailwind 4 tokens, Vitest + Testing Library, cargo test with the fake ACP agent.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md`, sections "Other states" (Agent setup, Terminal dialog, Agent setup terminal) and "Code impact".

## Global Constraints

- **The UI sends only `profileId`, `cwd` and `terminalId`.** No command, argument, environment or method id comes from the UI. The folder passes `files::ensure_known_workspace`, through `launch_in_workspace`. The program comes only from the registry entry (spec, "Agent setup terminal").
- **Offered only to an agent whose own `initialize` marks an interactive setup.** For now that is a method without a top-level `type` whose `_meta.type` is `"terminal"`: Qwen Code's legacy method. It is never a general "run any agent" door; the backend refuses everything else.
- **Zorvo never copies the agent's provider list into its own UI.** It never shows a field for a key either (CLAUDE.md: the app never asks for or stores API keys).
- **Copy, verbatim from the spec:**
  - the card: "Set up <Agent>", **Open setup in terminal**, "Already set up?" next to **Check again**;
  - the dialog: "Set up <Agent>", "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this." and **Close**.
- **Decisions the user made on 2026-11-05:**
  - The re-check on Close applies to both the setup dialog and the sign-in dialog, while the program runs.
  - The setup card shows where the sign-in card shows (a draft and a session), not in Settings → Agents.
- **Live regions stay.** `AuthPanel`'s status line is always mounted, and `SignInLayer`'s sr-only region stays mounted before the panel.
- **Light checks:** targeted test files while working. The full `pnpm test`, `pnpm lint` and the cargo trio run once at the end (`src-tauri/**` changes).

## Decisions taken here (the spec leaves them to the plan)

Checked against the real Qwen Code 0.26.6 on 2026-11-05. A bare `initialize` gives `{"id":"openai","name":"Use OpenAI API key","description":"Requires setting the `OPENAI_API_KEY` environment variable","_meta":{"type":"terminal","args":["--auth-type=openai"]}}`, and the answer is the same with or without `auth.terminal`. `qwen` without `--acp` starts the interactive app that holds "Connect a Provider".

- **Stripping the ACP arguments.**
  - The setup launch is the ACP launch built from the same profile, with `acp_args` replaced by a new `AgentProfile.setup_args`. That field is the launch arguments without the registry distribution's own `args`: `["-y", <package>]` for `npx`, `[<package>]` for `uvx`, `[]` for a binary.
  - Nothing is filtered by string, so an agent whose ACP flag has another name needs no change.
  - `setup_args` is `#[serde(skip)]`, like the other launch-only fields.
- **The legacy method's own `args` are not passed.** `--auth-type=openai` would skip the provider list, which is what the setup is for.
- **Any exit of a setup counts as done.** The user quits Qwen's app (Ctrl-C twice gives a non-zero code), so a setup's exit goes to `checking`, never to "The sign-in ended with code 130". A sign-in keeps reading a non-zero exit as a failure.
- **The check on Close.**
  - `useAgentSignIn` gains `closeDialog()`, which `SignInLayer` uses as the dialog's `onClose`. When the dialog's phase is `running`, it cancels, then runs `recheck()` (`refreshLoginEnv`, then `checkSignIn`, then a held message is resent as today).
  - In any other phase (`starting`, `checking`, `failed`) it only cancels, as now.
  - Settings' `cancelSignIn` does the same through its own `check(profileId)` for a sign-in started there.
  - GitHub's dialog is unchanged: it has its own note, and it re-reads on close already.
- **Where the setup shows.**
  - When every method of a request has kind `setup`, `AuthPanel` renders as the setup card.
  - When setup sits among runnable methods, its row gets the button **Open setup in terminal** in the sign-in card.
  - Settings → Agents shows a setup method as text only, like `explain`.
- **The dialog for a setup.** `TerminalSignInState` gains `isSetup?: boolean`. The title reads "Set up Qwen Code", and the line under it reads "Qwen Code's own setup" instead of the method's name ("Use OpenAI API key" would mislead).

## Review Focus

1. **The user quits Qwen's app with Ctrl-C (exit 130) after picking a provider.** The dialog goes to "Checking your sign-in…" and a held message is resent once, with no "ended with code 130" failure (Task 4).
2. **Close while starting, while checking, or after a failure runs no check.** Only Close while the program runs re-checks. Close during a check sends nothing, as today (Task 5).
3. **The program exits on its own and the user then presses Close.** There is one check, not two, and the message is sent once (Task 5).
4. **An already-configured Qwen opens straight into its chat, with no provider list.** Closing the dialog checks, finds the agent signed in, and resends the message (Task 5, App-level test).
5. **The webview asks to set up an agent that offers no setup, or a folder that is not a workspace.** The backend refuses both, and no process runs beyond the short-lived `initialize` (Task 1).

---

### Task 1: The backend setup command

**Files:**
- Modify:
  - `src-tauri/src/profiles.rs` (`AgentProfile.setup_args`)
  - `src-tauri/src/registry/resolve.rs` (fill it)
  - `src-tauri/src/acp/terminal_auth.rs` (`has_interactive_setup`, `AcpManager::agent_setup_with`)
  - `src-tauri/src/acp/commands.rs` (`setup_launch_in_workspace`, `start_agent_setup`, `#[tauri::command(async)] acp_start_agent_setup`)
  - `src-tauri/src/lib.rs` (register)
  - `src-tauri/tests/fixtures/fake_acp_agent.mjs` (`FAKE_ACP_SETUP_METHOD`)
  - `CLAUDE.md` ("Terminal sign-in" paragraph, fake agent flags)
- Test:
  - `terminal_auth.rs` unit tests
  - `commands.rs` unit tests
  - `src-tauri/tests/it/registry_resolve_test.rs`
  - `src-tauri/tests/it/acp_manager_test.rs`

**Interfaces:**
- Produces:
  - `pub fn has_interactive_setup(init: &Value) -> bool` (`terminal_auth.rs`): true when some `authMethods` entry has no top-level `type` and `_meta.type == "terminal"`.
  - `AcpManager::agent_setup_with(&self, cwd: &str, launch: &AcpLaunch, setup: &AcpLaunch, on_spawned: impl FnOnce(Arc<AcpConnection>) -> bool) -> Result<AcpLaunch, String>`. It runs `launch` for `initialize` and kills it. It returns `setup.clone()` when `has_interactive_setup`, else `Err("Zorvo does not run this agent's setup: it offers none")`. A cancel returns `CANCELLED_MESSAGE`, as in `terminal_login_with`.
  - Tauri command `acp_start_agent_setup(profile_id: String, cwd: String, terminal_id: String) -> Result<(), String>`. It shares the `signin-` id check, `sign_ins()` attempts, and the cancelled handling of `start_terminal_sign_in`. `acp_cancel_terminal_sign_in` cancels it while it starts.

- [ ] **Step 1: Write the failing tests.**
  - `has_interactive_setup` is true for Qwen Code's exact method, copied from the Decisions section. It is false for:
    - a method with top-level `type: "terminal"`;
    - `{id, name}` alone;
    - `_meta.type: "agent"`;
    - no `authMethods`.
  - `registry_resolve_test`:
    - an `npx` entry with `args: ["--acp", "--experimental-skills"]` gives `acp_args == ["-y", "pkg@1", "--acp", "--experimental-skills"]` and `setup_args == ["-y", "pkg@1"]`;
    - a binary entry's `setup_args` is empty.
  - `acp_manager_test`:
    - with `FAKE_ACP_SETUP_METHOD=1`, the fake agent offers `{"id":"setup","name":"Use OpenAI API key","_meta":{"type":"terminal","args":["--auth-type=openai"]}}`. `agent_setup_with` returns the `setup` launch unchanged: its program and args, with no `--auth-type` and no ACP flag.
    - without the flag it errs with "Zorvo does not run this agent's setup: it offers none".
  - `commands.rs`: `start_agent_setup` refuses
    - a folder that is not a workspace ("is not one of your workspaces"), and
    - a terminal id without the `signin-` prefix ("Not a sign-in terminal id").
- [ ] **Step 2:** Run `cd src-tauri && cargo test terminal_auth && cargo test --test it registry_resolve_test:: acp_manager_test::agent_setup`. Expected: FAIL (the items do not exist).
- [ ] **Step 3: Implement.**
  - `setup_args` is `#[serde(skip)]` with the default `Vec::new()`. `resolve.rs` sets it beside `acp_args` from the same `match`, without the distribution's `args`.
  - `setup_launch_in_workspace(store, cwd, profile_id) -> Result<(AcpLaunch, AcpLaunch), String>` checks the folder once, then builds both launches through `launch_from`. The second uses the profile with `acp_args = setup_args`.
- [ ] **Step 4:** Run the same command, then `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat: a backend command that opens an agent's own setup in a terminal`.

### Task 2: The `setup` method kind

**Files:**
- Modify: `src/lib/acp-auth.ts`, `src/components/agents/AgentSignIn.tsx`
- Test: `src/test/acp-auth.test.ts`, `src/test/settings-sign-in.test.tsx`

**Interfaces:**
- Produces:
  - `AuthMethodKind = 'agent' | 'terminal' | 'setup' | 'explain'`. `methodKind` returns `'setup'` for a method without a top-level `type` whose `_meta.type === 'terminal'`; today that returns `'explain'`.
  - `export function isSetupOnly(methods: readonly AuthMethod[]): boolean` is true when there is at least one method and every method is `setup`.
  - `authCopy`:
    - setup-only gives `lead: "<Agent> needs its own setup before it can start."`, with no `keysNote` and no `cliHint`;
    - `hasButton` counts `agent`, `terminal` and `setup`;
    - `hasExplained` counts only `explain`.

- [ ] **Step 1: Write the failing tests.**
  - Parsing Qwen Code's exact refusal gives one method `{ id: "openai", kind: "setup" }`.
  - A method with `_meta: { "api-key": … }` is still `explain`.
  - `isSetupOnly` cases: `[]`, `[setup]`, `[setup, agent]`.
  - The setup-only lead, as above.
  - The Settings row (`AgentSignIn`, in `settings-sign-in.test.tsx`) shows a setup method's name and no button.
- [ ] **Step 2:** Run `pnpm vitest run src/test/acp-auth.test.ts src/test/settings-sign-in.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `AgentSignIn.tsx`, the button condition becomes `method.kind === "agent" || method.kind === "terminal"`.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit `feat: an agent's own setup is a method kind of its own`.

### Task 3: The setup card

**Files:**
- Modify: `src/components/AuthPanel.tsx`
- Test: `src/test/auth-panel.test.tsx`

**Interfaces:**
- Consumes: `isSetupOnly` and `BlockerCard`.
- Produces: `AuthPanelProps` is unchanged.
  - For setup-only methods, the card is labelled and titled "Set up <Agent>", with body "<Agent> picks its provider in its own setup, which Zorvo opens in a terminal." and the primary action **Open setup in terminal**, which calls `onSignIn(<setup method id>)`.
  - Its footer holds the status line, Dismiss, the words "Already set up?" and **Check again**.

- [ ] **Step 1: Write the failing tests.**
  - With Qwen's setup-only methods, the card shows:
    - a region and heading "Set up Qwen Code";
    - the body sentence;
    - **Open setup in terminal**, which calls `onSignIn("openai")`.
  - The footer has "Already set up?", Check again, and Dismiss sign-in, with no textbox and no "Sign in with" button.
  - With `[setup, agent]`, the card is "Sign in to Qwen Code". The setup row's button is **Open setup in terminal**, disabled while signing in.
  - The status line stays one element across `idle` → `signing-in` → `checking` in the setup card.
- [ ] **Step 2:** Run `pnpm vitest run src/test/auth-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the same `BlockerCard` and `statusLine`. `MethodRow` gives a `setup` method the **Open setup in terminal** button.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the setup card`.

### Task 4: Running the setup in the terminal dialog

**Files:**
- Modify: `src/hooks/useTerminalSignIn.ts`, `src/components/TerminalSignInDialog.tsx`
- Test: `src/test/terminal-sign-in.test.tsx`

**Interfaces:**
- Consumes: the `acp_start_agent_setup` command (Task 1) and the `setup` kind (Task 2).
- Produces:
  - `TerminalSignInState.isSetup?: boolean`.
  - `run({ profileId, cwd, agentName, method })` with `method.kind === 'setup'` invokes `acp_start_agent_setup` with `{ profileId, cwd, terminalId }`, and no `methodId`. The state starts as `{ isSetup: true, methodName: "<Agent>'s own setup" }`.
  - An exit of a setup run settles `{ ok: true }` whatever its code.

- [ ] **Step 1: Write the failing tests.**
  - A setup run invokes `acp_start_agent_setup` with exactly `{ profileId, cwd, terminalId }`, where `terminalId` starts with `signin-`. It never invokes `acp_start_terminal_sign_in`.
  - The dialog reads "Set up Qwen Code" and "Qwen Code's own setup".
  - **Review Focus 1:** an `exit` event with code 130 on a setup run resolves `{ ok: true }`. The same event on a sign-in run still resolves the failure "The sign-in ended with code 130".
  - A sign-in run is unchanged.
- [ ] **Step 2:** Run `pnpm vitest run src/test/terminal-sign-in.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `Run` record keeps `isSetup`, and the dialog's title reads `state.isSetup ? "Set up" : "Sign in to"`.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit `feat: the setup runs in the terminal dialog`.

### Task 5: Check again on Close

**Files:**
- Modify:
  - `src/hooks/useAgentSignIn.ts` (`closeDialog`)
  - `src/components/SignInLayer.tsx` (`onClose={closeDialog}`)
  - `src/hooks/useSettingsSignIn.ts` (`cancelSignIn`)
  - `src/components/TerminalSignInDialog.tsx` (the running line)
- Test:
  - `src/test/acp-sign-in.test.tsx`
  - `src/test/settings-sign-in-dialog.test.tsx`
  - `src/test/terminal-sign-in.test.tsx`

**Interfaces:**
- Consumes: `recheck` (`useAgentSignIn`) and Settings' `check(profileId)`.
- Produces: `useAgentSignIn` returns `closeDialog: () => void` beside `cancel`. `cancel` keeps its meaning for code that stops a login without asking.

- [ ] **Step 1: Write the failing tests.**
  - The running line is "Pick with ↑ ↓ and Return, here in the terminal. Zorvo checks again when you close this." again; migrate the phase 6 copy.
  - App-level, Close while running:
    - kills the PTY;
    - calls `refresh_login_env`, then the probe (`acp_probe_agent`);
    - when the probe says signed in, resends the held message once.
  - **Review Focus 2:** Close while `starting`, `checking` or `failed` calls neither `refresh_login_env` nor the probe. Keep the existing "cancelling while the sign-in is checked sends nothing" test.
  - **Review Focus 3:** after the program exits 0 (which checks), a Close during that check starts no second probe, and the message is sent once.
  - **Review Focus 4**, App-level setup flow:
    - a Qwen-shaped refusal shows "Set up Qwen Code";
    - **Open setup in terminal** invokes `acp_start_agent_setup`;
    - Close while running checks, and a signed-in answer resends the message.
  - Settings: Close while running a sign-in started in Settings calls the row's check for that agent once.
- [ ] **Step 2:** Run `pnpm vitest run src/test/acp-sign-in.test.tsx src/test/settings-sign-in-dialog.test.tsx src/test/terminal-sign-in.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** as in the Decisions section. Read the phase from `terminal.dialog` before cancelling.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit `feat: closing a running login or setup checks the sign-in again`.

### Task 6: Docs, changelog and the full run

**Files:**
- Modify:
  - `docs/design-system/components/BlockerCard/README.md` (the setup card; correct "680px column" to the 768px `max-w-3xl`, a phase 6 deferred minor in this file)
  - `docs/design-system/components/BlockerCard/preview.html` (a fourth card: setup)
  - `docs/design-system/components/Dialog/README.md` (the setup title, the restored line, the check on Close)
  - `CHANGELOG.md`
- Test: `src/test/design-system-docs.test.ts`, the full suites

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**Set up Qwen Code from Zorvo.** When Qwen Code needs a provider, the new session shows **Set up Qwen Code**, which opens Qwen Code's own setup in a terminal, so you pick the provider there. Closing a sign-in or setup terminal now checks again whether you are signed in."
- [ ] **Step 3:** Run `pnpm lint`, then `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`. Expected: clean, all pass. `pnpm build` must have produced `dist/` first.
- [ ] **Step 4:** Run `pnpm test > <workspace>/full.log 2>&1` and read its last 20 lines. Expected: every file passes. Migrate tests that pinned the phase 6 running line, and record a ruling for each.
- [ ] **Step 5:** Commit `docs: the setup card and the check on Close`.
