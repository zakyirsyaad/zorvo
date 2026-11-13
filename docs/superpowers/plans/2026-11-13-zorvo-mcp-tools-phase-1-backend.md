# Zorvo agent tools, phase 1 (spike and backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the agents honour ACP's `mcpServers`, then give every eligible session a Zorvo MCP server whose tool calls reach the webview and whose answers reach the agent.

**Architecture:** The agent starts Zorvo's own executable in `mcp-bridge` mode as a stdio MCP server. The bridge only copies lines between its stdio and a Unix socket in the app data dir; the backend behind the socket speaks the MCP subset, knows the calling session by a per-session token, validates arguments, emits `agent-tool-call`, and writes the webview's answer back. In this phase the webview answers every call "not ready", and the setting that sends the server is off by default, so nothing changes for users until phase 2.

**Tech Stack:** Rust (std threads, `std::os::unix::net`, `serde_json`; no new crate), Tauri 2 commands and events, Node for the fake agent, Vitest for the contract test.

**Spec:** `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md`. Read "Transport", "Tools", "From tool call to session" and "Security" before starting. Phases 2 to 4 of the spec get their own plans after Task 1's result.

## Global Constraints

- The webview never sends a command, an argument or a path for the MCP server: the `mcpServers` entry is built in Rust. The webview sends one boolean per session start.
- The agent can never send a folder path that is not checked, a command, a mode, a model, a branch or a session id. Phase 1 only validates shapes; it starts nothing.
- Tokens and task text are never logged, never written to disk, never put in an error message.
- Socket: mode 0600, in a directory of mode 0700, removed on exit, replaced when stale.
- A connection that sends no known token within 2 seconds is closed. A tool call ends with an error when it has no answer within 4 minutes (Qwen Code and Codex give up after 5), or when the agent sends `notifications/cancelled` for it.
- `task` and `brief`: non-empty after trim, at most 20,000 characters, not starting with `/`. `title`: at most 60 characters. `max_chars`: 1 to 20,000.
- New Tauri commands are `#[tauri::command(async)]`, registered in `generate_handler!`, and `src/test/tauri-contract.test.ts` must pass without editing its checks.
- No new dependency. Blocking I/O on threads, as `src-tauri/src/acp/connection.rs` does.
- Run only what the change needs: targeted `cargo test` filters and targeted Vitest files locally; CI runs everything. Stage explicit paths, never `git add -A`. Conventional Commits. Push with `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30'`.
- `agentTools` in `Settings` is `false` by default in this phase. No Settings UI yet.

## Review Focus

1. **A socket path over macOS's 104-byte limit** (a long user name, the dev data dir): binding must not fail and leave every session without tools. Expected: fall back to a short private directory. Test in Task 3.
2. **A second Zorvo process** (the dev build next to the installed app, or a crash that left the socket file): expected, each data dir has its own socket, and a stale file is replaced only when nothing answers on it. Test in Task 3.
3. **The agent's session stops while a call waits for the webview**: expected, the call ends with an error, the pending entry is dropped, and a late `agent_tool_respond` is ignored without error. Test in Task 5.
4. **A bridge that connects with a token of a session that already stopped, or sends garbage first**: expected, closed, with no event emitted. Test in Task 3.
5. **An MCP client newer or older than Zorvo expects** (`protocolVersion` it does not know, a notification with no `id`, a batch, a line over 1 MiB): expected, a version Zorvo supports is answered, notifications get no reply, anything else gets a JSON-RPC error and the connection stays usable. Test in Task 4.

---

### Task 1: Spike — do the agents use `mcpServers`?

Throwaway. Nothing from this task is committed except the result table in the spec.

**Files:**
- Create (scratch, not in the repo): `<scratchpad>/mcp-spike/ping-server.mjs`, `<scratchpad>/mcp-spike/probe.mjs`
- Modify: `docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md` ("Risk to settle first")

**Interfaces:**
- Produces: a table in the spec with one row per agent and the columns `lists the tool`, `calls it`, `asks its own permission`, `tool-call timeout`, `notes`. Later plans read it.

