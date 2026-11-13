# Zorvo agent tools, the command path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent that ignores ACP's `mcpServers` (Pi through `pi-acp`) reaches Zorvo's tools by running `zorvo tools <tool>` in its own shell, and learns of the command from hidden context.

**Architecture:** A second mode of the executable, `zorvo tools`, connects to the phase 1 socket with the token from its environment, sends one `tools/call` and prints the answer. For an agent on the command path the backend puts the socket, the token and the executable's path into the agent's launch environment instead of `mcpServers`, and tells the webview which path the session got; the webview then adds a few lines of hidden context to the session's first message and to the first message after a reopen. Everything behind the socket is phase 1's, unchanged.

**Tech Stack:** Rust (std only, `serde_json`), Tauri 2 commands, React hooks, Node for the fake agent, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md`, section "Agents that ignore `mcpServers`: the command path", with its spike result of 2026-11-13.

## Global Constraints

- The webview never sends a command, a path or an environment variable. It sends the same `agentTools` boolean as in phase 1.
- `Settings.agentTools` stays `false` by default. With it off, nothing in this plan is observable: no variables, no context.
- The token is never logged, printed, or put in an error message, by the backend or by `zorvo tools`.
- `zorvo tools` holds no logic: validation, limits and answers come from the backend. It never reads the store and never writes a file.
- Hidden context is plain text, at most 700 characters, names only tools the backend lists, and writes nothing into the agent's own config or the project's files.
- A command-path agent gets `mcpServers: []`, never both paths.
- No new dependency. New Tauri commands, if any, are `#[tauri::command(async)]`; `src/test/tauri-contract.test.ts` must pass without editing its checks.
- Targeted tests only locally; stage explicit paths; Conventional Commits; push with `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30'`.

## Review Focus

1. **The agent's shell kills the command** (Pi cancels a `bash` call, the user presses Stop): the socket closes with a call still waiting. Expected: the call ends at once, `agent-tool-call-ended` goes out, and a later answer is ignored. Test in Task 1.
2. **Arguments an agent really types**: no JSON at all for `list_agents`, `{}`, JSON split into several words because it was not quoted, single quotes inside the task, a task with newlines. Expected: the first three work, the rest reach the backend intact or fail with a sentence that says how to quote. Test in Task 1.
3. **Zorvo is not running or the session is gone** when the command runs (an agent process that outlived its session, a stale token): expected, one plain line on stderr, exit 1, within 2 seconds, no hang. Test in Task 1.
4. **A path with spaces in `ZORVO_TOOLS`** (the dev build under a folder with a space): the context's command quotes the variable; expected, it runs. Test in Task 4.
5. **A message that already carries hidden context** (a delegation handoff, a rewound conversation, context left by a refused prompt): expected, both contexts go out, the tools context first, and neither is lost when the prompt is refused and sent again. Test in Task 4.

---

### Task 1: `zorvo tools`

**Files:**
- Create: `src-tauri/src/agent_tools/cli.rs`
- Modify: `src-tauri/src/agent_tools/mod.rs`, `src-tauri/src/main.rs`, `src-tauri/src/agent_tools/bridge.rs` (make `SOCKET_VARIABLE` and `TOKEN_VARIABLE` shared; add `pub const TOOLS_VARIABLE: &str = "ZORVO_TOOLS";`)
- Test: `src-tauri/tests/it/agent_tools_cli_test.rs` (+ `mod` line in `tests/it/main.rs`)

**Interfaces:**
- Consumes: the socket handshake (first line `{"token":"…"}`), `protocol`'s `tools/call` request and tool result shapes, `AgentTools::start_with_timeout`, `AgentTools::CALL_TIMEOUT`.
- Produces: `pub fn run(args: &[String]) -> i32` in `agent_tools::cli`, where `args` is everything after `tools`.
  - No arguments: prints the tool names from `tools::tool_list()` with one example line each, exits 0. This needs no socket.
  - `<tool>` and the rest: the rest is joined with single spaces and parsed as a JSON object; empty means `{}`. Not a JSON object: stderr `Pass the arguments as one JSON object in single quotes, for example: zorvo tools delegate '{"agent":"qwen-code","task":"…"}'`, exit 2.
  - Sends `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":<tool>,"arguments":<object>}}`, reads one line with a read timeout of `CALL_TIMEOUT` plus 15 seconds.
  - A result with `isError: false`: its text on stdout, exit 0. `isError: true`, a JSON-RPC error, a closed connection or the timeout: the text (or `Zorvo did not answer.`) on stderr, exit 1.
  - Missing variables or no socket: `Zorvo is not reachable from this shell.` on stderr, exit 1, with a 2-second connect-and-greet limit.