- [ ] **Step 1: Write `ping-server.mjs`**: a stdio MCP server with no dependency (newline-delimited JSON-RPC) that answers `initialize`, `tools/list` (one tool, `ping`, no arguments) and `tools/call` (text `pong <ISO time>`), and appends every method it receives to the file named by `SPIKE_LOG`. A second tool, `slow`, sleeps for `seconds` (argument) before answering, to find the timeout.
- [ ] **Step 2: Write `probe.mjs <agent command...>`**: spawns the agent's ACP command, sends `initialize` (same client capabilities as `acp/manager.rs:757-766`), `session/new` with `cwd` set to an empty scratch folder and `mcpServers: [{ name: "zorvo-spike", command: process.execPath, args: [ping-server path], env: [{ name: "SPIKE_LOG", value: <path> }] }]`, then one prompt: "Call the ping tool of the zorvo-spike server and tell me exactly what it returned." It answers every `session/request_permission` with the first allowing option and records that one was asked, prints updates, and exits at the turn's end. A second run prompts for `slow` with 90, then 330, then 660 seconds.
- [ ] **Step 3: Run it against each agent the maintainer has signed in**: Pi (`pi-acp`), Qwen Code, Codex, Claude Code, Gemini CLI. Take each command line from Zorvo's resolved profile, not from memory. These runs use the maintainer's own accounts and cost a few small prompts each: tell them before running, and skip an agent that is not signed in rather than signing in.
- [ ] **Step 4: Record the table in the spec**, with the agent versions tested and the date, replacing the "not verified" sentence. For an agent that never lists the tool, record what `initialize` reported under `agentCapabilities.mcpCapabilities` and any error text.
- [ ] **Step 5: Stop and report if Pi does not call the tool.** The spec says the maintainer decides before product code. Otherwise commit the spec change:

```bash
git add docs/superpowers/specs/2026-11-13-zorvo-mcp-tools-design.md
git commit -m "docs: record which agents use ACP mcpServers"
```

---

### Task 2: Tool schemas and argument validation

**Files:**
- Create: `src-tauri/src/agent_tools/mod.rs`, `src-tauri/src/agent_tools/tools.rs`
- Modify: `src-tauri/src/lib.rs` (`mod agent_tools;`, public like `acp`)

**Interfaces:**
- Produces, in `agent_tools::tools`:
  - `pub const TOOL_NAMES: [&str; 5] = ["list_agents", "delegate", "start_session", "read_session", "stop_session"];`
  - `pub fn tool_list() -> serde_json::Value` — the `tools` array for `tools/list`: `name`, `description`, `inputSchema` (JSON Schema, `additionalProperties: false`).
  - `pub fn validate(tool: &str, args: &serde_json::Value) -> Result<serde_json::Value, String>` — returns the cleaned arguments (strings trimmed, unknown keys refused) or a sentence for the agent.
  - `pub const MAX_TEXT_CHARS: usize = 20_000; pub const MAX_TITLE_CHARS: usize = 60;`

Argument shapes (the spec's "Tools"): `list_agents {}`; `delegate { agent: string, task: string }`; `start_session { agent: string, brief: string, title?: string, worktree?: bool, folder?: string }`; `read_session { handle: string, max_chars?: integer }`; `stop_session { handle: string }`. `agent` and `handle`: non-empty, at most 200 characters, no control characters. `folder`: an absolute path string, at most 4096 characters; it is only shape-checked here, the webview and `ensure_known_workspace` decide later.

- [ ] **Step 1: Write the failing tests** in `tools.rs`'s `#[cfg(test)]` module:

```rust
#[test] fn lists_exactly_the_five_tools() { /* names of tool_list() == TOOL_NAMES, each has an object inputSchema */ }
#[test] fn accepts_a_delegate_call_and_trims_it() {
    let args = validate("delegate", &json!({"agent": " qwen-code ", "task": " review it "})).unwrap();
    assert_eq!(args, json!({"agent": "qwen-code", "task": "review it"}));
}
#[test] fn refuses_an_empty_a_slash_and_an_overlong_task() { /* "", "  ", "/review", 20_001 chars -> Err */ }
#[test] fn counts_characters_not_bytes() { /* 20_000 × "é" is accepted */ }
#[test] fn refuses_unknown_tools_keys_and_wrong_types() { /* "run", {"agent":1}, {"agent":"a","task":"t","cwd":"/"} */ }
#[test] fn an_error_never_repeats_the_task_text() { /* Err for an overlong task does not contain its first 50 chars */ }
#[test] fn start_session_takes_its_optional_fields() { /* title 60 ok, 61 Err; worktree bool; folder must start with '/' */ }
#[test] fn read_session_bounds_max_chars() { /* 0 and 20_001 Err; absent is absent in the cleaned value */ }
```

- [ ] **Step 2: Run** `cargo test --lib agent_tools::tools` from `src-tauri/`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `tool_list` and `validate`.** Descriptions are written for the agent: `delegate` says the answer arrives later as a message and that calling it again for the same agent continues the same session; `start_session` says the brief is all the new session knows.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/mod.rs src-tauri/src/agent_tools/tools.rs src-tauri/src/lib.rs
git commit -m "feat: schemas and validation for Zorvo's agent tools"
```

---

### Task 3: Socket, tokens and the bridge

**Files:**
- Create: `src-tauri/src/agent_tools/socket.rs`, `src-tauri/src/agent_tools/bridge.rs`
- Modify: `src-tauri/src/agent_tools/mod.rs`, `src-tauri/src/main.rs`
- Test: `src-tauri/tests/it/agent_tools_socket_test.rs` (add `mod agent_tools_socket_test;` to `tests/it/main.rs`)

**Interfaces:**
- Produces, in `agent_tools::socket`:
  - `pub struct Tokens` with `pub fn issue(&self, app_session_id: &str) -> String` (64 hex characters from 32 bytes of `/dev/urandom`; a second call for the same session replaces the first), `pub fn forget(&self, app_session_id: &str)`, `pub fn session_of(&self, token: &str) -> Option<String>` (constant-time compare).
  - `pub fn socket_path(data_dir: &Path) -> PathBuf` — `<data_dir>/agent-tools/s.sock`, or, when that is over 100 bytes, `/tmp/zorvo-<uid>-<8 hex of a hash of data_dir>/s.sock`.
  - `pub struct Listener` with `pub fn bind(path: &Path) -> Result<Listener, String>` (creates the directory 0700, refuses a directory it does not own or that is group/world accessible, replaces a socket file only after a connect to it fails, sets the socket 0600), `pub fn accept_loop(self, tokens: Arc<Tokens>, on_connection: impl Fn(String /*app session id*/, UnixStream) + Send + Sync + 'static)` (one thread per connection; reads the first line `{"token":"…"}` with a 2-second read timeout and a 4096-byte cap; closes on anything else), and `Drop` that removes the socket file.
- Produces, in `agent_tools::bridge`: `pub fn run() -> i32` — reads `ZORVO_MCP_SOCKET` and `ZORVO_MCP_TOKEN`, connects, writes the token line, then copies stdin→socket and socket→stdout on two threads until either ends; returns 0 on a clean end, 1 otherwise, and prints at most one plain line on stderr (never the token).
- `main.rs` becomes:

```rust
fn main() {
    if std::env::args().nth(1).as_deref() == Some("mcp-bridge") {
        std::process::exit(zorvo_lib::agent_tools::bridge::run());
    }
    zorvo_lib::run();
}
```

- [ ] **Step 1: Write the failing tests** in `agent_tools_socket_test.rs`, each with a scratch dir as the other `tests/it` files make one:

```rust
#[test] fn a_known_token_reaches_on_connection_with_its_session() { /* issue("s1"), connect, send token line, assert callback got "s1" and the stream echoes a line */ }
#[test] fn an_unknown_or_forgotten_token_is_closed_without_a_callback() { /* random token; token after forget("s1") */ }
#[test] fn garbage_or_silence_is_closed_within_three_seconds() { /* "hello\n"; nothing sent; a 5000-byte first line */ }
#[test] fn the_socket_and_its_directory_are_private() { /* mode & 0o777 == 0o600 and 0o700 */ }
#[test] fn a_stale_socket_file_is_replaced_and_a_live_one_is_not() { /* bind, leak the file without a listener -> second bind Ok; bind while the first listens -> Err */ }
#[test] fn a_long_data_dir_falls_back_to_a_short_path() { /* data_dir of 120 bytes -> socket_path().as_os_str().len() <= 100, and bind works */ }
#[test] fn dropping_the_listener_removes_the_file() {}
#[test] fn the_bridge_binary_copies_lines_both_ways() {
    // spawn env!("CARGO_BIN_EXE_zorvo") with ["mcp-bridge"] and the two variables;
    // write a line on its stdin, read it on the accepted stream; write back, read on its stdout.
}
#[test] fn the_bridge_exits_non_zero_without_a_socket_and_prints_no_token() {}
```

- [ ] **Step 2: Run** `cargo test --test it agent_tools_socket_test::`. Expected: FAIL to compile.
- [ ] **Step 3: Implement `Tokens`, `socket_path`, `Listener` and `bridge::run`.**
- [ ] **Step 4: Run the same command.** Expected: PASS. Then `cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/socket.rs src-tauri/src/agent_tools/bridge.rs src-tauri/src/agent_tools/mod.rs src-tauri/src/main.rs src-tauri/tests/it/agent_tools_socket_test.rs src-tauri/tests/it/main.rs
git commit -m "feat: a private socket and a stdio bridge for agent tools"
```

---

### Task 4: The MCP subset

**Files:**
- Create: `src-tauri/src/agent_tools/protocol.rs`
- Modify: `src-tauri/src/agent_tools/mod.rs`

**Interfaces:**
- Consumes: `tools::tool_list`, `tools::validate`.
- Produces, in `agent_tools::protocol`:
  - `pub const SUPPORTED_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];` (check these against the MCP specification's version list before relying on them, and against what Task 1's agents sent.)
  - `pub enum Step { Reply(Value), Silent, Call { id: Value, tool: String, args: Value } }`
  - `pub fn handle_line(line: &str) -> Step` — pure. `initialize` → the requested version if supported, else the newest; `capabilities: { tools: {} }`; `serverInfo: { name: "zorvo", version: env!("CARGO_PKG_VERSION") }`. `notifications/*` and any message without `id` → `Silent`. `ping` → `{}`. `tools/list` → `tool_list()`. `tools/call` with valid arguments → `Call`; with invalid ones → `Reply` of a tool result with `isError: true` and the validation sentence. Unknown method → error `-32601`; unparsable line or a batch array → `-32700` / `-32600` with `id: null`.
  - `pub fn tool_result(id: &Value, ok: bool, text: &str) -> Value` — `{ jsonrpc, id, result: { content: [{ type: "text", text }], isError: !ok } }`.
  - `pub const MAX_LINE_BYTES: usize = 1024 * 1024;`

- [ ] **Step 1: Write the failing unit tests** in `protocol.rs`:

```rust
#[test] fn initialize_answers_a_supported_version_and_falls_back_to_the_newest() {}
#[test] fn notifications_and_idless_messages_get_no_reply() {}
#[test] fn tools_list_returns_the_five_tools() {}
#[test] fn a_valid_call_becomes_a_call_step_with_cleaned_arguments() {}
#[test] fn an_invalid_call_is_a_tool_error_not_a_protocol_error() {}
#[test] fn unknown_methods_garbage_and_batches_get_json_rpc_errors() {}
#[test] fn a_tool_result_carries_text_and_the_error_flag() {}
#[test] fn string_and_number_ids_come_back_unchanged() {}
```

- [ ] **Step 2: Run** `cargo test --lib agent_tools::protocol`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/protocol.rs src-tauri/src/agent_tools/mod.rs
git commit -m "feat: the MCP subset Zorvo's agent tools speak"
```

---

### Task 5: `AgentTools` — calls waiting for the webview

**Files:**
- Create: `src-tauri/src/agent_tools/service.rs`
- Modify: `src-tauri/src/agent_tools/mod.rs`
- Test: `src-tauri/tests/it/agent_tools_service_test.rs` (+ `mod` line)

**Interfaces:**
- Consumes: `socket::{Tokens, Listener, socket_path}`, `protocol::{handle_line, tool_result, Step, MAX_LINE_BYTES}`.
- Produces, in `agent_tools` (re-exported from `mod.rs`):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall { pub call_id: String, pub session_id: String, pub tool: String, pub args: Value }

pub struct AgentTools { /* tokens, pending calls, socket path, bridge program */ }

impl AgentTools {
    /// Binds the socket and starts accepting. `bridge` is the program an agent runs
    /// (the app's own executable in production); `emit` receives every valid call.
    pub fn start(data_dir: &Path, bridge: PathBuf, emit: impl Fn(ToolCall) + Send + Sync + 'static)
        -> Result<Arc<AgentTools>, String>;
    /// The `mcpServers` value for a session: one stdio entry with a fresh token, or `[]` when `enabled` is false.
    pub fn servers_for(&self, app_session_id: &str, enabled: bool) -> Value;
    /// Answers a waiting call. Unknown or already answered: nothing happens.
    pub fn respond(&self, call_id: &str, ok: bool, text: &str);
    /// The session stopped: its token is forgotten, its connections close, its waiting calls end.
    pub fn forget(&self, app_session_id: &str);
    pub const CALL_TIMEOUT: Duration = Duration::from_secs(240);
}
```

- The entry: `{ "name": "zorvo", "command": <bridge>, "args": ["mcp-bridge"], "env": [{ "name": "ZORVO_MCP_SOCKET", "value": <path> }, { "name": "ZORVO_MCP_TOKEN", "value": <token> }] }`. Use the field shapes Task 1 saw the agents accept.
- `call_id`: `"<n>"` from a process-wide counter. A call that times out answers the agent "Zorvo did not answer in time." A call cut by `forget` answers nothing (the connection is gone). For tests, `start_with_timeout(data_dir, bridge, timeout, emit)` takes the timeout.

- [ ] **Step 1: Write the failing integration tests** (the client side connects to the socket directly and writes MCP lines; `emit` pushes into an `mpsc` channel):

```rust
#[test] fn servers_for_is_empty_when_disabled_and_one_stdio_entry_when_enabled() {}
#[test] fn a_tool_call_is_emitted_with_its_session_and_answered_by_respond() {}
#[test] fn list_and_initialize_are_answered_without_an_event() {}
#[test] fn an_invalid_call_is_answered_at_once_and_emits_nothing() {}
#[test] fn an_unanswered_call_times_out_with_an_error() { /* start_with_timeout(…, 200ms, …) */ }
#[test] fn forget_closes_the_connection_and_a_late_respond_is_ignored() {}
#[test] fn respond_to_an_unknown_call_does_nothing() {}
#[test] fn a_cancelled_notification_ends_the_waiting_call_and_a_late_respond_is_ignored() { /* notifications/cancelled with params.requestId == the call's id */ }
#[test] fn two_sessions_calls_do_not_cross() { /* tokens of s1 and s2; answers reach the right stream */ }
#[test] fn a_line_over_one_mebibyte_is_refused_and_the_connection_survives() {}
#[test] fn nothing_logs_the_token_or_the_task() { /* capture stderr of the bridge binary run; assert neither appears */ }
```

- [ ] **Step 2: Run** `cargo test --test it agent_tools_service_test::`. Expected: FAIL to compile.
- [ ] **Step 3: Implement `service.rs`.** One reader thread per connection; writes to a connection go through one mutex so an answer and a timeout cannot interleave bytes.
- [ ] **Step 4: Run again.** Expected: PASS. Then clippy.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/service.rs src-tauri/src/agent_tools/mod.rs src-tauri/tests/it/agent_tools_service_test.rs src-tauri/tests/it/main.rs
git commit -m "feat: route agent tool calls to a waiting answer"
```

---

### Task 6: Send the server with a session

**Files:**
- Modify: `src-tauri/src/acp/manager.rs` (`start` at ~196, `fork` at ~325), `src-tauri/src/acp/manager/reopen.rs` (~69), `src-tauri/src/store.rs` (`Settings`), `src-tauri/tests/fixtures/fake_acp_agent.mjs`
- Test: `src-tauri/tests/it/acp_manager_test.rs`, `src-tauri/tests/it/acp_session_reopen_test.rs`, `src-tauri/tests/it/store_test.rs`

**Interfaces:**
- Produces:
  - `AcpManager::start(&self, app_session_id, cwd, launch, mcp_servers: Value)`, `AcpManager::reopen(…, purpose, mcp_servers: Value)`, `AcpManager::fork(…, mcp_servers: Value)` (keep the existing parameter order, add `mcp_servers` last). `acp/probe.rs` keeps its literal `[]`.
  - `Settings.agent_tools: bool`, serialized `agentTools`, default `false`, read leniently like the struct's other fields.
  - Fake agent: `FAKE_ACP_PARAMS_LOG=<file>` appends `{ method, mcpServers }` for `session/new`, `session/load`, `session/resume` and `session/fork`. `FAKE_ACP_MCP_CALL=<json {tool, args}>` with `FAKE_ACP_MCP_LOG=<file>`: on a prompt whose text is `mcp`, it spawns the first `mcpServers` entry of that session (command, args, env), sends `initialize`, `notifications/initialized`, `tools/list` and the `tools/call`, appends each result to the log, and ends the turn.

- [ ] **Step 1: Write the failing tests:**

```rust
// acp_manager_test.rs
#[test] fn start_sends_the_given_mcp_servers() { /* FAKE_ACP_PARAMS_LOG; pass json!([{"name":"x"}]); assert logged */ }
#[test] fn fork_sends_the_given_mcp_servers() {}
// acp_session_reopen_test.rs
#[test] fn load_and_resume_send_the_given_mcp_servers() {}
// store_test.rs
#[test] fn agent_tools_is_off_unless_the_state_says_on() { /* absent -> false; "agentTools": true -> true; "agentTools": "yes" -> false */ }
```

- [ ] **Step 2: Run** `cargo test --test it acp_manager_test::start_sends`, `cargo test --test it acp_session_reopen_test::load_and` and `cargo test --test it store_test::agent_tools`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update every existing caller of the three functions in `src-tauri/` to pass `json!([])`, so the suite still compiles; Task 7 replaces the command layer's value.
- [ ] **Step 4: Run** `cargo test --test it acp_` and the store filter. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/acp/manager.rs src-tauri/src/acp/manager/reopen.rs src-tauri/src/store.rs src-tauri/tests/fixtures/fake_acp_agent.mjs src-tauri/tests/it/acp_manager_test.rs src-tauri/tests/it/acp_session_reopen_test.rs src-tauri/tests/it/store_test.rs
git commit -m "feat: pass an MCP server list when a session opens"
```

---

### Task 7: Commands, event and the webview's placeholder

**Files:**
- Create: `src-tauri/src/agent_tools/commands.rs`, `src/hooks/useAgentTools.ts`, `src/lib/agent-tools.ts`
- Modify: `src-tauri/src/lib.rs` (start `AgentTools` in `setup`, `manage` it, register the command, `forget` on session stop and exit), `src-tauri/src/acp/commands.rs` (`acp_start_session`, `acp_reopen_session`, `acp_import_session`, `acp_fork_session` gain `agent_tools: bool`), `src/hooks/useAcpSessions.ts` (pass `agentTools` on the four invokes), `src/hooks/session-engine/useAcpEngine.ts` (carry the flag), `src/lib/session-start.ts`, `src/App.tsx` (mount the hook in the main window only), `src/test/setup.ts` (the fake `invoke` accepts the new key and command)
- Test: `src/test/agent-tools.test.ts`, `src-tauri/tests/it/agent_tools_e2e_test.rs` (+ `mod` line)

**Interfaces:**
- Consumes: `AgentTools::{start, servers_for, respond, forget}`, `ToolCall`, `Settings.agent_tools`.
- Produces:
  - Event `agent-tool-call`, payload `ToolCall` (`{ callId, sessionId, tool, args }`), emitted from the `emit` closure in `lib.rs`.
  - `#[tauri::command(async)] pub fn agent_tool_respond(tools: State<'_, Arc<AgentTools>>, call_id: String, ok: bool, text: String)`.
  - Each of the four commands computes `tools.servers_for(&session_id, agent_tools && store.load_state()?.settings.agent_tools)` and passes it on. A failed open calls `tools.forget(&session_id)`.
  - `src/lib/agent-tools.ts`: `export function sessionGetsAgentTools(session: Pick<Session, 'compareRunId' | 'delegatedFrom'>): boolean` — false with a `compareRunId` or any `delegatedFrom` (open or ended); true otherwise. (Phase 3 adds `openedBy`.) And `export const NOT_READY = "Zorvo's tools are not available in this version.";`
  - `src/hooks/useAgentTools.ts`: `export function useAgentTools(): void` — listens to `agent-tool-call` and answers each with `invoke('agent_tool_respond', { callId, ok: false, text: NOT_READY })`. Phase 2 replaces the body.
  - `AgentTools` could not start (bind failed): log one line on stderr, manage a disabled instance whose `servers_for` always returns `[]`. The app must start without it.

- [ ] **Step 1: Write the failing tests:**

```ts
// src/test/agent-tools.test.ts
it('gives tools to a plain session and to a fork', …)
it('gives none to a compare run session', …)
it('gives none to a delegated session, open or ended', …)
it('answers a tool call as not ready', async () => { /* emit the fake event; expect invoke('agent_tool_respond', { callId: '7', ok: false, text: NOT_READY }) */ })
it('passes agentTools when a session starts, reopens, imports and forks', …)
```

```rust
// agent_tools_e2e_test.rs — the whole path, with the real bridge binary and the fake agent
#[test] fn the_fake_agent_calls_a_tool_through_the_bridge_and_gets_the_answer() {
    // AgentTools::start(dir, env!("CARGO_BIN_EXE_zorvo").into(), emit -> channel)
    // manager.start(…, tools.servers_for("s1", true)); prompt "mcp" with FAKE_ACP_MCP_CALL = delegate{agent,task}
    // receive ToolCall { session_id: "s1", tool: "delegate", .. }; tools.respond(call_id, true, "started")
    // FAKE_ACP_MCP_LOG then holds tools/list with five names and the result text "started"
}
#[test] fn a_disabled_session_gets_no_server_and_the_fake_agent_says_so() {}
#[test] fn stopping_the_session_ends_its_waiting_call() {}
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tools.test.ts` and `cargo test --test it agent_tools_e2e_test::`. Expected: FAIL.
- [ ] **Step 3: Implement the Rust side**, then the frontend. `agentTools` is a required key on all four invokes (the contract test counts a key inside a conditional spread as not passed).
- [ ] **Step 4: Run** both commands again, then `pnpm vitest run src/test/tauri-contract.test.ts src/test/helpers/tauri-contract.test.ts`, `pnpm lint`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`. Expected: PASS. Any existing Vitest file that asserts the exact argument object of the four invokes needs `agentTools` added: find them with `grep -rn "acp_start_session\|acp_reopen_session\|acp_import_session\|acp_fork_session" src/test` and run those files.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_tools/commands.rs src-tauri/src/agent_tools/mod.rs src-tauri/src/lib.rs src-tauri/src/acp/commands.rs src-tauri/tests/it/agent_tools_e2e_test.rs src-tauri/tests/it/main.rs src/hooks/useAgentTools.ts src/lib/agent-tools.ts src/hooks/useAcpSessions.ts src/hooks/session-engine/useAcpEngine.ts src/lib/session-start.ts src/App.tsx src/test/setup.ts src/test/agent-tools.test.ts
git commit -m "feat: carry agent tool calls between the agent and the webview"
```

---

### Task 8: Docs, changelog, PR

**Files:**
- Modify: `CLAUDE.md` (a new "Agent tools" paragraph after "Elicitation", the fake agent's new flags in "Commands", and the "Delegation" paragraph the file lacks: read `src/hooks/useDelegation.ts` and `src/lib/delegation.ts` and describe what is built today, not the spec's later phases), `CHANGELOG.md` (no user-visible change yet: add a line under Unreleased only if the file already lists internal groundwork; otherwise none, and say so in the PR)

- [ ] **Step 1: Write the paragraphs.** State plainly that the setting is off by default and that the webview answers "not ready" until phase 2.
- [ ] **Step 2: Review the whole diff against the spec's "Transport" and "Security" sections** and against this plan's Review Focus; fix what it finds.
- [ ] **Step 3: Commit, push, open the PR against `main`.** The PR body lists: the spike's table, what is and is not wired, how to try it by hand (`"agentTools": true` in the dev data dir's `state.json`, then an agent calling `list_agents` gets "not available"), and what was not verified in a packaged app (the bridge runs the bundled executable there: `Zorvo.app/Contents/MacOS/zorvo mcp-bridge`). Do not merge.

```bash
git add CLAUDE.md
git commit -m "docs: describe agent tools and delegation"
GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30' git push -u origin <branch>
```