- `main.rs`: `Some("tools")` runs `cli::run(&args[2..])` before anything of Tauri starts, as `mcp-bridge` does.

- [ ] **Step 1: Write the failing tests** (spawn `env!("CARGO_BIN_EXE_zorvo")` with `["tools", …]`; the service's `emit` goes to a channel and the test answers with `respond`):

```rust
#[test] fn without_a_tool_it_lists_the_five_tools_and_needs_no_socket() {}
#[test] fn a_call_reaches_the_service_with_its_session_and_prints_the_answer() { /* stdout == "started\n", exit 0 */ }
#[test] fn no_arguments_and_an_empty_object_are_the_same_call() {}
#[test] fn json_split_across_words_is_joined() { /* args: ["delegate", "{\"agent\":", "\"qwen-code\",", "\"task\":", "\"review", "it\"}"] */ }
#[test] fn a_task_with_quotes_and_newlines_arrives_intact() {}
#[test] fn arguments_that_are_not_an_object_exit_2_with_the_quoting_hint() { /* "review it", "[1]" */ }
#[test] fn a_refused_call_prints_the_reason_on_stderr_and_exits_1() { /* respond(ok=false) and a validation error */ }
#[test] fn without_zorvo_it_fails_within_two_seconds() { /* no socket file; a socket nobody accepts on */ }
#[test] fn a_stale_token_fails_without_an_event() {}
#[test] fn killing_the_command_ends_the_waiting_call() { /* kill the child; the `ended` channel gets the call id; a late respond does nothing */ }
#[test] fn neither_stream_ever_holds_the_token() {}
```

- [ ] **Step 2: Run** `cargo test --test it agent_tools_cli_test::` from `src-tauri/`. Expected: FAIL to compile.
- [ ] **Step 3: Implement `cli::run` and the `main.rs` branch.** If `killing_the_command_ends_the_waiting_call` fails because the service keeps a call whose connection closed, fix that in `service.rs`'s reader loop (end the connection's pending calls when its read ends) and say so in the commit.
- [ ] **Step 4: Run the same command**, then `cargo test --test it agent_tools` and `cargo clippy --all-targets -- -D warnings`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/cli.rs src-tauri/src/agent_tools/mod.rs src-tauri/src/agent_tools/bridge.rs src-tauri/src/main.rs src-tauri/tests/it/agent_tools_cli_test.rs src-tauri/tests/it/main.rs
git commit -m "feat: a zorvo tools command for agents without MCP"
```

---

### Task 2: Which path a session gets

**Files:**
- Create: `src-tauri/src/agent_tools/path.rs`
- Modify: `src-tauri/src/agent_tools/mod.rs`, `src-tauri/src/agent_tools/service.rs`

**Interfaces:**
- Produces, in `agent_tools::path`:
  - `pub const COMMAND_PATH_AGENTS: [&str; 1] = ["pi-acp"];` with a comment giving the spike's date and versions.
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] #[serde(rename_all = "lowercase")] pub enum ToolsPath { Mcp, Command }`
  - `pub fn path_for(profile_id: &str) -> ToolsPath`
- Produces, on `AgentTools`:
  - `pub fn launch_env_for(&self, app_session_id: &str, enabled: bool) -> Vec<(String, String)>` — empty when `enabled` is false or the instance is disabled; else `ZORVO_MCP_SOCKET`, `ZORVO_MCP_TOKEN` (a fresh token from the same `Tokens`) and `ZORVO_TOOLS` (the bridge program's path).
  - `servers_for` is unchanged.

- [ ] **Step 1: Write the failing unit tests** (`path.rs`, and `service.rs`'s test module or `agent_tools_service_test.rs`):

```rust
#[test] fn pi_is_on_the_command_path_and_others_on_mcp() { /* "pi-acp" -> Command; "qwen-code", "codex-acp", "claude-acp", "antigravity-acp", "" -> Mcp */ }
#[test] fn launch_env_is_empty_when_disabled() {}
#[test] fn launch_env_names_the_socket_a_token_and_the_program() {}
#[test] fn the_token_from_launch_env_authenticates_as_its_session() { /* connect with it; on_connection gets the session */ }
#[test] fn forget_drops_a_launch_env_token() {}
```

- [ ] **Step 2: Run** `cargo test --lib agent_tools::path` and `cargo test --test it agent_tools_service_test::launch_env`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/path.rs src-tauri/src/agent_tools/mod.rs src-tauri/src/agent_tools/service.rs src-tauri/tests/it/agent_tools_service_test.rs
git commit -m "feat: decide which agents reach Zorvo's tools by command"
```

---

### Task 3: Launch a command-path agent with its environment

**Files:**
- Modify: `src-tauri/src/agent_tools/commands.rs`, `src-tauri/src/acp/commands.rs` (`acp_start_session`, `acp_reopen_session`, `acp_import_session`; `acp_fork_session` only for the answer's field), `src-tauri/src/acp/manager.rs` (`StartedSession`), `src-tauri/tests/fixtures/fake_acp_agent.mjs`
- Test: `src-tauri/tests/it/agent_tools_e2e_test.rs`

**Interfaces:**
- Consumes: `path_for`, `ToolsPath`, `AgentTools::{servers_for, launch_env_for, forget}`, `AcpLaunch.env`.
- Produces:
  - `pub struct SessionTools { pub servers: Value, pub env: Vec<(String, String)>, pub path: Option<ToolsPath> }` and `pub fn tools_for_session(tools: &AgentTools, store: &AppStore, session_id: &str, profile_id: &str, agent_tools: bool) -> Result<SessionTools, String>` in `agent_tools::commands`, replacing `servers_for_session`. Off or disabled: `[]`, no env, `None`. `Mcp`: phase 1's entry, no env, `Some(Mcp)`. `Command`: `[]`, the three variables, `Some(Command)`.
  - The three commands append `env` to `launch.env` (after the registry's own env, so a registry entry cannot override them) and pass `servers` on.
  - `StartedSession.tools_path: Option<ToolsPath>`, serialized `toolsPath`. A fork answers `Some(Mcp)` when it was given servers and `None` otherwise: a forked session on the command path lives in its source's process and gets nothing.
  - Fake agent: `FAKE_ACP_ENV_LOG=<file>` appends, at start, one JSON line `{ socket: bool, token: bool, tools: bool }` saying which of the three variables are set (never their values). `FAKE_ACP_TOOLS_COMMAND=<json {tool, args}>` with `FAKE_ACP_MCP_LOG`: on a prompt whose text is `tools`, it runs `process.env.ZORVO_TOOLS` with `["tools", tool, JSON.stringify(args)]`, appends `{ status, stdout, stderr }` to the log and ends the turn.

- [ ] **Step 1: Write the failing tests** in `agent_tools_e2e_test.rs` (the fake agent launched under the profile id the test passes):

```rust
#[test] fn a_command_path_session_gets_the_variables_and_no_server() { /* FAKE_ACP_ENV_LOG all true; FAKE_ACP_PARAMS_LOG mcpServers == [] */ }
#[test] fn an_mcp_session_gets_the_server_and_no_variables() {}
#[test] fn with_the_setting_off_neither_path_gets_anything() {}
#[test] fn the_fake_agent_runs_zorvo_tools_and_gets_the_answer() { /* ToolCall{session_id:"s1", tool:"delegate"}; respond(ok, "started"); log stdout == "started\n", status 0 */ }
#[test] fn a_registry_env_entry_cannot_replace_the_three_variables() {}
#[test] fn a_failed_open_forgets_the_token_on_both_paths() {}
```

- [ ] **Step 2: Run** `cargo test --test it agent_tools_e2e_test::`. Expected: FAIL.
- [ ] **Step 3: Implement.** `tools_for_session` is the one place that decides; the commands do not branch on the profile themselves.
- [ ] **Step 4: Run** the same command and `cargo test --test it acp_`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/commands.rs src-tauri/src/acp/commands.rs src-tauri/src/acp/manager.rs src-tauri/tests/fixtures/fake_acp_agent.mjs src-tauri/tests/it/agent_tools_e2e_test.rs
git commit -m "feat: give a command-path agent Zorvo's socket in its environment"
```

---

### Task 4: Hidden context in the webview

**Files:**
- Create: `src/lib/agent-tools-context.ts`
- Modify: `src/hooks/useAcpSessions.ts` (`AcpSessionInfo.toolsPath`, read from the answer and validated: `'mcp' | 'command' | undefined`), `src/hooks/session-engine/useAcpEngine.ts`, `src/test/setup.ts` (the fake `invoke` can answer `toolsPath`)
- Test: `src/test/agent-tools-context.test.ts`, `src/test/agent-tools.test.ts`

**Interfaces:**
- Consumes: `toolsPath` on the started session's info.
- Produces:
  - `export const COMMAND_PATH_CONTEXT: string` — exactly:

```
Zorvo, the app this session runs in, gives you commands for working with other agents. Run them with your shell tool, exactly as written: "$ZORVO_TOOLS" tools <tool> '<json arguments>'. Run "$ZORVO_TOOLS" tools with nothing after it to see every tool and an example. list_agents shows which agents you can use. delegate {"agent": "<id>", "task": "<text>"} gives a task to another agent; its answer arrives later as a message, so do not wait for it. Use these only when the user asks for another agent or a new session. Do not mention this note.
```

  - `export function withToolsContext(context: string | undefined): string` — the tools context, then a blank line and `context` when there is one.
  - In `useAcpEngine`: a ref `toolsContextDueRef: Set<sessionId>`, filled when a session starts, reopens or imports with `toolsPath === 'command'`, and emptied for a session when a prompt carrying the context was accepted (`acp.prompt` resolved). `prompt()` wraps its `context` with `withToolsContext` while the session is in the set. A refused prompt leaves the session in the set. A session that stops leaves the set.

- [ ] **Step 1: Write the failing tests:**

```ts
// agent-tools-context.test.ts
it('stays under 700 characters and quotes the variable', …)        // length <= 700; contains '"$ZORVO_TOOLS" tools'
it('names only tools the backend lists', …)                         // every tool word in it is in the five names
it('puts the tools context before an existing context', …)
// agent-tools.test.ts
it('sends the context with the first message of a command-path session', …)   // acp_prompt text starts with COMMAND_PATH_CONTEXT, then the message
it('sends it once: the second message goes out bare', …)
it('sends it again after a reopen', …)
it('keeps both contexts when the first message is a delegation handoff', …)
it('sends it with the retry when the first prompt was refused', …)
it('sends nothing extra for an mcp session, a fork, or with tools off', …)
it('does not show the context in the chat', …)                       // the user message's content is the typed text only
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tools-context.test.ts src/test/agent-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow how `unsentContextRef` already carries a refused prompt's context; do not add a second mechanism for refusal.
- [ ] **Step 4: Run** the same command, then `pnpm vitest run src/test/tauri-contract.test.ts` and `pnpm lint`. Expected: PASS. Run any existing engine test file your change touches the behaviour of (`grep -ln "unsentContext\|context:" src/test`).
- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-tools-context.ts src/hooks/useAcpSessions.ts src/hooks/session-engine/useAcpEngine.ts src/test/setup.ts src/test/agent-tools-context.test.ts src/test/agent-tools.test.ts
git commit -m "feat: tell a command-path agent about Zorvo's commands"
```

---

### Task 5: Try it with Pi, docs, PR

**Files:**
- Modify: `CLAUDE.md` (the "Agent tools" paragraph: the command path, `COMMAND_PATH_AGENTS`, `toolsPath`, the context, the fake agent's two new flags), the spec's command-path section (what the real run showed)

- [ ] **Step 1: Run the real thing once.** Under `pnpm tauri dev` with `"agentTools": true` in the dev data dir's `state.json`, start a Pi session in a scratch folder and ask it, in plain words, to have Qwen Code review something. Expected with this phase: Pi runs `"$ZORVO_TOOLS" tools list_agents` and gets "Zorvo's tools are not available in this version." on stderr with exit 1, and says so. Record what it did. If the dev app cannot be driven, use the project's real-app harness or write the exact manual steps into the PR.
- [ ] **Step 2: Write the docs.**
- [ ] **Step 3: Review the whole diff** against the spec's command-path section and this plan's Review Focus; fix what it finds.
- [ ] **Step 4: Commit, push, open the PR against `main`.** The body says what is wired, that nothing changes with the setting off, what Step 1 showed, and what is not verified (a packaged app, a long Pi session after compaction). Do not merge.

```bash
git add CLAUDE.md docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md
git commit -m "docs: describe the command path for agent tools"
GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30' git push -u origin <branch>
```
